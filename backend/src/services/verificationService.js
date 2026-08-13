/**
 * One-time codes for proving somebody holds an address or a number.
 *
 * ── Why this is not otpService ─────────────────────────────────────────────
 *
 * otpService signs people IN: every path through it starts by finding an
 * existing user in a tenant, and ends by minting a session. None of that is
 * true here. An applicant filling in the registration form has no account, no
 * organisation and no session to mint, and the whole point of the code is to
 * establish something about them BEFORE any of that exists.
 *
 * So this issues and checks codes and stops there. What a verified code then
 * entitles you to — submit an application, set a new password, save a changed
 * number — is decided by the caller, which is the only place that knows.
 *
 * ── The rules, which are the same ones otpService enforces ─────────────────
 *
 * Codes are stored bcrypt-hashed, never in clear. Wrong guesses are counted per
 * code and burn it at the limit, so six digits cannot be walked at network
 * speed. Issuing a new code expires the previous one, so resending does not
 * widen the target. Requesting a code says nothing about whether the identifier
 * is known — with one deliberate exception noted on sendCode.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { masterDb } from '../database/master.js';
import { policy } from './otpService.js';
import { isEmail, normalizePhone } from './directoryService.js';
import { sendViaPlatform, platformMailReady } from './mailerService.js';
import { sendSms, messageFor, smsReady, maskPhone } from './smsService.js';
import { badRequest, tooMany, unauthorized, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

/**
 * What a code may be issued for, and what it says on the way out.
 *
 * A closed set, checked on every call. The column behind it is a VARCHAR now
 * (see migration 022) precisely so a new purpose cannot fail at the database
 * with a truncation error; the trade is that the validation has to live
 * somewhere, and here it can name the values it accepts.
 */
export const PURPOSES = {
  registration_verify: {
    channel: 'email',
    subject: (code) => `${code} is your IFQM email verification code`,
    lead: 'Use this code to verify the email address on your IFQM registration:',
  },
  registration_phone: {
    channel: 'sms',
    subject: (code) => `${code} is your IFQM verification code`,
    lead: 'Use this code to verify the mobile number on your IFQM registration:',
  },
  password_reset: {
    channel: 'any',
    subject: (code) => `${code} is your IFQM password reset code`,
    lead: 'Use this code to set a new password on your IFQM account:',
  },
  phone_verify: {
    channel: 'sms',
    subject: (code) => `${code} is your IFQM verification code`,
    lead: 'Use this code to confirm your mobile number:',
  },
};

/** How long a consumed code counts as proof, for the caller that acts on it. */
export const PROOF_WINDOW_MINUTES = 30;

function num(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** A numeric code from a CSPRNG, rejection-sampled so the digits are unbiased. */
function generateCode(length = 6) {
  const n = Math.max(4, Math.min(8, num(length, 6)));
  const max = 10 ** n;
  const limit = Math.floor(0xffffffff / max) * max;
  let v;
  do { v = crypto.randomBytes(4).readUInt32BE(0); } while (v >= limit);
  return String(v % max).padStart(n, '0');
}

/** Split an identifier into what it is and the form we store it in. */
export function classify(raw) {
  const s = String(raw || '').trim();
  if (isEmail(s)) return { key: s.toLowerCase(), idType: 'email', channel: 'email' };
  const phone = normalizePhone(s);
  if (phone) return { key: phone, idType: 'phone', channel: 'sms' };
  return { key: '', idType: '', channel: '' };
}

const codeEmailHtml = (name, lead, code, minutes) => {
  const safe = String(name || '').replace(/[<>&]/g, '');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#111;line-height:1.6">
  <p>Hello ${safe || 'there'},</p>
  <p>${lead}</p>
  <p style="font-size:30px;font-weight:700;letter-spacing:7px;margin:22px 0">${code}</p>
  <p>It expires in ${minutes} minute(s) and can be used once.</p>
  <p style="color:#666;font-size:13px">If you did not ask for this, ignore this message.
  Nobody can use the code without access to this inbox. Do not forward it to anyone.</p>
</div>`;
};

/**
 * Issue a code and send it.
 *
 * `announce` decides whether the caller is told the send actually happened.
 * Sign-in and password reset say nothing either way, because answering
 * truthfully turns them into a membership oracle: type addresses, learn who
 * works here. Registration is the exception and answers honestly — the person
 * is typing their OWN address into a form they are filling in, they already
 * know whether they own it, and a form that cannot say "that didn't send"
 * leaves them staring at a field that will never fill in.
 */
export async function sendCode({
  identifier, purpose, name = '', tenantSlug = null, userId = null, ip = null, announce = false,
} = {}) {
  const spec = PURPOSES[purpose];
  if (!spec) throw badRequest(`Unknown verification purpose "${purpose}".`);

  const { key, idType, channel } = classify(identifier);
  if (!key) throw badRequest('Enter a valid email address or mobile number.');
  if (spec.channel !== 'any' && spec.channel !== channel) {
    throw badRequest(spec.channel === 'sms'
      ? 'Enter a mobile number.'
      : 'Enter an email address.');
  }

  const ready = channel === 'sms' ? smsReady(purpose) : { ready: platformMailReady(), reason: 'No mail sender configured.' };
  if (!ready.ready) {
    logger.error(`verify: cannot send ${purpose} by ${channel} — ${ready.reason}`);
    throw new ApiError(503, channel === 'sms'
      ? 'Codes by SMS are not available right now. Please use email, or contact IFQM.'
      : 'Codes by email are not available right now. Please contact IFQM.');
  }

  const p = await policy();
  const ttl = num(p.otp_ttl_seconds, 300);
  const wait = num(p.otp_resend_seconds, 60);
  const master = masterDb();

  // Throttle before anything else, so response timing cannot separate a known
  // identifier from an unknown one.
  const [[recent] = []] = await master.execute(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM login_otps
      WHERE identifier = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    [key, purpose]
  );
  if (wait > 0 && recent && Number(recent.age) < wait) {
    const left = wait - Number(recent.age);
    throw tooMany(`Please wait ${left} second(s) before asking for another code.`, { retry_after: left });
  }

  const code = generateCode(p.otp_length);
  await master.execute(
    `UPDATE login_otps SET expires_at = NOW()
      WHERE identifier = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()`,
    [key, purpose]
  );
  await master.execute(
    `INSERT INTO login_otps
       (identifier, id_type, channel, code_hash, tenant_slug, user_id, purpose, expires_at, requested_ip)
     VALUES (?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)`,
    [key, idType, channel, await bcrypt.hash(code, 10), tenantSlug, userId, purpose, ttl,
      String(ip || '').slice(0, 45) || null]
  );

  const minutes = Math.max(1, Math.round(ttl / 60));
  let sent;
  if (channel === 'sms') {
    // The wording comes from the registered template, never from a literal
    // here: text that has drifted from its registration is accepted by the
    // gateway and dropped by the carrier, with nothing to see at either end.
    const { text } = messageFor(purpose, code, minutes);
    const r = await sendSms(key, text, { purpose, tenantSlug });
    sent = { sent: r.sent, detail: r.detail, provider: r.provider };
  } else {
    try {
      await sendViaPlatform(key, name, spec.subject(code), codeEmailHtml(name, spec.lead, code, minutes));
      sent = { sent: true, provider: 'platform_smtp' };
    } catch (e) {
      sent = { sent: false, provider: 'platform_smtp', detail: e.message };
    }
  }

  if (!sent.sent) logger.error(`verify: ${purpose} code to ${maskPhone(key)} failed — ${sent.detail || ''}`);
  else logger.info(`verify: ${purpose} code sent to ${maskPhone(key)} by ${channel}`);

  // A registration form that cannot report a failed send leaves the applicant
  // waiting for a code that is never coming.
  if (announce && !sent.sent) {
    throw new ApiError(502, 'We could not send the code. Check the address or number and try again.');
  }

  return {
    success: true,
    channel,
    expires_in: ttl,
    resend_in: wait,
    message: announce
      ? (channel === 'sms' ? 'A code has been sent by SMS.' : 'A code has been sent to that address.')
      : 'If that is registered with us, a code has been sent to it.',
  };
}

/**
 * Check a code and consume it.
 *
 * The consumed row is left in place rather than deleted: it is the evidence a
 * caller later reads with wasVerified() to decide whether an application may be
 * submitted, and housekeeping prunes it on its own schedule.
 */
export async function verifyCode({ identifier, code, purpose } = {}) {
  if (!PURPOSES[purpose]) throw badRequest(`Unknown verification purpose "${purpose}".`);
  const supplied = String(code || '').trim();
  const { key } = classify(identifier);
  if (!key || !supplied) throw badRequest('Enter the code that was sent to you.');

  const p = await policy();
  const maxAttempts = num(p.otp_max_attempts, 5);
  const master = masterDb();

  const [[row] = []] = await master.execute(
    `SELECT * FROM login_otps
      WHERE identifier = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [key, purpose]
  );

  // Compare even with no row, so a wrong identifier and a wrong code take the
  // same time to answer.
  const ok = row
    ? await bcrypt.compare(supplied, row.code_hash)
    : await bcrypt.compare(supplied, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');

  if (!row) throw unauthorized('That code is not valid or has expired. Ask for a new one.');

  if (!ok) {
    const attempts = Number(row.attempts) + 1;
    await master.execute(
      'UPDATE login_otps SET attempts = ?, expires_at = IF(? >= ?, NOW(), expires_at) WHERE id = ?',
      [attempts, attempts, maxAttempts, row.id]
    );
    const left = Math.max(0, maxAttempts - attempts);
    throw unauthorized(left
      ? `Incorrect code. ${left} attempt(s) remaining.`
      : 'Too many incorrect attempts. Ask for a new code.');
  }

  const [res] = await master.execute(
    'UPDATE login_otps SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL',
    [row.id]
  );
  if (!res.affectedRows) throw unauthorized('That code has already been used.');

  logger.info(`verify: ${purpose} confirmed for ${maskPhone(key)}`);
  return { success: true, verified: true, identifier: key, row };
}

/**
 * Was this identifier proved recently, for this purpose?
 *
 * The registration form asks this about the email and the number before it will
 * accept an application. Deliberately checked on the server from the consumed
 * row: a browser that says "verified: true" is a browser saying it, and the
 * whole point of the exercise is not to take its word for it.
 */
export async function wasVerified(identifier, purpose, withinMinutes = PROOF_WINDOW_MINUTES) {
  const { key } = classify(identifier);
  if (!key) return false;
  try {
    const [[row] = []] = await masterDb().execute(
      `SELECT id FROM login_otps
        WHERE identifier = ? AND purpose = ? AND consumed_at IS NOT NULL
          AND consumed_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
        ORDER BY id DESC LIMIT 1`,
      [key, purpose, Math.max(1, Number(withinMinutes) || PROOF_WINDOW_MINUTES)]
    );
    return !!row;
  } catch (e) {
    logger.warn('verify: proof lookup failed', e.message);
    return false;
  }
}

/** What the sign-up and reset screens need to know before they draw anything. */
export function channelsAvailable() {
  return {
    email: platformMailReady(),
    sms: smsReady('registration_phone').ready,
    sms_reason: smsReady('registration_phone').reason,
  };
}

export default { sendCode, verifyCode, wasVerified, classify, channelsAvailable, PURPOSES, PROOF_WINDOW_MINUTES };
