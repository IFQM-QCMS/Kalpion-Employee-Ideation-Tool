/** ZeptoMail - Zoho's transactional email API. */
import config from '../config/index.js';
import { masterDb } from '../database/master.js';
import logger from '../utils/logger.js';
import { networkReason } from './smsService.js';

// This file used to carry a live send token and the SMTP username and password as literal
// defaults.

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
      // The From address falls back to the environment sender, so the console shows the address
      // mail actually goes out as rather than an empty field.
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

/** Zoho's console shows the token already prefixed. */
function authHeader(token) {
  const t = String(token || '').trim();
  return /^zoho-enczapikey\s/i.test(t) ? t : `Zoho-enczapikey ${t}`;
}

/** Strip anything that could inject a header. */
const headerSafe = (s) => String(s ?? '').replace(/[\r\n"<>]/g, ' ').trim();

/** Send one email. */
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
      // 401 here is almost always one of three things, and saying which saves a support round
      // trip - see the notes at the top of this file.
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
