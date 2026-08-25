/**
 * Authentication & authorization middleware.
 *
 * Replaces the PHP session guards from api/config.php:
 *   requireAuth()          → requireAuth
 *   requireRole(...roles)  → requireRole(...roles)
 *   requirePlatformAuth()  → requirePlatformAuth
 *
 * The JWT payload mirrors what PHP kept in the session:
 *   { user: {...}, org_slug: 'acme', platform_admin?: true }
 *
 * On a valid tenant token we resolve the tenant (by the slug embedded in the
 * token) and attach its connection pool as `req.db` — the exact equivalent of
 * PHP `db()` resolving the tenant from `$_SESSION['org_slug']`.
 */
import config from '../config/index.js';
import { verifyToken } from '../utils/jwt.js';
import { resolveTenantBySlug, getTenantPool, heldForNonPayment } from '../database/tenant.js';
import { masterDb } from '../database/master.js';
import { ApiError, unauthorized, forbidden } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';
import { meterTenantRequest } from './tenantQuota.js';
import { billingState } from '../services/subscriptionService.js';
import { getPlatformSetting } from '../services/platformSettingsService.js';
import { maintenanceStatus, maintenanceError } from '../services/maintenanceService.js';

function getBearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return '';
}

/*
 * How long the two billing settings below are held before being re-read.
 *
 * Zero in tests: a test that changes one and then makes a request would
 * otherwise assert against whatever was cached up to a minute earlier, which
 * either makes it flaky or makes it wait sixty seconds. The cache is a hot-path
 * optimisation, not behaviour, so dropping it there costs nothing but a couple
 * of extra reads.
 */
const SETTING_CACHE_MS = config.env === 'test' ? 0 : 60000;

/*
 * Whether lapsed organisations are actually blocked.
 *
 * Cached: this is consulted on every single request and it changes about once a
 * year. Re-read every minute so switching it on in the console takes effect
 * without a restart, and treated as OFF whenever the lookup fails — a settings
 * outage must not lock every customer out.
 */
let billingEnforceCache = { value: false, at: 0 };
async function billingEnforced() {
  if (Date.now() - billingEnforceCache.at < SETTING_CACHE_MS) return billingEnforceCache.value;
  try {
    const raw = await getPlatformSetting('billing_enforce');
    billingEnforceCache = { value: String(raw) === '1', at: Date.now() };
  } catch {
    billingEnforceCache = { value: false, at: Date.now() };
  }
  return billingEnforceCache.value;
}

/*
 * How many days past the due date before access is actually withdrawn.
 *
 * Cached on the same terms and for the same reason as the flag above. This has
 * to be read rather than assumed: `sweepLapsed`, `billingOverview` and the
 * organisation's own billing page all pass the configured value to
 * billingState(), and this gate did not — so it used the built-in default of
 * two days regardless. Setting the window to a week meant the API started
 * refusing on day two while every screen said five days remained.
 *
 * Falls back to the same default billingState() uses, so a settings outage
 * changes nothing about when anybody is blocked.
 */
const DEFAULT_GRACE_DAYS = 2;
let graceDaysCache = { value: DEFAULT_GRACE_DAYS, at: 0 };
async function billingGraceDays() {
  if (Date.now() - graceDaysCache.at < SETTING_CACHE_MS) return graceDaysCache.value;
  let value = DEFAULT_GRACE_DAYS;
  try {
    const n = parseInt(await getPlatformSetting('billing_grace_days'), 10);
    if (Number.isFinite(n) && n >= 0 && n <= 30) value = n;
  } catch { /* keep the default */ }
  graceDaysCache = { value, at: Date.now() };
  return value;
}

async function attachTenantDb(req, orgSlug) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const tenant = await resolveTenantBySlug(orgSlug, host);
  req.tenant = tenant;
  req.db = getTenantPool(tenant);
  /*
   * MOM §8.3/§8.5 — meter the request against this organisation's quota.
   *
   * It has to happen HERE rather than as a router-level middleware: the tenant
   * is only known once the token has been decoded, so anything mounted before
   * the auth middleware would see req.tenant undefined and silently count
   * nothing. Returns a rejection when the quota is exhausted; fails open on any
   * metering error.
   */
  await meterTenantRequest(req);
  req.billingEnforced = await billingEnforced();
  req.billingGraceDays = await billingGraceDays();
}

/**
 * Re-check the session against the database on every request.
 *
 * The JWT embeds a *snapshot* of the user taken at login and stays valid for 8
 * hours. Trusting that snapshot meant:
 *   • deactivating an employee (offboarding) did not end their session — they
 *     kept full access until the token happened to expire;
 *   • demoting someone from manager to employee left their elevated role intact
 *     inside the token, so privileged endpoints kept honouring it;
 *   • resetting a password did not invalidate sessions opened with the old one.
 *
 * So the token now only tells us *who is claiming to be logged in*; the
 * authoritative role and status come from the row, on every request.
 */
async function loadLiveUser(req, payload) {
  const claimed = payload.user || {};
  const [rows] = await req.db.execute(
    // UNIX_TIMESTAMP() is resolved by MySQL in its own timezone. Parsing the raw
    // DATETIME string in Node would silently treat a local timestamp as UTC and
    // shift it by the server's offset — which, for a positive offset, would make
    // the password change look like it happened in the future and log the user
    // straight back out of the session they just reset.
    `SELECT u.id, u.employee_id, u.name, u.email, u.phone, u.department, u.business_unit,
            u.location, u.role, u.manager_id, u.points, u.avatar_initials, u.status,
            u.must_change_password,
            UNIX_TIMESTAMP(u.password_changed_at) AS password_changed_ts,
            m.name AS manager_name
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.id = ? LIMIT 1`,
    [claimed.id]
  );
  const row = rows[0];

  if (!row) throw unauthorized('Your account no longer exists.');
  if (row.status !== 'active') throw unauthorized('Your account has been deactivated.');

  /*
   * Tokens issued before the last password change are dead.
   *
   * This deliberately does NOT compare the token's `iat` against the change
   * time. That approach cannot work: a token minted one second before the
   * change and the replacement token minted zero seconds after it are
   * indistinguishable at whole-second resolution, so any skew tolerance wide
   * enough to protect the new token also lets the old one survive. (It did —
   * an old token kept working right through a password change.) It is also at
   * the mercy of clock drift between Node and MySQL.
   *
   * Instead the token carries `pwd_ts`: the value of password_changed_at, read
   * from the database, at the moment the token was issued. If the row's current
   * value differs, the password has changed since — so the token is stale, full
   * stop. Exact, and immune to clock skew because both sides come from the DB.
   */
  const rowPwdTs = Number(row.password_changed_ts) || 0;
  const tokenPwdTs = Number(payload.pwd_ts) || 0;
  if (rowPwdTs !== tokenPwdTs) {
    throw new ApiError(401, 'Session expired', { expired: true });
  }

  return {
    id: row.id,
    employee_id: row.employee_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    department: row.department,
    business_unit: row.business_unit,
    location: row.location,
    role: row.role,            // authoritative — never the role baked into the token
    manager_id: row.manager_id,
    manager_name: row.manager_name,
    points: row.points,
    avatar_initials: row.avatar_initials,
    status: row.status,
    must_change_password: !!row.must_change_password,
    org_name: req.tenant?.name,
    org_slug: req.tenant?.slug,
  };
}

/**
 * Endpoints a user still holding a temporary password is allowed to reach.
 * Everything else is refused until they have chosen a real one.
 */
const PASSWORD_CHANGE_ALLOWED = [
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/me',
  // Support stays reachable on a temporary password — deliberately. The person
  // whose credentials don't work is exactly the person who needs to raise a
  // ticket, and 16 of one real org's 17 users were locked out of Support by
  // this gate. The prefix covers raise/list/read/reply/close of their OWN
  // tickets and nothing else; every other endpoint still 403s.
  '/api/support/tickets',
];

/**
 * A newly onboarded employee starts on a temporary password: a random one that
 * was emailed to them, or — when there is no address to email — the derived
 * formula "yash5881", the first 4 letters of the name plus the last 4 digits of
 * the phone number. The derived one is guessable by any colleague who knows
 * both, so it is only ever a bootstrap credential.
 *
 * This gate is what makes that acceptable: until the password is replaced, the
 * session can do nothing except change it. Enforcing it here rather than with a
 * redirect in React is the whole point — a UI redirect is bypassed by anyone who
 * calls the API directly with the token they just received.
 */
function enforcePasswordChange(req) {
  if (!req.user?.must_change_password) return;
  const path = (req.originalUrl || '').split('?')[0];
  if (PASSWORD_CHANGE_ALLOWED.some((p) => path === p || path.startsWith(p + '/'))) return;

  throw new ApiError(403, 'You must set a new password before continuing.', {
    must_change_password: true,
  });
}

/**
 * What a lapsed organisation may still reach.
 *
 * Signing in has to work, or nobody can see the message telling them why they
 * cannot get in. Support has to work, because the people locked out are exactly
 * the people who need to talk to somebody. Branding and notifications are what
 * the shell fetches before it can draw anything at all — refusing them produces
 * a blank page instead of an explanation.
 *
 * And the bill itself has to be reachable, which it was not. Both the "access
 * has paused" banner and the billing page read /settings/subscription and
 * /settings/billing, and both were refused by this very gate — so a lapsed
 * organisation saw a generic failure, could not read what it owed, and could
 * not pay it. The prefix covers /settings/billing/pay and /billing/verify;
 * those two are still admin-only, enforced by the route, because an ordinary
 * employee should not be able to spend the company's money.
 */
const BILLING_ALLOWED = [
  '/api/auth',
  '/api/support/tickets',
  '/api/branding',
  '/api/notifications',
  '/api/settings/subscription',
  '/api/settings/billing',
  '/api/health',
  '/api/ready',
];

/**
 * Stop an organisation whose trial or paid period has ended.
 *
 * The check reads the dates already loaded with the tenant, so it costs nothing
 * extra per request. Two deliberate limits:
 *
 *   - it is off until the platform team switches enforcement on, so nobody is
 *     locked out of a system whose prices have not been set;
 *   - `exempt` organisations are never touched, which is what every
 *     organisation that existed before billing arrived is marked as.
 *
 * The refusal carries a flag the screens use to show a "your access has paused"
 * page rather than a generic error, and it names the contact so somebody can
 * act on it without hunting for an email address.
 */
function enforceBilling(req) {
  const tenant = req.tenant;
  if (!tenant) return;

  const path = (req.originalUrl || '').split('?')[0];
  if (BILLING_ALLOWED.some((allowed) => path === allowed || path.startsWith(allowed + '/'))) return;

  // An organisation admin keeps read access so they can see the state of their
  // own account and reach the people who can restore it.
  //
  // The configured grace window, not the built-in default — this gate has to
  // block on the same day the banner, the sweep and the reminder emails all say
  // it will.
  const state = billingState(tenant, { graceDays: req.billingGraceDays });

  /*
   * An organisation already ON HOLD is refused whatever the enforcement flag
   * says. Being on hold is a decision that was taken, recorded and emailed
   * about; re-deciding it from the dates on every request would mean switching
   * enforcement off silently handed the product back to everyone it had been
   * withdrawn from. Recording a payment is what lifts it — see markPaid.
   *
   * They still reach the allow-list above, which is how they pay.
   */
  if (!heldForNonPayment(tenant)) {
    if (!state.blocked) return;
    if (!req.billingEnforced) return;
  }

  throw new ApiError(402, 'Your organisation\'s access is paused pending payment.', {
    billing_blocked: true,
    billing_state: state.state,
    ends_at: state.ends_at || null,
  });
}

/**
 * Decode the token (if any) and populate req.user/req.db without rejecting.
 * Used by endpoints (like auth/me) that must respond for both states.
 */
export const optionalAuth = asyncHandler(async (req, _res, next) => {
  const token = getBearer(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    req.auth = payload;
    if (payload.platform_admin) {
      req.isPlatformAdmin = true;
      req.master = masterDb();
      req.user = await loadLivePlatformAdmin(req, payload);
    } else {
      await attachTenantDb(req, payload.org_slug);
      req.user = await loadLiveUser(req, payload);
    }
  } catch {
    // Invalid/expired/revoked token → treated as unauthenticated here.
    req.auth = undefined;
    req.user = undefined;
    req.isPlatformAdmin = false;
  }
  next();
});

/**
 * Same live re-check for platform (vendor) admins, whose accounts live in the
 * master registry rather than a tenant DB. Their token id is `pa_<id>`.
 */
async function loadLivePlatformAdmin(req, payload) {
  const claimed = payload.user || {};
  const id = Number(String(claimed.id || '').replace(/^pa_/, ''));
  if (!id) throw unauthorized('Not authenticated');

  const [rows] = await req.master.execute(
    'SELECT id, name, email FROM platform_admins WHERE id = ? LIMIT 1',
    [id]
  );
  const row = rows[0];
  if (!row) throw unauthorized('Your account no longer exists.');

  return {
    id: `pa_${row.id}`,
    name: row.name,
    email: row.email,
    role: 'platform_admin',
    avatar_initials: claimed.avatar_initials || 'PA',
    points: 0,
  };
}

/** Hard auth guard — mirrors PHP requireAuth(). */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = getBearer(req);
  if (!token) throw unauthorized('Not authenticated');

  let payload;
  try {
    payload = verifyToken(token);
  } catch (e) {
    // PHP destroyed the idle session and returned {expired:true}; JWT expiry
    // is the direct analogue.
    if (e.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Session expired', { expired: true });
    }
    throw unauthorized('Not authenticated');
  }

  req.auth = payload;
  if (payload.platform_admin) {
    req.isPlatformAdmin = true;
    req.master = masterDb();
    req.user = await loadLivePlatformAdmin(req, payload);
    /*
     * A platform admin belongs to no organisation, so req.db is deliberately
     * never set for them. Any tenant-scoped route therefore reached the service
     * with an undefined connection and died with a TypeError, which surfaced as
     * an opaque 500 and a stack trace in the log.
     *
     * No data ever leaked - there was no database to read from - but "internal
     * server error" is the wrong answer to a request that is simply not for
     * this kind of account. Refuse it plainly instead.
     */
    const path = String(req.originalUrl || req.url || '').split('?')[0];

    /*
     * Two endpoints deliberately answer a platform admin with an empty or
     * default result instead of an error, because the shared app shell calls
     * them for whoever is signed in. That decision predates this guard and is
     * locked in by a test ("notification polling as a platform admin returns
     * empty, not 500"), so they are excluded here rather than overridden.
     * See notificationController for the reasoning.
     */
    const handlesMissingTenant = ['/api/notifications', '/api/branding'];
    const tenantFree = path.startsWith('/api/platform')
      || path.startsWith('/api/auth')
      || path === '/api/health' || path === '/api/ready'
      /*
       * The user manual. It opens no tenant database at all — it reads a PDF
       * from disk and picks WHICH one from the session role, and the platform
       * admin's own manual is one of the three. Refusing it here left the
       * vendor as the only account that could not download the document
       * describing the vendor console.
       */
      || path === '/api/export/user-guide'
      || handlesMissingTenant.some((p) => path.startsWith(p));

    if (!tenantFree) {
      return next(forbidden(
        'This is a platform administrator account. It has no organisation, so '
        + 'organisation screens are not available to it.'
      ));
    }
  } else {
    /*
     * Maintenance mode, for sessions that already exist.
     *
     * Checked before the tenant database is opened, because during maintenance
     * there may be nothing safe to open — a migration could be running against
     * it right now, which is the usual reason for switching this on.
     *
     * Logging out stays available. A tenant whose session is being refused
     * should be able to clear it and land on the sign-in screen, which is where
     * the maintenance notice is; leaving them holding a token that every other
     * endpoint rejects is a worse dead end than the one being prevented.
     */
    const p = String(req.originalUrl || req.url || '').split('?')[0];
    if (p !== '/api/auth/logout') {
      const m = await maintenanceStatus();
      if (m.enabled) return next(maintenanceError(m.message));
    }

    await attachTenantDb(req, payload.org_slug);
    // Authoritative role/status come from the DB, not the 8-hour-old token.
    req.user = await loadLiveUser(req, payload);
    // A user still on their temporary password may only change it.
    enforcePasswordChange(req);
    // And an organisation whose paid period has run out is paused, with a
    // message that says so rather than a generic refusal.
    enforceBilling(req);
  }
  next();
});

/** Role guard — mirrors PHP requireRole(...$roles). */
export const requireRole = (...roles) => [
  requireAuth,
  (req, _res, next) => {
    if (!roles.includes(req.user?.role)) return next(forbidden('Insufficient permissions'));
    next();
  },
];

/** Platform-admin guard — mirrors PHP requirePlatformAuth(). */
export const requirePlatformAuth = [
  requireAuth,
  (req, _res, next) => {
    if (!req.isPlatformAdmin) {
      return next(unauthorized('Not authenticated as platform admin'));
    }
    next();
  },
];

export default { optionalAuth, requireAuth, requireRole, requirePlatformAuth };
