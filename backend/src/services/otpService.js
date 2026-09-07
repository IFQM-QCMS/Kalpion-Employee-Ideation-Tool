/** One-time-code login - MOM 29 Jul 2026 §4.1, §4.2. */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { masterDb } from '../database/master.js';
import { signToken } from '../utils/jwt.js';
import {
  resolveTenantByLogin, normalizePhone, isEmail, normalizeUsername,
} from './directoryService.js';
import { getTenantPool } from '../database/tenant.js';
import {
  sendSms, maskPhone, dltConfig, dltMissing, fillTemplate, messageFor, smsReady, kaleyraMissing,
} from './smsService.js';
import { recordLogin } from './activityService.js';
import { mailConfig, sendZeptoMail, zeptoMissing } from './zeptoMailService.js';
import { sendViaPlatform, platformMailReady } from './mailerService.js';
import { badRequest, unauthorized, tooMany, ApiError } from '../utils/respond.js';
import { assertNotInMaintenance } from './maintenanceService.js';
import logger from '../utils/logger.js';

const DEFAULTS = {
  otp_enabled: '1',
  otp_length: '6',
  otp_ttl_seconds: '300',
  otp_max_attempts: '5',
  otp_resend_seconds: '60',
  otp_provider: 'log',
};

/** Platform-wide OTP policy, with sane fallbacks if the rows are missing. */
export async function policy() {
  const override = config.otpEnabled === undefined ? {} : { otp_enabled: config.otpEnabled ? '1' : '0' };
  try {
    const [rows] = await masterDb().query(
      "SELECT key_name, value FROM platform_settings WHERE key_name LIKE 'otp\\_%'"
    );
    const found = Object.fromEntries(rows.map((r) => [r.key_name, r.value]));
    return { ...DEFAULTS, ...found, ...override };
  } catch {
    return { ...DEFAULTS, ...override };
  }
}

/** Parse a policy number. */
function num(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** A numeric code of the requested length, drawn from a CSPRNG. */
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

/** The code, in an email. */
function otpEmailHtml(name, code, minutes) {
  const safe = String(name || '').replace(/[<>&]/g, '');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6">
  <p>Hello ${safe || 'there'},</p>
  <p>Use this code to sign in to Kalpion:</p>
  <p style="font-size:30px;font-weight:700;letter-spacing:7px;margin:22px 0">${code}</p>
  <p>It expires in ${minutes} minute(s) and can be used once.</p>
  <p style="color:#666;font-size:13px">If you did not ask to sign in, you can ignore this message -
  nobody can use this code without your email account. Do not forward it to anyone.</p>
</div>`;
}


export async function requestOtp({ identifier, purpose = 'login', meta = {} } = {}) {
  const raw = String(identifier || '').trim();
  if (!raw) throw badRequest('Enter your registered phone number.');

  // The login screen offers a code as an alternative to a password, so the two are the same
  // door and both have to be shut.
  await assertNotInMaintenance();

  const p = await policy();
  if (p.otp_enabled !== '1') {
    throw new ApiError(503, 'Sign-in by one-time code is not enabled on this platform.');
  }
  if (!['login', 'dev_access'].includes(purpose)) throw badRequest('Invalid purpose.');

  const phone = normalizePhone(raw);
  const email = isEmail(raw) ? raw.toLowerCase() : '';
  // A username identifies the account but is not somewhere a code can be sent.
  const username = (!phone && !email) ? normalizeUsername(raw) : '';
  const key = phone || email || username;
  const idType = phone ? 'phone' : (email ? 'email' : 'username');
  if (!key) throw badRequest('Enter your username, email address or mobile number.');

  const master = masterDb();

  // Resend throttle. Checked before the directory lookup so a caller cannot use response
  // timing to tell a known number from an unknown one.
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

  // Who does this belong to? An unknown identifier gets the generic reply and nothing is
  // written - there is nobody to send a code to.
  let tenant = null;
  let user = null;
  try {
    tenant = await resolveTenantByLogin(key);
    if (tenant) {
      const db = getTenantPool(tenant);
      let sql; let args;
      if (phone) {
        sql = "SELECT id, name, email, phone FROM users WHERE status='active' AND REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+','') LIKE ? LIMIT 1";
        args = [`%${phone}`];
      } else if (username) {
        sql = "SELECT id, name, email, phone FROM users WHERE username = ? AND status='active' LIMIT 1";
        args = [key];
      } else {
        sql = "SELECT id, name, email, phone FROM users WHERE email = ? AND status='active' LIMIT 1";
        args = [key];
      }
      const [[u] = []] = await db.execute(sql, args);
      user = u || null;
    }
  } catch (e) {
    logger.warn('otp: identifier lookup failed', e.message);
  }
  if (!tenant || !user) {
    logger.info(`otp: request for unknown identifier ${maskPhone(key)} - generic reply`);
    return GENERIC;
  }

  const code = generateCode(p.otp_length);
  const ttl = num(p.otp_ttl_seconds, 300);

  // One live code per identifier: expire anything outstanding first.
  await master.execute(
    'UPDATE login_otps SET expires_at = NOW() WHERE identifier = ? AND consumed_at IS NULL AND expires_at > NOW()',
    [key]
  );
  // `channel` records how the code actually travelled, which is not the same question as
  // what the identifier looks like - somebody who typed a number can still be sent an email
  // when the gateway is down.
  const [inserted] = await master.execute(
    `INSERT INTO login_otps
       (identifier, id_type, code_hash, tenant_id, tenant_slug, user_id, purpose, expires_at, requested_ip)
     VALUES (?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)`,
    [key, idType, await bcrypt.hash(code, 10), tenant.id || null, tenant.slug,
      user.id, purpose, ttl, String(meta.ip || '').slice(0, 45) || null]
  );

  const minutes = Math.max(1, Math.round(ttl / 60));

  // On a DLT gateway the wording is not ours to choose - it has to be the template the
  // carrier approved against the id sent alongside it, or the message is accepted by the
  // gateway and then dropped by the carrier, with no error and no delivery report at either
  // end.
  let body = messageFor(purpose, code, minutes).text;
  // A deployment configured through the platform console rather than the environment keeps
  // its approved wording there instead.
  if (p.otp_provider === 'jio_dlt') {
    const cfg = await dltConfig();
    if (cfg.template_text) body = fillTemplate(cfg.template_text, [code, minutes]);
  }

  // Somebody who typed an email address gets the code by email.
  // The code goes where the person asked for it.
  const emailAddr = idType === 'email' ? key : (user.email || '');
  const phoneNum = idType === 'phone' ? key : (user.phone || '');
  // Typed a username: neither channel was named, so the account's own number is preferred -
  // it is the one field every account is required to have.
  const preferSms = idType === 'phone' || (idType === 'username' && !!phoneNum);
  // Each route reports the channel it *is*, rather than leaving it to be inferred from the
  // provider name afterwards.
  const trySms = async () => ({
    ...(await sendSms(phoneNum, body, { purpose, tenantSlug: tenant.slug })),
    channel: 'sms',
  });
  const tryEmail = async () => {
    const route = platformMailReady() ? 'platform_smtp' : 'zeptomail_api';
    try {
      await sendViaPlatform(emailAddr, user.name,
        `${code} is your Kalpion sign-in code`, otpEmailHtml(user.name, code, minutes));
      return { sent: true, provider: route, channel: 'email' };
    } catch (err) {
      return { sent: false, provider: route, detail: err.message, channel: 'email' };
    }
  };

  const preferred = preferSms ? 'sms' : 'email';
  let sent = { sent: false, provider: 'none', detail: 'no channel available', channel: null };

  if (preferred === 'sms' && phoneNum) sent = await trySms();
  else if (preferred === 'email' && emailAddr) sent = await tryEmail();

  if (!sent.sent) {
    if (preferred === 'sms' && emailAddr) {
      logger.warn(`otp: SMS unavailable (${sent.detail || 'no route'}) - falling back to email`);
      sent = await tryEmail();
    } else if (preferred === 'email' && phoneNum) {
      logger.warn(`otp: email failed (${sent.detail || 'no route'}) - falling back to SMS`);
      sent = await trySms();
    }
  }

  // Now it is known rather than assumed - including the case where the code went out by the
  // channel the person did NOT ask for.
  if (inserted?.insertId && sent.channel) {
    master.execute('UPDATE login_otps SET channel = ? WHERE id = ?',
      [sent.channel, inserted.insertId]).catch(() => {});
  }

  if (!sent.sent) logger.error(`otp: delivery failed via ${sent.provider}: ${sent.detail || ''}`);
  logger.info(`otp: issued for ${maskPhone(key)} @ ${tenant.slug} (provider ${sent.provider})`);

  return {
    ...GENERIC,
    // Never the code itself. This only tells the UI how long to run its timer and whether to
    // show "resend" yet.
    expires_in: ttl,
    resend_in: wait,
  };
}

/** POST /api/auth/otp/verify - exchanges a correct code for a session. */
export async function verifyOtp({ identifier, code, meta = {} } = {}) {
  const raw = String(identifier || '').trim();
  const supplied = String(code || '').trim();
  if (!raw || !supplied) throw badRequest('Enter the code that was sent to you.');

  // Also on redemption, not only on request: a code issued a minute before the switch was
  // thrown must not still buy a session after it.
  await assertNotInMaintenance();

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

  // Always burn a compare, even with no row, so a wrong number and a wrong code take the
  // same time to answer.
  const maxAttempts = num(p.otp_max_attempts, 5);
  const ok = row
    ? await bcrypt.compare(supplied, row.code_hash)
    : await bcrypt.compare(supplied, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');

  if (!row) throw unauthorized('That code is not valid or has expired. Request a new one.');

  if (!ok) {
    const attempts = Number(row.attempts) + 1;
    await master.execute(
      // Burn the code outright once the limit is reached, rather than leaving it alive for the
      // rest of its window with the counter pinned.
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

  // Single use. Marked consumed before the session is minted, so the same code cannot be
  // redeemed twice by two requests arriving together.
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

/** Whether the sign-in screen should offer the OTP option at all. */
export async function otpStatus() {
  const p = await policy();

  // Codes go out by email, so "able to deliver" means the platform sender is configured -
  // the SMTP account in the environment, or, for a deployment that was set up that way, the
  // ZeptoMail API in the console.
  let emailReady = platformMailReady();
  let route = 'platform_smtp';
  if (!emailReady) {
    const mail = await mailConfig();
    emailReady = mail.zepto_enabled && mail.otp_email_enabled;
    route = 'zeptomail_api';
  }

  // SMS counts as "able to deliver" too.
  const sms = smsReady('login');
  const deliverable = emailReady || sms.ready;

  return {
    success: true,
    enabled: p.otp_enabled !== '0' && deliverable,
    length: num(p.otp_length, 6),
    resend_in: num(p.otp_resend_seconds, 60),
    // Named for what would actually carry a code.
    provider: emailReady && sms.ready ? 'both' : (emailReady ? route : (sms.ready ? config.sms.provider : 'none')),
  };
}

/** Can the chosen provider actually put a message on a handset right now? */
export async function providerReadiness(provider) {
  const chosen = String(provider || 'log').toLowerCase();
  if (chosen === 'log') {
    return config.env === 'production'
      ? { deliverable: false, reason: 'The mock provider is refused in production.' }
      : { deliverable: true, reason: 'Codes are written to the server log, not sent.' };
  }
  // Kaleyra - the contracted gateway, and the one this deployment actually runs on.
  if (chosen === 'kaleyra') {
    const missing = kaleyraMissing(config.sms, 'login');
    return missing.length
      ? { deliverable: false, reason: `Incomplete: ${missing.join(', ')}.` }
      : { deliverable: true, reason: 'Kaleyra gateway configured from the environment.' };
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
