/**
 * ZeptoMail — Zoho's transactional email API.
 *
 * ── Why an HTTP API alongside SMTP ─────────────────────────────────────────
 *
 * Per-tenant SMTP is kept and still takes precedence: notifications appearing
 * to come from the customer's own domain is a feature, not an accident. This
 * exists for the two cases SMTP cannot cover.
 *
 * The first is mail with no tenant behind it — a one-time code to an email
 * address, a registration acknowledgement, a platform notice. There is no
 * org_settings row to read, so those were simply never sent.
 *
 * The second is that most managed hosts block outbound SMTP ports. A correctly
 * configured SMTP server that the platform will not let us reach fails in a way
 * that looks identical to a wrong password, and costs an afternoon to work out.
 * An HTTPS API is not blocked.
 *
 * ── The three things that go wrong with ZeptoMail ──────────────────────────
 *
 *   Wrong region.  api.zeptomail.in and api.zeptomail.com are separate
 *                  installations. A token from one returns 401 on the other,
 *                  and the error does not mention regions. Hence a configured
 *                  endpoint rather than a hard-coded host.
 *
 *   Token prefix.  The value Zoho shows already begins "Zoho-enczapikey ".
 *                  Stripping it, or adding a second copy, both produce 401. The
 *                  header is built defensively below so either form works.
 *
 *   Unverified     The from address must be on a domain verified in ZeptoMail
 *   sender.        AND belong to the Mail Agent the token came from. This is
 *                  the most common first-run failure.
 */
import config from '../config/index.js';
import { masterDb } from '../database/master.js';
import logger from '../utils/logger.js';
import { networkReason } from './smsService.js';

/*
 * ── Where the credentials are NOT ──────────────────────────────────────────
 *
 * This file used to carry a live send token and the SMTP username and password
 * as literal defaults. That put a working credential for the sender domain into
 * every clone of the repository and into its history, where deleting it later
 * does not take it back. Credentials now come from the environment
 * (config.platformMail, delivered over SMTP by mailerService) or from the
 * registry, where a platform admin put them deliberately.
 *
 * `zepto_enabled` therefore starts FALSE. It reflects whether an operator
 * actually configured the HTTP API route in the console, so an unconfigured
 * deployment stops trying to send through it with a token that does not exist —
 * a 401 per message, reported to the caller as "mail is broken".
 */

/** Platform-wide mail settings from the registry, defaulted from the env sender. */
export async function mailConfig() {
  const env = config.platformMail;
  const blank = {
    provider: 'smtp',
    zepto_enabled: false,
    token: '',
    endpoint: '',
    from: env.from,
    from_name: env.fromName,
    otp_email_enabled: false,
  };
  try {
    const [rows] = await masterDb().query(
      "SELECT key_name, value FROM platform_settings "
      + "WHERE key_name LIKE 'mail\\_%' OR key_name = 'otp_email_enabled'"
    );
    const m = Object.fromEntries(rows.map((r) => [r.key_name, r.value ?? '']));
    return {
      provider: m.mail_provider || 'smtp',
      zepto_enabled: m.mail_zepto_enabled === '1',
      token: m.mail_zepto_token || '',
      endpoint: (m.mail_zepto_endpoint || '').trim(),
      // The From address falls back to the environment sender, so the console
      // shows the address mail actually goes out as rather than an empty field.
      from: (m.mail_zepto_from || env.from).trim(),
      from_name: m.mail_zepto_from_name || env.fromName,
      otp_email_enabled: m.otp_email_enabled === '1',
    };
  } catch (e) {
    logger.warn('mail: could not read provider settings', e.message);
    return blank;
  }
}

/** What is still missing before ZeptoMail could send anything. */
export function zeptoMissing(cfg) {
  const missing = [];
  if (!cfg.token) missing.push('Send Mail token');
  if (!cfg.endpoint) missing.push('API endpoint');
  if (!cfg.from) missing.push('From address');
  if (cfg.from && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cfg.from)) {
    missing.push('From address is not a valid email address');
  }
  if (cfg.endpoint && !/^https:\/\//i.test(cfg.endpoint)) {
    missing.push('API endpoint must be https');
  }
  return missing;
}

/**
 * Zoho's console shows the token already prefixed. Accept it either way rather
 * than making an operator know which form we wanted — both mistakes produce an
 * identical, unhelpful 401.
 */
function authHeader(token) {
  const t = String(token || '').trim();
  return /^zoho-enczapikey\s/i.test(t) ? t : `Zoho-enczapikey ${t}`;
}

/**
 * Strip anything that could inject a header. The display name comes from
 * settings, i.e. admin-controlled input; this is the same precaution the SMTP
 * path takes for the same reason.
 */
const headerSafe = (s) => String(s ?? '').replace(/[\r\n"<>]/g, ' ').trim();

/**
 * Send one email.
 * @returns {Promise<{ sent: boolean, detail?: string, ref?: string, status?: number }>}
 */
export async function sendZeptoMail({ to, toName, subject, html, cfg } = {}) {
  const c = cfg || await mailConfig();
  const missing = zeptoMissing(c);
  if (missing.length) return { sent: false, detail: `Not configured: ${missing.join(', ')}` };

  const address = headerSafe(to);
  if (!address) return { sent: false, detail: 'no recipient' };

  try {
    const res = await fetch(c.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: authHeader(c.token),
      },
      body: JSON.stringify({
        from: { address: c.from, name: headerSafe(c.from_name) },
        to: [{ email_address: { address, ...(toName ? { name: headerSafe(toName) } : {}) } }],
        subject: headerSafe(subject),
        htmlbody: html,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const body = await res.text();
    if (!res.ok) {
      // 401 here is almost always one of three things, and saying which saves
      // a support round trip — see the notes at the top of this file.
      const hint = res.status === 401
        ? ' Check the token, and that the endpoint region (.in or .com) matches the account.'
        : res.status === 400 ? ' Check that the From address is on a domain verified in ZeptoMail.' : '';
      logger.error(`ZeptoMail responded ${res.status}`);
      return { sent: false, status: res.status, detail: (explain(body) || `http ${res.status}`) + hint };
    }
    return { sent: true, status: res.status, ref: reference(body) };
  } catch (e) {
    logger.error('ZeptoMail send failed', e.message);
    return { sent: false, detail: networkReason(e, c.endpoint) };
  }
}

function explain(body) {
  try {
    const j = JSON.parse(body);
    const d = j.error?.details?.[0];
    return String(j.error?.message || d?.message || j.message || '').slice(0, 200) || null;
  } catch {
    return String(body || '').trim().slice(0, 200) || null;
  }
}

function reference(body) {
  try {
    const j = JSON.parse(body);
    const v = j.request_id || j.data?.[0]?.message_id;
    return v ? String(v).slice(0, 120) : null;
  } catch { return null; }
}

export default { mailConfig, zeptoMissing, sendZeptoMail };
