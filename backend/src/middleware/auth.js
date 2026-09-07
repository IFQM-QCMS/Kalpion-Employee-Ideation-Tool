/** Authentication & authorization middleware. */
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

// How long the two billing settings below are held before being re-read.
const SETTING_CACHE_MS = config.env === 'test' ? 0 : 60000;

// Whether lapsed organisations are actually blocked.
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

// How many days past the due date before access is actually withdrawn.
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
  // MOM §8.3/§8.5 - meter the request against this organisation's quota.
  await meterTenantRequest(req);
  req.billingEnforced = await billingEnforced();
  req.billingGraceDays = await billingGraceDays();
}

/** Re-check the session against the database on every request. */
async function loadLiveUser(req, payload) {
  const claimed = payload.user || {};
  const [rows] = await req.db.execute(
    // UNIX_TIMESTAMP() is resolved by MySQL in its own timezone.
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

  // Tokens issued before the last password change are dead.
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
    role: row.role,            // authoritative - never the role baked into the token
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

/** Endpoints a user still holding a temporary password is allowed to reach. */
const PASSWORD_CHANGE_ALLOWED = [
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/me',
  // Support stays reachable on a temporary password - deliberately.
  '/api/support/tickets',
];

/*
 * A newly onboarded employee starts on a temporary password: a random one that was emailed
 * to them, or - when there is no address to email - the derived formula "yash5881", the
 * first 4 letters of the name plus the last 4 digits of the phone number.
 */
function enforcePasswordChange(req) {
  if (!req.user?.must_change_password) return;
  const path = (req.originalUrl || '').split('?')[0];
  if (PASSWORD_CHANGE_ALLOWED.some((p) => path === p || path.startsWith(p + '/'))) return;

  throw new ApiError(403, 'You must set a new password before continuing.', {
    must_change_password: true,
  });
}

/** What a lapsed organisation may still reach. */
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

/** Stop an organisation whose trial or paid period has ended. */
function enforceBilling(req) {
  const tenant = req.tenant;
  if (!tenant) return;

  const path = (req.originalUrl || '').split('?')[0];
  if (BILLING_ALLOWED.some((allowed) => path === allowed || path.startsWith(allowed + '/'))) return;

  // An organisation admin keeps read access so they can see the state of their own account
  // and reach the people who can restore it.
  const state = billingState(tenant, { graceDays: req.billingGraceDays });

  // An organisation already ON HOLD is refused whatever the enforcement flag says.
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

/** Decode the token (if any) and populate req.user/req.db without rejecting. */
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
    // Invalid/expired/revoked token treated as unauthenticated here.
    req.auth = undefined;
    req.user = undefined;
    req.isPlatformAdmin = false;
  }
  next();
});

/*
 * Same live re-check for platform (vendor) admins, whose accounts live in the master
 * registry rather than a tenant DB.
 */
async function loadLivePlatformAdmin(req, payload) {
  const claimed = payload.user || {};
  const id = Number(String(claimed.id || '').replace(/^pa_/, ''));
  if (!id) throw unauthorized('Not authenticated');

  // Read fresh on every request, not taken from the token.
  const [rows] = await req.master.execute(
    `SELECT id, name, email, phone, email_verified_at, phone_verified_at
       FROM platform_admins WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw unauthorized('Your account no longer exists.');

  const pending = [];
  if (!row.email_verified_at) pending.push('email');
  if (!row.phone_verified_at) pending.push('phone');

  return {
    id: `pa_${row.id}`,
    name: row.name,
    email: row.email,
    role: 'platform_admin',
    avatar_initials: claimed.avatar_initials || 'PA',
    points: 0,
    ...(pending.length ? { must_verify: true, pending_verification: pending } : {}),
  };
}

/** What an unverified platform admin may reach. */
const PLATFORM_VERIFY_ALLOWED = [
  '/api/auth/platform/verify',
  '/api/auth/me',
  '/api/auth/logout',
];

/** A platform admin who has not proved both channels may only prove them. */
function enforcePlatformAdminVerification(req) {
  if (!req.user?.must_verify) return;
  const path = (req.originalUrl || '').split('?')[0];
  if (PLATFORM_VERIFY_ALLOWED.some((p) => path === p || path.startsWith(p + '/'))) return;

  throw new ApiError(403,
    'Verify your email address and mobile number before using the console.', {
      must_verify: true,
      pending_verification: req.user.pending_verification,
    });
}

/** Hard auth guard - mirrors PHP requireAuth(). */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = getBearer(req);
  if (!token) throw unauthorized('Not authenticated');

  let payload;
  try {
    payload = verifyToken(token);
  } catch (e) {
    // PHP destroyed the idle session and returned {expired:true}; JWT expiry is the direct
    // analogue.
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
    // An account that has not proved both channels may only prove them.
    enforcePlatformAdminVerification(req);
    // A platform admin belongs to no organisation, so req.db is deliberately never set for
    // them.
    const path = String(req.originalUrl || req.url || '').split('?')[0];

    // Two endpoints deliberately answer a platform admin with an empty or default result
    // instead of an error, because the shared app shell calls them for whoever is signed in.
    const handlesMissingTenant = ['/api/notifications', '/api/branding'];
    const tenantFree = path.startsWith('/api/platform')
      || path.startsWith('/api/auth')
      || path === '/api/health' || path === '/api/ready'
      // The user manual. It opens no tenant database at all - it reads a PDF from disk and picks
      // WHICH one from the session role, and the platform admin's own manual is one of the
      // three.
      || path === '/api/export/user-guide'
      || handlesMissingTenant.some((p) => path.startsWith(p));

    if (!tenantFree) {
      return next(forbidden(
        'This is a platform administrator account. It has no organisation, so '
        + 'organisation screens are not available to it.'
      ));
    }
  } else {
    // Maintenance mode, for sessions that already exist.
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
    // And an organisation whose paid period has run out is paused, with a message that says so
    // rather than a generic refusal.
    enforceBilling(req);
  }
  next();
});

/** Role guard - mirrors PHP requireRole(...$roles). */
export const requireRole = (...roles) => [
  requireAuth,
  (req, _res, next) => {
    if (!roles.includes(req.user?.role)) return next(forbidden('Insufficient permissions'));
    next();
  },
];

/** Platform-admin guard - mirrors PHP requirePlatformAuth(). */
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
