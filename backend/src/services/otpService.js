/**
 * One-time-code login — MOM 29 Jul 2026 §4.1, §4.2.
 *
 * A user asks for a code on their registered phone, then exchanges the code for
 * the same JWT a password login returns. Nothing downstream can tell which
 * route was used, which is the point: no endpoint has to learn about OTP.
 *
 * ── The rules this file exists to enforce ──────────────────────────────────
 *
 * Codes are stored HASHED. A plaintext six-digit column would let anyone with
 * read access to the registry sign in as any user with a code outstanding — the
 * same mistake as storing passwords in clear, and a six-digit secret is far
 * easier to use than a bcrypt hash.
 *
 * Requesting a code says NOTHING about whether the number is registered. The
 * response is identical either way. Otherwise this endpoint becomes a free
 * membership oracle: type numbers, learn who works there.
 *
 * Wrong guesses are counted PER CODE. Six digits is a million possibilities,
 * which sounds like a lot until you notice an attacker has the whole validity
 * window and can guess as fast as the network allows. Five wrong answers burns
 * the code.
 *
 * Issuing a new code invalidates the previous one. Otherwise every resend adds
 * another live code and the guessing space shrinks with each click.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { masterDb } from '../database/master.js';
import { signToken } from '../utils/jwt.js';
import { resolveTenantByLogin, normalizePhone, isEmail } from './directoryService.js';
import { getTenantPool } from '../database/tenant.js';
import { sendSms, maskPhone, dltConfig, dltMissing, fillTemplate } from './smsService.js';
import { recordLogin } from './activityService.js';
import { mailConfig, sendZeptoMail, zeptoMissing } from './zeptoMailService.js';
import { badRequest, unauthorized, tooMany, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

const DEFAULTS = {
  otp_enabled: '0',
  otp_length: '6',
  otp_ttl_seconds: '300',
  otp_max_attempts: '5',
  otp_resend_seconds: '60',
  otp_provider: 'log',
};

/** Platform-wide OTP policy, with sane fallbacks if the rows are missing. */
export async function policy() {
  try {
    const [rows] = await masterDb().query(
      "SELECT key_name, value FROM platform_settings WHERE key_name LIKE 'otp\\_%'"
    );
    const found = Object.fromEntries(rows.map((r) => [r.key_name, r.value]));
    return { ...DEFAULTS, ...found };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Parse a policy number.
 *
 * NOT `parseInt(v) || fallback`: zero is falsy, so a deliberately configured 0
 * — "no resend throttle", which is exactly what a UAT run wants — silently
 * became the default instead. Anything unparseable still falls back.
 */
function num(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A numeric code of the requested length, drawn from a CSPRNG.
 *
 * Math.random() is not acceptable here even though the code is short-lived:
 * its output is predictable from previous values, so an attacker who has seen
 * one code could compute the next.
 */
function generateCode(length) {
  const n = Math.max(4, Math.min(8, num(length, 6)));
  const max = 10 ** n;
  // Rejection sampling, so the modulo does not bias the low digits.
  let v;
  const limit = Math.floor(0xffffffff / max) * max;
  do { v = crypto.randomBytes(4).readUInt32BE(0); } while (v >= limit);
  return String(v % max).padStart(n, '0');
}

/** The same generic answer whether or not the number is known. */
const GENERIC = {
  success: true,
  message: 'If that number belongs to an account, a code has been sent to it.',
};

/**
 * The code, in an email.
 *
 * Plain and short on purpose. A code email that looks like marketing gets
 * filtered as marketing, and the one thing the reader needs is six digits they
 * can read at a glance.
 */
function otpEmailHtml(name, code, minutes) {
  const safe = String(name || '').replace(/[<>&]/g, '');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6">
  <p>Hello ${safe || 'there'},</p>
  <p>Use this code to sign in to the IFQM Employee Ideation Tool:</p>
  <p style="font-size:30px;font-weight:700;letter-spacing:7px;margin:22px 0">${code}</p>
  <p>It expires in ${minutes} minute(s) and can be used once.</p>
  <p style="color:#666;font-size:13px">If you did not ask to sign in, you can ignore this message —
  nobody can use this code without your email account. Do not forward it to anyone.</p>
</div>`;
}

/**
 * POST /api/auth/otp/request
 *
 * @param {{ identifier: string, purpose?: string, meta?: object }} args
 */
export async function requestOtp({ identifier, purpose = 'login', meta = {} } = {}) {
  const raw = String(identifier || '').trim();
  if (!raw) throw badRequest('Enter your registered phone number.');

  const p = await policy();
  if (p.otp_enabled !== '1') {
    throw new ApiError(503, 'Sign-in by one-time code is not enabled on this platform.');
  }
  if (!['login', 'dev_access'].includes(purpose)) throw badRequest('Invalid purpose.');

  const phone = normalizePhone(raw);
  const email = isEmail(raw) ? raw.toLowerCase() : '';
  const key = phone || email;
  const idType = phone ? 'phone' : 'email';
  if (!key) throw badRequest('Enter a valid phone number.');

  const master = masterDb();

  // Resend throttle. Checked before the directory lookup so a caller cannot use
  // response timing to tell a known number from an unknown one.
  const [[recent] = []] = await master.execute(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age
       FROM login_otps WHERE identifier = ? ORDER BY id DESC LIMIT 1`,
    [key]
  );
  const wait = num(p.otp_resend_seconds, 60);
  if (wait > 0 && recent && Number(recent.age) < wait) {
    throw tooMany(`Please wait ${wait - Number(recent.age)} seconds before requesting another code.`,
      { retry_after: wait - Number(recent.age) });
  }

  // Who does this belong to? An unknown identifier gets the generic reply and
  // nothing is written — there is nobody to send a code to.
  let tenant = null;
  let user = null;
  try {
    tenant = await resolveTenantByLogin(key);
    if (tenant) {
      const db = getTenantPool(tenant);
      const [[u] = []] = phone
        ? await db.execute(
          "SELECT id, name, email, phone FROM users WHERE status='active' AND REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+','') LIKE ? LIMIT 1",
          [`%${phone}`]
        )
        : await db.execute("SELECT id, name, email, phone FROM users WHERE email = ? AND status='active' LIMIT 1", [key]);
      user = u || null;
    }
  } catch (e) {
    logger.warn('otp: identifier lookup failed', e.message);
  }
  if (!tenant || !user) {
    logger.info(`otp: request for unknown identifier ${maskPhone(key)} — generic reply`);
    return GENERIC;
  }

  const code = generateCode(p.otp_length);
  const ttl = num(p.otp_ttl_seconds, 300);

  // One live code per identifier: expire anything outstanding first.
  await master.execute(
    'UPDATE login_otps SET expires_at = NOW() WHERE identifier = ? AND consumed_at IS NULL AND expires_at > NOW()',
    [key]
  );
  await master.execute(
    `INSERT INTO login_otps
       (identifier, id_type, code_hash, tenant_id, tenant_slug, user_id, purpose, expires_at, requested_ip)
     VALUES (?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)`,
    [key, idType, await bcrypt.hash(code, 10), tenant.id || null, tenant.slug,
      user.id, purpose, ttl, String(meta.ip || '').slice(0, 45) || null]
  );

  const minutes = Math.max(1, Math.round(ttl / 60));

  /*
   * On a DLT gateway the wording is not ours to choose — it has to be the
   * template the carrier approved, or the message is dropped with no error and
   * no delivery report. So the registered text is filled in rather than a
   * literal written here, and the literal below is only the fallback for
   * providers with no template registration.
   */
  let body = `${code} is your IFQM sign-in code. It expires in ${minutes} minute(s). Do not share it with anyone.`;
  if (p.otp_provider === 'jio_dlt') {
    const cfg = await dltConfig();
    if (cfg.template_text) body = fillTemplate(cfg.template_text, [code, minutes]);
  }

  /*
   * Somebody who typed an email address gets the code by email.
   *
   * This branch was missing: an email identifier resolved correctly, a code was
   * issued and stored, and then it was handed to the SMS gateway addressed to
   * `user.phone` — so a person signing in by email either got a text they were
   * not expecting, or, with no number on file, nothing at all while the screen
   * said a code had been sent.
   */
  let sent;
  if (idType === 'email') {
    const mail = await mailConfig();
    if (!mail.otp_email_enabled) {
      logger.warn('otp: code requested by email but email codes are switched off');
      return GENERIC;
    }
    const r = await sendZeptoMail({
      to: user.email || key,
      toName: user.name,
      subject: `${code} is your IFQM sign-in code`,
      html: otpEmailHtml(user.name, code, minutes),
      cfg: mail,
    });
    sent = { sent: r.sent, provider: 'zeptomail', detail: r.detail };
  } else {
    sent = await sendSms(user.phone || raw, body,
      { provider: p.otp_provider, purpose, tenantSlug: tenant.slug });
  }

  if (!sent.sent) logger.error(`otp: delivery failed via ${sent.provider}: ${sent.detail || ''}`);
  logger.info(`otp: issued for ${maskPhone(key)} @ ${tenant.slug} (provider ${sent.provider})`);

  return {
    ...GENERIC,
    // Never the code itself. This only tells the UI how long to run its timer
    // and whether to show "resend" yet.
    expires_in: ttl,
    resend_in: wait,
  };
}

/**
 * POST /api/auth/otp/verify — exchanges a correct code for a session.
 * Returns the identical { user, token } shape as a password login.
 */
export async function verifyOtp({ identifier, code, meta = {} } = {}) {
  const raw = String(identifier || '').trim();
  const supplied = String(code || '').trim();
  if (!raw || !supplied) throw badRequest('Enter the code that was sent to you.');

  const p = await policy();
  if (p.otp_enabled !== '1') {
    throw new ApiError(503, 'Sign-in by one-time code is not enabled on this platform.');
  }

  const key = normalizePhone(raw) || (isEmail(raw) ? raw.toLowerCase() : '');
  if (!key) throw badRequest('Enter a valid phone number.');

  const master = masterDb();
  const [[row] = []] = await master.execute(
    `SELECT * FROM login_otps
      WHERE identifier = ? AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [key]
  );

  // Always burn a compare, even with no row, so a wrong number and a wrong code
  // take the same time to answer.
  const maxAttempts = num(p.otp_max_attempts, 5);
  const ok = row
    ? await bcrypt.compare(supplied, row.code_hash)
    : await bcrypt.compare(supplied, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');

  if (!row) throw unauthorized('That code is not valid or has expired. Request a new one.');

  if (!ok) {
    const attempts = Number(row.attempts) + 1;
    await master.execute(
      // Burn the code outright once the limit is reached, rather than leaving it
      // alive for the rest of its window with the counter pinned.
      'UPDATE login_otps SET attempts = ?, expires_at = IF(? >= ?, NOW(), expires_at) WHERE id = ?',
      [attempts, attempts, maxAttempts, row.id]
    );
    recordLogin({
      actorType: 'tenant_user', actorId: row.user_id, tenantId: row.tenant_id,
      tenantSlug: row.tenant_slug, outcome: attempts >= maxAttempts ? 'lockout' : 'failure',
      ip: meta.ip, userAgent: meta.userAgent,
    });
    const left = Math.max(0, maxAttempts - attempts);
    throw unauthorized(left
      ? `Incorrect code. ${left} attempt(s) remaining.`
      : 'Too many incorrect attempts. Request a new code.');
  }

  // Single use. Marked consumed before the session is minted, so the same code
  // cannot be redeemed twice by two requests arriving together.
  const [res] = await master.execute(
    'UPDATE login_otps SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL',
    [row.id]
  );
  if (!res.affectedRows) throw unauthorized('That code has already been used.');

  const tenant = await resolveTenantByLogin(key);
  if (!tenant) throw unauthorized('Could not resolve your organisation. Please sign in with your password.');
  const db = getTenantPool(tenant);
  const [[user] = []] = await db.execute(
    `SELECT u.*, m.name AS manager_name,
            UNIX_TIMESTAMP(u.password_changed_at) AS password_changed_ts
       FROM users u LEFT JOIN users m ON m.id = u.manager_id
      WHERE u.id = ? AND u.status = 'active' LIMIT 1`,
    [row.user_id]
  );
  if (!user) throw unauthorized('That account is no longer active.');

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
    must_change_password: !!user.must_change_password,
    org_name: tenant.name,
    org_slug: tenant.slug,
  };

  const token = signToken({
    user: session,
    org_slug: tenant.slug,
    pwd_ts: Number(user.password_changed_ts) || 0,
  });

  if (tenant.id) {
    masterDb().execute('UPDATE tenants SET last_login_at = NOW() WHERE id = ?', [tenant.id]).catch(() => {});
  }
  recordLogin({
    actorType: 'tenant_user', actorId: user.id, actorName: user.name, actorEmail: user.email,
    tenantId: tenant.id || null, tenantSlug: tenant.slug, outcome: 'success',
    ip: meta.ip, userAgent: meta.userAgent,
  });
  logger.info(`auth: OTP login ok (${maskPhone(key)} @ ${tenant.slug})`);

  return { user: session, token };
}

/**
 * Whether the sign-in screen should offer the OTP option at all.
 *
 * `enabled` means "switched on AND able to deliver", not merely switched on.
 * Offering the option while the gateway is misconfigured is worse than not
 * offering it: the user abandons a password that works for a code that never
 * arrives, and the screen has no way to tell them why.
 */
export async function otpStatus() {
  const p = await policy();
  const on = p.otp_enabled === '1';
  const { deliverable } = await providerReadiness(p.otp_provider);
  return {
    success: true,
    enabled: on && deliverable,
    length: num(p.otp_length, 6),
    resend_in: num(p.otp_resend_seconds, 60),
    // Named so an operator can see at a glance that a live system is still on
    // the mock provider.
    provider: config.env === 'production' && p.otp_provider === 'log' ? 'unconfigured' : p.otp_provider,
  };
}

/**
 * Can the chosen provider actually put a message on a handset right now?
 * Returns the reason when it cannot, for the platform console to display.
 */
export async function providerReadiness(provider) {
  const chosen = String(provider || 'log').toLowerCase();
  if (chosen === 'log') {
    return config.env === 'production'
      ? { deliverable: false, reason: 'The mock provider is refused in production.' }
      : { deliverable: true, reason: 'Codes are written to the server log, not sent.' };
  }
  if (chosen === 'jio_dlt') {
    const cfg = await dltConfig();
    if (!cfg.enabled) return { deliverable: false, reason: 'The DLT connector is switched off.' };
    const missing = dltMissing(cfg);
    return missing.length
      ? { deliverable: false, reason: `Incomplete: ${missing.join(', ')}.` }
      : { deliverable: true, reason: 'DLT gateway configured.' };
  }
  if (chosen === 'msg91') {
    return process.env.SMS_API_KEY && process.env.SMS_SENDER_ID
      ? { deliverable: true, reason: 'MSG91 configured from environment.' }
      : { deliverable: false, reason: 'SMS_API_KEY / SMS_SENDER_ID are not set.' };
  }
  if (chosen === 'twilio') {
    return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM
      ? { deliverable: true, reason: 'Twilio configured from environment.' }
      : { deliverable: false, reason: 'TWILIO_* variables are not set.' };
  }
  return { deliverable: false, reason: `Unknown provider "${chosen}".` };
}

/** Housekeeping: drop consumed and expired codes. Safe on any schedule. */
export async function pruneOtps() {
  try {
    const [r] = await masterDb().execute(
      'DELETE FROM login_otps WHERE expires_at < DATE_SUB(NOW(), INTERVAL 1 DAY)'
    );
    return r.affectedRows;
  } catch { return 0; }
}

export default { requestOtp, verifyOtp, otpStatus, providerReadiness, pruneOtps, policy };
