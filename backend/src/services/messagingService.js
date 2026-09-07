/*
 * Messaging configuration - the SMS/OTP connector and email health, for the platform
 * console.
 */
import { masterDb } from '../database/master.js';
import { badRequest, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import * as sms from './smsService.js';
import { localStamp } from './smsService.js';
import * as otp from './otpService.js';
import { mailConfig, zeptoMissing, sendZeptoMail } from './zeptoMailService.js';

/** Editable one-time-code policy, with the bounds each value is held to. */
const OTP_KEYS = {
  otp_enabled: { type: 'bool' },
  otp_provider: { type: 'enum', values: ['log', 'jio_dlt', 'msg91', 'twilio'] },
  otp_length: { type: 'int', min: 4, max: 8 },
  // Five minutes is the default.
  otp_ttl_seconds: { type: 'int', min: 60, max: 3600 },
  otp_max_attempts: { type: 'int', min: 3, max: 10 },
  // Zero is legitimate - it means no throttle, which is what a UAT run wants.
  otp_resend_seconds: { type: 'int', min: 0, max: 600 },
};

/** The platform mail provider. mail_zepto_token is absent for the same reason. */
const MAIL_KEYS = {
  mail_provider: { type: 'enum', values: ['smtp', 'zeptomail'] },
  mail_zepto_enabled: { type: 'bool' },
  mail_zepto_endpoint: { type: 'url', max: 255 },
  mail_zepto_from: { type: 'text', max: 160 },
  mail_zepto_from_name: { type: 'text', max: 120 },
  otp_email_enabled: { type: 'bool' },
};

/** The DLT connector. api_key is deliberately absent; see below. */
const DLT_KEYS = {
  sms_dlt_enabled: { type: 'bool' },
  sms_dlt_entity_id: { type: 'text', max: 40 },
  sms_dlt_sender_id: { type: 'text', max: 11 },
  sms_dlt_template_id: { type: 'text', max: 40 },
  sms_dlt_template_text: { type: 'text', max: 500 },
  sms_dlt_endpoint: { type: 'url', max: 255 },
};

async function readAll() {
  const [rows] = await masterDb().query(
    "SELECT key_name, value FROM platform_settings WHERE key_name LIKE 'otp\\_%' "
    + "OR key_name LIKE 'sms\\_dlt\\_%' OR key_name LIKE 'mail\\_%'"
  );
  return Object.fromEntries(rows.map((r) => [r.key_name, r.value ?? '']));
}

async function write(key, value) {
  await masterDb().execute(
    `INSERT INTO platform_settings (key_name, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [key, String(value)]
  );
}

function coerce(key, spec, raw) {
  if (spec.type === 'bool') return (raw === true || raw === 1 || raw === '1' || raw === 'true') ? '1' : '0';
  if (spec.type === 'enum') {
    const v = String(raw ?? '').trim();
    return spec.values.includes(v) ? v : null;
  }
  if (spec.type === 'int') {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return String(Math.min(spec.max, Math.max(spec.min, n)));
  }
  if (spec.type === 'url') {
    const v = String(raw ?? '').trim();
    if (!v) return '';
    // An http endpoint would put the API key and the recipient's number on the wire in clear.
    // Refuse rather than quietly downgrade.
    if (!/^https:\/\//i.test(v)) return null;
    return v.slice(0, spec.max);
  }
  return String(raw ?? '').trim().slice(0, spec.max);
}

/** Everything the dashboard needs, in one call. */
export async function getMessagingConfig() {
  const s = await readAll();
  const dlt = await sms.dltConfig();
  // The provider that would actually carry a code, not the stored preference.
  const provider = sms.effectiveProvider(s.otp_provider);
  const readiness = await otp.providerReadiness(provider);
  const mail = await mailConfig();

  return {
    success: true,
    otp: {
      enabled: s.otp_enabled === '1',
      provider,
      // What the console has stored, kept alongside so the screen can show that the environment
      // is overriding it rather than silently disagreeing.
      stored_provider: s.otp_provider || 'log',
      length: parseInt(s.otp_length, 10) || 6,
      ttl_seconds: parseInt(s.otp_ttl_seconds, 10) || 300,
      max_attempts: parseInt(s.otp_max_attempts, 10) || 5,
      resend_seconds: Number.isFinite(parseInt(s.otp_resend_seconds, 10))
        ? parseInt(s.otp_resend_seconds, 10) : 60,
    },
    dlt: {
      enabled: dlt.enabled,
      entity_id: dlt.entity_id,
      sender_id: dlt.sender_id,
      template_id: dlt.template_id,
      template_text: dlt.template_text,
      endpoint: dlt.endpoint,
      // Never the key itself - only whether one is on file.
      api_key_set: !!dlt.api_key,
      missing: sms.dltMissing(dlt),
    },
    readiness,
    last_test: {
      at: s.sms_dlt_last_test_at || null,
      ok: s.sms_dlt_last_test_ok === '1',
      note: s.sms_dlt_last_test_note || '',
    },
    mail: {
      provider: s.mail_provider || 'smtp',
      zepto_enabled: mail.zepto_enabled,
      endpoint: mail.endpoint,
      from: mail.from,
      from_name: mail.from_name,
      // Never the token - only whether one is on file.
      token_set: !!mail.token,
      missing: zeptoMissing(mail),
      otp_email_enabled: mail.otp_email_enabled,
      last_test: {
        at: s.mail_zepto_last_test_at || null,
        ok: s.mail_zepto_last_test_ok === '1',
        note: s.mail_zepto_last_test_note || '',
      },
    },
    recent: await sms.recentDeliveries(20),
    email: await emailHealth(),
  };
}

export async function updateMessagingConfig(body = {}, actor = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('No settings provided.');

  const rejected = [];
  const pending = [];

  for (const [key, spec] of Object.entries({ ...OTP_KEYS, ...DLT_KEYS, ...MAIL_KEYS })) {
    if (!(key in body)) continue;
    const value = coerce(key, spec, body[key]);
    if (value === null) {
      rejected.push(key === 'sms_dlt_endpoint'
        ? 'The gateway endpoint must be an https:// address.'
        : `"${key}" is not a value this setting accepts.`);
      continue;
    }
    pending.push([key, value]);
  }
  if (rejected.length) throw badRequest(rejected.join(' '));

  // Turning one-time-code sign-in ON is checked against what the provider can actually do,
  // using the values being saved rather than the ones on file - otherwise enabling and
  // configuring in the same save would be refused for looking at the old, empty
  // configuration.
  const proposed = Object.fromEntries(pending);
  const wantsOn = proposed.otp_enabled === '1';
  if (wantsOn) {
    const current = await readAll();
    const merged = { ...current, ...proposed };
    const provider = merged.otp_provider || 'log';
    if (provider === 'jio_dlt') {
      const dlt = await sms.dltConfig();
      const effective = {
        ...dlt,
        enabled: merged.sms_dlt_enabled === '1',
        entity_id: merged.sms_dlt_entity_id ?? dlt.entity_id,
        sender_id: merged.sms_dlt_sender_id ?? dlt.sender_id,
        template_id: merged.sms_dlt_template_id ?? dlt.template_id,
        endpoint: merged.sms_dlt_endpoint ?? dlt.endpoint,
        // The key is not in `body` unless it is being changed, so fall back to whether one is
        // already stored.
        api_key: String(body.sms_dlt_api_key || '').trim() || dlt.api_key,
      };
      if (!effective.enabled) {
        throw badRequest('Switch the DLT connector on before enabling code sign-in.');
      }
      const missing = sms.dltMissing(effective);
      if (missing.length) {
        throw badRequest(`The DLT connector is incomplete: ${missing.join(', ')}.`);
      }
    }
  }

  for (const [key, value] of pending) await write(key, value);

  // The API key, on unambiguous intent only.
  let keyTouched = '';
  if (body.sms_dlt_api_key_clear === true) {
    await write('sms_dlt_api_key', '');
    keyTouched = 'cleared';
  } else if (String(body.sms_dlt_api_key ?? '').trim()) {
    await write('sms_dlt_api_key', String(body.sms_dlt_api_key).trim());
    keyTouched = 'replaced';
  }

  // The ZeptoMail send token, on the same unambiguous-intent rule as the gateway key above.
  let tokenTouched = '';
  if (body.mail_zepto_token_clear === true) {
    await write('mail_zepto_token', '');
    tokenTouched = 'cleared';
  } else if (String(body.mail_zepto_token ?? '').trim()) {
    await write('mail_zepto_token', String(body.mail_zepto_token).trim());
    tokenTouched = 'replaced';
  }

  if (!pending.length && !keyTouched && !tokenTouched) throw badRequest('Nothing to update.');

  logger.info(`platform: messaging settings updated by ${actor?.email || 'unknown'} `
    + `(${pending.length} key(s)${keyTouched ? `, API key ${keyTouched}` : ''})`);

  return {
    success: true,
    updated: pending.length + (keyTouched ? 1 : 0) + (tokenTouched ? 1 : 0),
    ...(await getMessagingConfig()),
  };
}

/** Send a real code-shaped message to one number. */
export async function sendTest({ phone, provider } = {}) {
  const to = String(phone || '').replace(/[^\d+]/g, '');
  if (to.replace(/\D/g, '').length < 10) {
    throw badRequest('Enter a full mobile number to send the test to.');
  }
  const s = await readAll();
  // Test what would really carry a code.
  const chosen = provider || sms.effectiveProvider(s.otp_provider);
  const result = await sms.sendTestSms(to, { provider: chosen });
  return {
    success: true,
    sent: result.sent,
    provider: result.provider,
    detail: result.detail || (result.sent ? 'Accepted by the gateway.' : 'The gateway refused it.'),
    reference: result.ref || null,
    // Said plainly, because "Test Connection: passed" over an SMS gateway otherwise reads as
    // "the user received it", which it does not mean.
    note: result.sent
      ? 'The gateway accepted the message. Confirm it actually arrived on the handset - '
        + 'a carrier can still drop a message whose template is not registered.'
      : null,
  };
}

/** Send a real email through the platform provider. */
export async function sendTestMail({ to } = {}) {
  const address = String(to || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    throw badRequest('Enter an email address to send the test to.');
  }
  const cfg = await mailConfig();
  const missing = zeptoMissing(cfg);
  if (missing.length) throw badRequest(`Not configured: ${missing.join(', ')}.`);

  const r = await sendZeptoMail({
    to: address,
    toName: 'IFQM platform team',
    subject: 'IFQM - email delivery test',
    html: '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6">'
      + '<p>This is a test from the IFQM platform console.</p>'
      + '<p>If you are reading it, the ZeptoMail token, the sender domain and the '
      + 'endpoint region are all correct.</p></div>',
    cfg,
  });

  for (const [k, v] of [
    // Local time - see the note on the SMS test for why not toISOString().
    ['mail_zepto_last_test_at', localStamp()],
    ['mail_zepto_last_test_ok', r.sent ? '1' : '0'],
    ['mail_zepto_last_test_note', (r.detail || '').slice(0, 255)],
  ]) await write(k, v);

  return {
    success: true,
    sent: r.sent,
    detail: r.detail || (r.sent ? 'Accepted by ZeptoMail.' : 'ZeptoMail refused it.'),
    reference: r.ref || null,
  };
}

/** Is email actually working? */
export async function emailHealth() {
  const health = {
    queue_supported: true,
    pending: 0, failed: 0, sent_24h: 0, oldest_pending_at: null,
    // Split out, because they are different problems with different fixes.
    pending_deliverable: 0,
    pending_email_off: 0,
    orgs_email_on: 0, orgs_total: 0,
    note: '',
  };
  try {
    // The queue lives in each tenant's own database, so a platform-wide figure means asking
    // every tenant. Cheap: it is one indexed count per customer.
    const [tenants] = await masterDb().query(
      "SELECT id, slug, db_name FROM tenants WHERE status <> 'deleted'"
    );
    const { getTenantPool } = await import('../database/tenant.js');
    // Either platform route counts.
    const { platformMailReady } = await import('./mailerService.js');
    const platformCanSend = platformMailReady() || (await mailConfig()).zepto_enabled;

    for (const t of tenants) {
      try {
        const db = getTenantPool(t);
        health.orgs_total += 1;

        const [settingRows] = await db.query(
          "SELECT key_name, value FROM org_settings WHERE key_name IN ('email_enabled','smtp_host')"
        );
        const s = Object.fromEntries(settingRows.map((r) => [r.key_name, r.value]));
        // A tenant can send unless it has switched email OFF, and provided there is a route - its
        // own SMTP host, or the platform provider.
        const canSend = String(s.email_enabled ?? '1') !== '0'
          && !!(String(s.smtp_host || '').trim() || platformCanSend);
        if (canSend) health.orgs_email_on += 1;

        // 'processing' counts as pending, because that is what it is: claimed for a send that has
        // not finished.
        const [[row]] = await db.query(
          `SELECT
             SUM(status IN ('pending','processing')) AS pending,
             SUM(status = 'failed')  AS failed,
             SUM(status = 'sent' AND sent_at > DATE_SUB(NOW(), INTERVAL 1 DAY)) AS sent_24h,
             MIN(CASE WHEN status IN ('pending','processing') THEN created_at END) AS oldest
           FROM email_queue`
        );
        const pending = Number(row?.pending || 0);
        health.pending += pending;
        health.failed += Number(row?.failed || 0);
        health.sent_24h += Number(row?.sent_24h || 0);
        if (canSend) health.pending_deliverable += pending;
        else health.pending_email_off += pending;

        // Only a backlog that SHOULD be moving counts toward the stuck warning.
        if (canSend && row?.oldest
          && (!health.oldest_pending_at || row.oldest < health.oldest_pending_at)) {
          health.oldest_pending_at = row.oldest;
        }
      } catch { /* one unreachable tenant must not blank the whole panel */ }
    }
  } catch (e) {
    health.queue_supported = false;
    health.note = e.message;
  }
  return health;
}

export default { getMessagingConfig, updateMessagingConfig, sendTest, sendTestMail, emailHealth };
