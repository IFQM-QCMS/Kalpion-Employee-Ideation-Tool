/**
 * Authentication service — Node equivalent of PHP api/auth.php.
 *
 * Reproduces, identically:
 *   • brute-force lockout (5 fails → 15-min lock, per email|org identifier)
 *   • platform-admin-first login (ifqm_master.platform_admins), then tenant user
 *   • bcrypt password verification (PHP $2y$ hashes verify unchanged)
 *   • forgot / reset / check-reset-token password flows (bcrypt-hashed tokens)
 *
 * Differences (mandated by the session→JWT migration, documented):
 *   • The PHP session is replaced by a signed JWT returned as `token`.
 *   • CSRF tokens (a session artifact) are dropped — JWT travels in the
 *     Authorization header, so there is no ambient credential to forge.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { signToken } from '../utils/jwt.js';
import { masterDb } from '../database/master.js';
import { recordLogin } from './activityService.js';
import { resolveTenant, getTenantPool, sanitizeSlug } from '../database/tenant.js';
import { resolveTenantByLogin, indexUser, isEmail, normalizePhone } from './directoryService.js';
import { getOrgSettings, sendSmtpEmail } from './mailerService.js';
import { badRequest, unauthorized, tooMany, ApiError } from '../utils/respond.js';
import * as verification from './verificationService.js';
import logger from '../utils/logger.js';

// ── Brute-force lockout ──────────────────────────────────────────────────────
// Persisted in ifqm_master.login_attempts. This used to be a process-local Map,
// which meant the lockout reset on every restart or deploy (wait for a bounce
// and keep guessing), did not exist across a second worker, and grew without
// bound. Keyed per <email>|<org> so one account locks — not everyone sharing an
// office IP.
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 min

// If the master DB is unreachable we still must not let guessing run free, so
// fall back to an in-process counter for the life of the process.
const memoryAttempts = new Map();

async function getFailedAttempts(id) {
  try {
    const [rows] = await masterDb().execute(
      `SELECT attempts,
              GREATEST(0, TIMESTAMPDIFF(SECOND, NOW(), locked_until)) AS locked_for
         FROM login_attempts WHERE login_id = ? LIMIT 1`,
      [id]
    );
    const row = rows[0];
    if (!row) return { count: 0, locked_for: 0 };
    return { count: Number(row.attempts) || 0, locked_for: Number(row.locked_for) || 0 };
  } catch {
    const m = memoryAttempts.get(id) || { count: 0, locked_until: 0 };
    const left = m.locked_until - Math.floor(Date.now() / 1000);
    return { count: m.count, locked_for: Math.max(0, left) };
  }
}

async function recordFailedAttempt(id) {
  try {
    // NOTE: inside ON DUPLICATE KEY UPDATE, MySQL evaluates the assignments in
    // order, so `attempts` in the second expression is the value ALREADY
    // incremented by the first. Comparing `attempts + 1` here would therefore
    // count one too many and lock the account on the 4th failure while the user
    // was still being told "1 attempt remaining".
    await masterDb().execute(
      `INSERT INTO login_attempts (login_id, attempts, locked_until)
            VALUES (?, 1, NULL)
       ON DUPLICATE KEY UPDATE
            attempts     = attempts + 1,
            locked_until = IF(attempts >= ?, DATE_ADD(NOW(), INTERVAL ? SECOND), locked_until)`,
      [id, MAX_ATTEMPTS, LOCKOUT_SECONDS]
    );
  } catch {
    const m = memoryAttempts.get(id) || { count: 0, locked_until: 0 };
    m.count += 1;
    if (m.count >= MAX_ATTEMPTS) m.locked_until = Math.floor(Date.now() / 1000) + LOCKOUT_SECONDS;
    memoryAttempts.set(id, m);
  }
}

async function clearFailedAttempts(id) {
  try {
    await masterDb().execute('DELETE FROM login_attempts WHERE login_id = ?', [id]);
  } catch { /* best effort */ }
  memoryAttempts.delete(id);
}

/** First-letters-of-first-two-words initials (PHP array_map over name words). */
function initialsFrom(name) {
  return (
    String(name || '')
      .split(' ')
      .slice(0, 2)
      .map((w) => (w ? w[0].toUpperCase() : ''))
      .join('') || ''
  );
}

/**
 * Authenticate a user (platform admin or tenant user).
 * @returns {Promise<{ user: object, token: string }>}
 */
export async function login({ email, password, orgSlug, host, meta = {} }) {
  email = String(email || '').trim();
  // Deliberately NOT trimmed: the password must be compared exactly as the user
  // set it. Trimming here while storing it untrimmed would silently lock out
  // anyone whose password begins or ends with a space.
  password = String(password ?? '');
  const cleanSlug = sanitizeSlug(orgSlug);

  if (!email || !password) throw badRequest('Email and password are required.');

  const loginId = `${email.toLowerCase()}|${cleanSlug || 'default'}`;

  // Lockout check
  const attempts = await getFailedAttempts(loginId);
  if (attempts.locked_for > 0) {
    // A locked account being hammered is precisely what an operator wants to
    // see in the activity feed, so it is recorded rather than only thrown.
    recordLogin({
      actorType: 'tenant_user', actorEmail: email, tenantSlug: cleanSlug || null,
      outcome: 'lockout', ip: meta.ip, userAgent: meta.userAgent, timeZone: meta.timeZone,
    });
    throw tooMany(
      `Too many failed attempts. Please try again in ${Math.ceil(attempts.locked_for / 60)} minute(s).`,
      { retry_after: attempts.locked_for }
    );
  }

  // ── Try platform admin first (ifqm_master.platform_admins) ──
  try {
    const master = masterDb();
    const [rows] = await master.execute(
      'SELECT * FROM platform_admins WHERE email = ? LIMIT 1',
      [email]
    );
    const pa = rows[0];
    if (pa) {
      const passwordOk = await bcrypt.compare(password, pa.password_hash);
      if (passwordOk) {
        const session = {
          id: `pa_${pa.id}`,
          name: pa.name,
          email: pa.email,
          role: 'platform_admin',
          avatar_initials: initialsFrom(pa.name) || 'PA',
          points: 0,
        };
        await clearFailedAttempts(loginId);
        const token = signToken({ user: session, platform_admin: true });
        logger.info(`auth: platform admin login ok (${email})`);
        recordLogin({
          actorType: 'platform_admin', actorId: pa.id, actorName: pa.name,
          actorEmail: pa.email, outcome: 'success', ip: meta.ip, userAgent: meta.userAgent, timeZone: meta.timeZone,
        });
        return { user: session, token };
      } else {
        await recordFailedAttempt(loginId);
        const after = await getFailedAttempts(loginId);
        const remaining = Math.max(0, MAX_ATTEMPTS - after.count);
        logger.warn(`auth: failed platform admin login for ${email} (${after.count}/${MAX_ATTEMPTS})`);
        recordLogin({
          actorType: 'platform_admin', actorId: pa.id, actorName: pa.name,
          actorEmail: pa.email, outcome: remaining > 0 ? 'failure' : 'lockout',
          ip: meta.ip, userAgent: meta.userAgent, timeZone: meta.timeZone,
        });
        throw unauthorized(
          remaining > 0
            ? `Invalid email or password. ${remaining} attempt(s) remaining.`
            : 'Too many failed attempts. Please try again in 15 minutes.'
        );
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    logger.warn('platform_admins lookup skipped', e.message);
  }

  // ── Tenant user auth ──
  // The organisation code is optional now. With one, we open exactly that
  // organisation's database (an explicit assertion — see resolveTenant). Without
  // one, we identify the organisation from the login itself: the email, or the
  // registered phone number, resolved through the global login directory.
  const tenant = cleanSlug
    ? await resolveTenant({ slug: cleanSlug, host })
    : await resolveTenantByLogin(email);

  // The identifier matched no organisation. Answer exactly like a wrong password
  // — a dummy compare for constant time, a counted failure, one generic message
  // — so login never reveals which emails or numbers are registered.
  if (!tenant) {
    await bcrypt.compare(password, DUMMY_HASH);
    await recordFailedAttempt(loginId);
    recordLogin({
      actorType: 'tenant_user', actorEmail: email, tenantSlug: cleanSlug || null,
      outcome: 'failure', ip: meta.ip, userAgent: meta.userAgent, timeZone: meta.timeZone,
    });
    const after = await getFailedAttempts(loginId);
    const remaining = Math.max(0, MAX_ATTEMPTS - after.count);
    throw unauthorized(
      remaining > 0
        ? `Invalid email/phone or password. ${remaining} attempt(s) remaining.`
        : 'Too many failed attempts. Please try again in 15 minutes.'
    );
  }

  const db = getTenantPool(tenant);

  // Match on email OR phone, whichever the person typed. Phones are stored in
  // assorted formats, so compare on digits only (last-10 suffix).
  const base =
    `SELECT u.*, UNIX_TIMESTAMP(u.password_changed_at) AS password_changed_ts,
            m.name AS manager_name
       FROM users u
       LEFT JOIN users m ON m.id = u.manager_id
      WHERE `;
  const phoneKey = normalizePhone(email);
  let where; let params;
  if (!isEmail(email) && phoneKey) {
    where = "REPLACE(REPLACE(REPLACE(REPLACE(u.phone,' ',''),'-',''),'+',''),'(','') LIKE ?";
    params = [`%${phoneKey}`];
  } else {
    where = 'LOWER(u.email) = ?';
    params = [email.toLowerCase()];
  }
  const [rows] = await db.execute(`${base}${where} AND u.status = 'active' LIMIT 1`, params);
  const user = rows[0];

  // Always run the compare, even when the email matched nothing — against a
  // burned dummy hash. Short-circuiting on !user answered "no such account" in
  // ~5ms and "wrong password" in ~250ms, so response time alone enumerated
  // which emails exist in an organisation.
  const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk) {
    await recordFailedAttempt(loginId);
    const after = await getFailedAttempts(loginId);
    const remaining = Math.max(0, MAX_ATTEMPTS - after.count);
    logger.warn(`auth: failed login for ${loginId} (${after.count}/${MAX_ATTEMPTS})`);
    recordLogin({
      actorType: 'tenant_user', actorId: user?.id ?? null,
      actorName: user?.name ?? (email ? email.split('@')[0] : 'User'),
      actorEmail: email, tenantId: tenant?.id || null, tenantSlug: tenant?.slug || cleanSlug || null,
      outcome: remaining > 0 ? 'failure' : 'lockout', ip: meta.ip, userAgent: meta.userAgent, timeZone: meta.timeZone,
    });
    const err =
      remaining > 0
        ? `Invalid email/phone or password. ${remaining} attempt(s) remaining.`
        : 'Too many failed attempts. Please try again in 15 minutes.';
    throw unauthorized(err);
  }

  const session = {
    id: user.id,
    employee_id: user.employee_id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    department: user.department,
    business_unit: user.business_unit,
    location: user.location,
    role: user.role,
    manager_id: user.manager_id,
    manager_name: user.manager_name,
    points: user.points,
    avatar_initials: user.avatar_initials || (user.name || '').charAt(0).toUpperCase(),
    // Bulk-imported employees sign in with a derived temporary password and can
    // do nothing else until they replace it (enforced server-side in the auth
    // middleware). The flag rides along so the UI can show the change screen
    // immediately rather than bouncing off a 403.
    must_change_password: !!user.must_change_password,
    org_name: tenant.name,
    org_slug: tenant.slug,
  };

  await clearFailedAttempts(loginId);
  // Keep the login directory current (and self-heal it for a pre-existing user
  // who was resolved by the tenant scan rather than a directory row).
  indexUser(tenant, user).catch(() => {});
  // Stamp the organisation's last sign-in so the platform console can report
  // which orgs have gone quiet. Best-effort and fire-and-forget: an activity
  // metric must never be able to fail a login. Tenant id 0 is the built-in
  // fallback tenant, which has no registry row to update.
  if (tenant.id) {
    masterDb()
      .execute('UPDATE tenants SET last_login_at = NOW() WHERE id = ?', [tenant.id])
      .catch((e) => logger.warn('tenant last_login_at update failed', e.message));
  }
  const token = signToken({
    user: session,
    org_slug: tenant.slug,
    pwd_ts: Number(user.password_changed_ts) || 0,
  });
  logger.info(`auth: login ok (${email} @ ${tenant.slug})`);
  recordLogin({
    actorType: 'tenant_user', actorId: user.id, actorName: user.name, actorEmail: user.email,
    tenantId: tenant.id || null, tenantSlug: tenant.slug, outcome: 'success',
    ip: meta.ip, userAgent: meta.userAgent, timeZone: meta.timeZone,
  });
  return { user: session, token };
}

/**
 * Forgot-password: always returns a generic success (anti-enumeration).
 * Emails a reset link only when SMTP is enabled/configured.
 */
export async function forgotPassword({ email, orgSlug, host }) {
  email = String(email || '').trim().toLowerCase();
  const cleanSlug = sanitizeSlug(orgSlug);
  if (!email) throw badRequest('Email is required.');

  const generic = {
    success: true,
    message: 'If an account with that email exists, a reset link has been sent.',
  };

  // Resolve the organisation from the email itself when no org code was given.
  const tenant = cleanSlug
    ? await resolveTenant({ slug: cleanSlug, host })
    : await resolveTenantByLogin(email);
  if (!tenant) return generic; // unknown email → same generic answer (no enumeration)
  const db = getTenantPool(tenant);

  const [rows] = await db.execute(
    "SELECT id, name FROM users WHERE LOWER(email) = ? AND status = 'active' LIMIT 1",
    [email]
  );
  const user = rows[0];
  if (!user) return generic;

  // Invalidate existing tokens, then issue a new one (1h TTL).
  await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);

  // Split token: <selector>.<verifier>. The selector is an indexed lookup so we
  // run exactly ONE bcrypt compare. Previously verification bcrypt-compared the
  // candidate against every unexpired row in the table, which let anyone burn
  // arbitrary CPU by posting junk tokens.
  const { token, selector, verifierHash } = await makeResetToken();
  const expiresAt = new Date(Date.now() + 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  await db.execute(
    'INSERT INTO password_reset_tokens (user_id, selector, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [user.id, selector, verifierHash, expiresAt]
  );

  try {
    const base = config.frontendBaseUrl.replace(/\/+$/, '');
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}&org=${encodeURIComponent(tenant.slug)}`;
    const subject = 'Reset Your IFQM Password';
    const htmlBody =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
      '<body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1e293b;line-height:1.6">' +
      '<h2 style="color:#4f46e5;margin-top:0">IFQM – Password Reset Request</h2>' +
      `<p>Hi ${escapeHtml(user.name)},</p>` +
      '<p>We received a request to reset your IFQM account password. Click the button below to set a new password. This link expires in 1 hour.</p>' +
      `<p style="margin:24px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px">Reset Password</a></p>` +
      '<p style="color:#64748b;font-size:12px">If you did not request this, you can safely ignore this email. The link will expire automatically.</p>' +
      '</body></html>';

    const { sendViaPlatform } = await import('./mailerService.js');
    await sendViaPlatform(email, user.name, subject, htmlBody);
    logger.info(`auth: password reset email sent to ${email} @ ${tenant.slug}`);
  } catch (e) {
    logger.error('Password reset email error', e.message);
  }

  return generic;
}

/** Reset password given a valid, unexpired token. */
/*
 * ── Resetting a password with a code instead of a link ─────────────────────
 *
 * The emailed link still works and is unchanged. This exists because a link is
 * useless to the people most likely to need it: somebody whose work address is
 * the account they cannot get into, somebody on a phone with no access to that
 * mailbox, somebody at a plant with a shared terminal. A code sent to their own
 * mobile reaches them where they are.
 *
 * It deliberately ends in the SAME place the emailed link does — a row in
 * password_reset_tokens, redeemed by the existing /auth/reset-password. One way
 * to actually set a password, two ways to earn the right to.
 */
export async function requestPasswordResetCode({ identifier, meta = {} } = {}) {
  const generic = {
    success: true,
    message: 'If that is registered with us, a code has been sent to it.',
  };
  const { key, channel } = verification.classify(identifier);
  if (!key) throw badRequest('Enter your registered email address or mobile number.');

  // Same anti-enumeration rule as forgotPassword: an unknown identifier gets
  // the identical answer, so this cannot be used to test who has an account.
  const tenant = await resolveTenantByLogin(key);
  if (!tenant) return generic;

  let user = null;
  try {
    const db = getTenantPool(tenant);
    const [[u] = []] = channel === 'email'
      ? await db.execute("SELECT id, name, email FROM users WHERE LOWER(email) = ? AND status = 'active' LIMIT 1", [key])
      : await db.execute(
        "SELECT id, name, email FROM users WHERE status = 'active' "
        + "AND REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+','') LIKE ? LIMIT 1", [`%${key}`]
      );
    user = u || null;
  } catch (e) {
    logger.warn('auth: reset-code lookup failed', e.message);
  }
  if (!user) return generic;

  await verification.sendCode({
    identifier: key,
    purpose: 'password_reset',
    name: user.name,
    tenantSlug: tenant.slug,
    userId: user.id,
    ip: meta.ip,
  });
  return generic;
}

/**
 * Exchange a correct code for a reset token.
 *
 * The token is short-lived and single-use exactly like the emailed one, and
 * every other outstanding token for the account is burned first — so a reset
 * begun by somebody who should not have started one cannot be finished later.
 */
export async function verifyPasswordResetCode({ identifier, code } = {}) {
  const { row } = await verification.verifyCode({ identifier, code, purpose: 'password_reset' });
  if (!row?.tenant_slug || !row?.user_id) {
    throw badRequest('That code cannot be used to reset a password. Ask for a new one.');
  }

  const tenant = await resolveTenant({ slug: row.tenant_slug });
  const db = getTenantPool(tenant);
  const [[user] = []] = await db.execute(
    "SELECT id, name FROM users WHERE id = ? AND status = 'active' LIMIT 1", [row.user_id]
  );
  if (!user) throw unauthorized('That account is no longer active.');

  await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
  const { token, selector, verifierHash } = await makeResetToken();
  const expiresAt = new Date(Date.now() + 900 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  await db.execute(
    'INSERT INTO password_reset_tokens (user_id, selector, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [user.id, selector, verifierHash, expiresAt]
  );

  logger.info(`auth: reset code accepted for user ${user.id} @ ${tenant.slug}`);
  return {
    success: true,
    verified: true,
    // Fifteen minutes, not the hour an emailed link gets: the person is holding
    // the code and finishing now, so there is no reason to leave it lying open.
    token,
    org_slug: tenant.slug,
    expires_in: 900,
    message: 'Code accepted. Choose a new password.',
  };
}

export async function resetPassword({ token, password, orgSlug, host }) {
  token = String(token || '');
  password = String(password || '');
  const cleanSlug = sanitizeSlug(orgSlug);

  if (!token || !password) throw badRequest('Token and new password are required.');
  assertPasswordStrength(password);

  const tenant = await resolveTenant({ slug: cleanSlug, host });
  const db = getTenantPool(tenant);

  const matched = await findResetToken(db, token);
  if (!matched) throw badRequest('Invalid or expired reset link. Please request a new one.');

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Stamping password_changed_at is what actually kills the old sessions: the
  // auth middleware rejects any JWT issued before this moment. Without it, a
  // stolen token stayed usable for the rest of its 8-hour life even after the
  // victim reset their password.
  await db.execute(
    'UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?',
    [hash, matched.user_id]
  );
  // Burn every outstanding reset token for this user, not just the one used.
  await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [matched.user_id]);

  logger.info(`auth: password reset completed for user ${matched.user_id} @ ${tenant.slug}`);
  return { success: true, message: 'Password updated successfully. Please log in with your new password.' };
}

/** Check whether a reset token is still valid. */
export async function checkResetToken({ token, orgSlug, host }) {
  token = String(token || '');
  if (!token) throw badRequest('Token required.');
  const cleanSlug = sanitizeSlug(orgSlug);

  const tenant = await resolveTenant({ slug: cleanSlug, host });
  const db = getTenantPool(tenant);

  const matched = await findResetToken(db, token);
  return { success: true, valid: !!matched };
}

/**
 * Change the password of the signed-in user.
 *
 * Used both for a normal voluntary change and for the forced change that a
 * bulk-imported employee must complete on first login.
 *
 * Returns a FRESH token. Stamping password_changed_at is what revokes tokens
 * issued before the change — including the one the caller is holding right now —
 * so without reissuing here the user would be logged out by the very act of
 * securing their account.
 */
export async function changePassword(db, user, { currentPassword, newPassword, orgSlug }) {
  currentPassword = String(currentPassword ?? '');
  newPassword = String(newPassword ?? '');

  if (!currentPassword || !newPassword) {
    throw badRequest('Current and new password are required.');
  }

  const [rows] = await db.execute(
    'SELECT id, password_hash, must_change_password FROM users WHERE id = ? AND status = \'active\' LIMIT 1',
    [user.id]
  );
  const row = rows[0];
  if (!row) throw unauthorized('Your account is no longer active.');

  // Verify the current password even during a forced change: possession of a
  // token alone must not be enough to overwrite the credential.
  if (!(await bcrypt.compare(currentPassword, row.password_hash))) {
    throw badRequest('Your current password is incorrect.');
  }

  // The new password gets the full policy — the temporary one was exempt
  // precisely because it was temporary.
  assertPasswordStrength(newPassword, { label: 'New password' });

  if (await bcrypt.compare(newPassword, row.password_hash)) {
    throw badRequest('The new password must be different from your current one.');
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db.execute(
    `UPDATE users
        SET password_hash = ?, password_changed_at = NOW(), must_change_password = 0,
            activated_at = COALESCE(activated_at, NOW())
      WHERE id = ?`,
    [hash, user.id]
  );

  // Read the stamp back rather than assuming what NOW() produced — this value
  // must match the row exactly or the fresh token below would be rejected by
  // the middleware as stale.
  const [after] = await db.execute(
    'SELECT UNIX_TIMESTAMP(password_changed_at) AS pwd_ts FROM users WHERE id = ?',
    [user.id]
  );
  const pwdTs = Number(after[0]?.pwd_ts) || 0;

  logger.info(`auth: password changed for user ${user.id}`);

  // Reissue. The stamp above invalidated every token issued earlier — including
  // the one the caller used to make this request — so without a fresh token the
  // user would be logged out by the very act of securing their account.
  const session = { ...user, must_change_password: false };
  const token = signToken({ user: session, org_slug: orgSlug || user.org_slug, pwd_ts: pwdTs });

  return { success: true, message: 'Password updated.', token, user: session };
}

// ── Reset-token helpers ─────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12; // ~250ms; was 10

// A real hash of nothing anyone knows, used to keep the compare running when
// the email matched no account (see login). Module-load cost, paid once.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

/** Mint a `<selector>.<verifier>` reset token. Only the verifier is hashed. */
async function makeResetToken() {
  const selector = crypto.randomBytes(16).toString('hex'); // 32 chars, indexed
  const verifier = crypto.randomBytes(32).toString('hex'); // the actual secret
  return {
    token: `${selector}.${verifier}`,
    selector,
    verifierHash: await bcrypt.hash(verifier, BCRYPT_ROUNDS),
  };
}

/** Look a token up by selector (one indexed row → one bcrypt compare). */
async function findResetToken(db, token) {
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const selector = token.slice(0, dot);
  const verifier = token.slice(dot + 1);
  if (!/^[a-f0-9]{32}$/.test(selector) || !verifier) return null;

  const [rows] = await db.execute(
    'SELECT id, user_id, token_hash FROM password_reset_tokens WHERE selector = ? AND expires_at > NOW() LIMIT 1',
    [selector]
  );
  const row = rows[0];
  if (!row) return null;
  return (await bcrypt.compare(verifier, row.token_hash)) ? row : null;
}

/**
 * One password policy for every path that sets a password (self-service reset,
 * admin-created accounts, new tenant admins). Length is the control that
 * actually matters (NIST SP 800-63B); we additionally reject the handful of
 * passwords that show up first in every credential-stuffing list.
 */
const WORST_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'welcome123', 'admin123', 'iloveyou', 'changeme',
  'ifqm1234', 'ifqm@1234', 'passw0rd', 'p@ssw0rd', 'administrator',
]);

export function assertPasswordStrength(password, { label = 'Password' } = {}) {
  const pw = String(password ?? '');
  const min = config.minPasswordLength;

  if (pw.length < min) throw badRequest(`${label} must be at least ${min} characters.`);
  if (pw.length > 200) throw badRequest(`${label} is too long (max 200 characters).`);
  if (WORST_PASSWORDS.has(pw.toLowerCase())) {
    throw badRequest(`${label} is one of the most commonly guessed passwords. Choose another.`);
  }
  if (/^(.)\1+$/.test(pw)) throw badRequest(`${label} cannot be a single repeated character.`);
  return pw;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c])
  );
}

export default {
  login, forgotPassword, resetPassword, checkResetToken, changePassword, assertPasswordStrength,
  requestPasswordResetCode, verifyPasswordResetCode,
};
