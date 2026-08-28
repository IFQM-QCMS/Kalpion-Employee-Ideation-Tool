/**
 * SMS delivery — MOM 29 Jul 2026 §4.1.
 *
 * A thin provider interface, because the meeting asked for a *mock* OTP test
 * with SMS-tag integration and no provider has been contracted yet. Writing
 * this against one vendor's SDK would have meant rewriting it when that choice
 * is actually made; writing it against an interface means the choice is a
 * setting.
 *
 * Providers:
 *   log       writes the message to the server log instead of sending it. This
 *             is what makes the mock test possible today. REFUSED in production
 *             — a provider that prints login codes into a live log file is a
 *             credential leak, not a fallback, so it fails closed there.
 *   jio_dlt   an Indian DLT gateway, configured from the platform console.
 *             This is the one intended for real use.
 *   msg91     an Indian transactional SMS gateway. Kept because it was already
 *             here and costs nothing to keep; configured from env.
 *   twilio    international. Also env-configured.
 *
 * "SMS tag" in the minutes is the DLT sender ID / template registration Indian
 * operators require: an unregistered template is silently dropped by the
 * carrier, which looks exactly like a bug in this application.
 *
 * ── Why jio_dlt reads the database and the others read env ─────────────────
 *
 * env was the right home while no provider had been chosen — it kept an
 * unconfigured feature from needing a schema. It is the wrong home now. The
 * person holding the DLT registration is on the IFQM platform team, and a
 * template ID that can only be corrected by editing a deployment is a template
 * ID that stays wrong. The two older providers are left as they were rather
 * than migrated speculatively; whichever is actually contracted can move.
 */
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { masterDb } from '../database/master.js';
import { DLT_TEMPLATES, SENDER_ID_RE, senderHeader, resolveTemplate } from '../config/smsTemplates.js';

const providerFromEnv = () => (process.env.SMS_PROVIDER || '').trim().toLowerCase();

/**
 * Which provider would actually carry a message right now.
 *
 * The environment wins over the stored setting, because that is the rule the
 * rest of this deployment already follows: the gateway account belongs to IFQM
 * and is set once per deployment, and `config.sms` is where a real send reads
 * it from. The console's stored `otp_provider` is only consulted when the
 * environment says nothing.
 *
 * Without this the console answered a different question from the one the
 * sender answers — it reported on, tested, and gated the feature against the
 * stored provider (which defaults to `log`) while every real code went out over
 * the env-configured gateway. A status panel disagreeing with the code path it
 * describes is worse than no status panel.
 */
export function effectiveProvider(stored = '') {
  return (config.sms.provider || providerFromEnv() || stored || 'log').toLowerCase();
}

/** Every setting the DLT connector needs, read from the registry. */
export async function dltConfig() {
  const blank = {
    enabled: false, entity_id: '', sender_id: '', template_id: '',
    template_text: '', endpoint: '', api_key: '',
  };
  try {
    const [rows] = await masterDb().query(
      "SELECT key_name, value FROM platform_settings WHERE key_name LIKE 'sms\\_dlt\\_%'"
    );
    const m = Object.fromEntries(rows.map((r) => [r.key_name, r.value ?? '']));
    return {
      enabled: m.sms_dlt_enabled === '1',
      entity_id: (m.sms_dlt_entity_id || '').trim(),
      sender_id: (m.sms_dlt_sender_id || '').trim(),
      template_id: (m.sms_dlt_template_id || '').trim(),
      template_text: m.sms_dlt_template_text || '',
      endpoint: (m.sms_dlt_endpoint || '').trim(),
      api_key: m.sms_dlt_api_key || '',
    };
  } catch (e) {
    logger.warn('sms: could not read DLT settings', e.message);
    return blank;
  }
}

/**
 * What is missing before this connector could send anything.
 *
 * Returned as a list rather than a boolean so the console can name the empty
 * field instead of showing "not configured" and leaving somebody to guess
 * which of five values it meant.
 */
export function dltMissing(cfg) {
  const need = [
    ['entity_id', 'Principal Entity ID'],
    ['sender_id', 'Header / Sender ID'],
    ['template_id', 'Content Template ID'],
    ['endpoint', 'Gateway endpoint URL'],
    ['api_key', 'Gateway API key'],
  ];
  const missing = need.filter(([k]) => !String(cfg[k] || '').trim()).map(([, label]) => label);
  /*
   * Six characters, optionally with a DLT category suffix: -T transactional,
   * -S service, -P promotional.
   *
   * This demanded exactly six and nothing else, which rejects IFQMID-T — the
   * header this platform is actually registered under. A correctly configured
   * gateway was reported as misconfigured, and the console told an operator to
   * go and fix a value that was right.
   */
  if (cfg.sender_id && !SENDER_ID_RE.test(cfg.sender_id)) {
    missing.push('Header / Sender ID must be 6 characters, optionally followed by -T, -S or -P');
  }
  return missing;
}

/**
 * Send one text message.
 * @returns {Promise<{ sent: boolean, provider: string, detail?: string, ref?: string, status?: number }>}
 */
export async function sendSms(phone, message, { provider, purpose = 'login', tenantSlug = null } = {}) {
  const chosen = (provider || config.sms.provider || providerFromEnv() || 'log').toLowerCase();
  const to = String(phone || '').trim();
  if (!to) return { sent: false, provider: chosen, detail: 'no recipient' };

  /*
   * A purpose whose DLT template is not registered yet does not go out.
   *
   * Sending anyway would mean the gateway accepting it, the carrier dropping
   * it, and this function returning sent:true — so the log, the delivery table
   * and the caller would all record a message that no handset ever received.
   * For a security alert, that is the worst of the three possible outcomes:
   * silence that looks like success.
   *
   * The log provider is exempt because it is the local mock; it never reaches a
   * carrier and is how this path gets exercised in development at all.
   */
  const spec = DLT_TEMPLATES[purpose];
  // sendable, not registered: a purpose waiting on its own id can still be
  // delivered under a fallback registration, and that fallback carries its own
  // wording so the pair still matches.
  if (spec && !resolveTemplate(purpose).sendable && chosen !== 'log') {
    const why = spec.pendingReason || 'awaiting DLT approval';
    logger.warn(
      `sms: not sending "${spec.label}" — its DLT template is not registered (${why}). `
      + 'Add the id to src/config/smsTemplates.js and set registered:true to enable it.'
    );
    const result = { sent: false, provider: chosen, detail: `template not registered: ${why}` };
    await recordDelivery({ provider: chosen, purpose, to, tenantSlug, result });
    return result;
  }

  const result = await deliver(chosen, to, message, purpose);
  // Logged for every provider including the mock, so the console's activity
  // panel is not empty during a UAT run on the log provider.
  await recordDelivery({ provider: result.provider, purpose, to, tenantSlug, result });
  return result;
}

/**
 * The message to send for a purpose, built from the registered wording.
 *
 * Returns the template id alongside it because the two travel together: the
 * carrier checks the text against the id, and a message whose wording has
 * drifted from its registration is dropped without a delivery report.
 */
export function messageFor(purpose, code, minutes) {
  const key = config.sms.templates[purpose] !== undefined ? purpose : 'login';
  const spec = DLT_TEMPLATES[key];
  const resolved = resolveTemplate(key);
  return {
    templateId: config.sms.templates[key] || '',
    text: fillTemplate(config.sms.text[key], [code, minutes]),
    // Which registration is actually carrying this, when it is not its own.
    usingFallback: resolved.usingFallback,
    /*
     * Whether the carrier will actually carry it.
     *
     * A template awaiting DLT approval has no id, and a message sent without
     * one — or with somebody else's — is accepted by the gateway and dropped by
     * the carrier. Reported here so the caller can decline to send rather than
     * report a success that did not happen.
     */
    registered: spec ? resolved.sendable && !!config.sms.templates[key] : true,
    label: spec ? spec.label : key,
    pendingReason: spec ? spec.pendingReason || null : null,
  };
}

/** Everything the Kaleyra gateway needs before it can send anything. */
export function kaleyraMissing(cfg = config.sms, purpose = 'login') {
  const missing = [];
  if (!cfg.apiKey) missing.push('SMS_API_KEY');
  // Kaleyra puts the account SID in the path, not in a header: without it every
  // request answers 401 "Incorrect SID or API key", which reads as a bad key.
  if (!cfg.sid) missing.push('SMS_SID (the HX… account id from the Kaleyra console)');
  if (!cfg.senderId) missing.push('SMS_SENDER_ID');
  if (!cfg.peId) missing.push('SMS_PE_ID');
  if (!cfg.templates[purpose]) missing.push(`template id for "${purpose}"`);
  // See the note in dltMissing(): IFQMID-T is a six-character header with the
  // transactional category suffix, and is valid.
  if (cfg.senderId && !SENDER_ID_RE.test(cfg.senderId)) {
    missing.push('SMS_SENDER_ID must be 6 characters, optionally followed by -T, -S or -P');
  }
  return missing;
}

async function deliver(chosen, to, message, purpose = 'login') {
  if (chosen === 'log') {
    if (config.env === 'production') {
      // Fail closed. Returning "sent" here would mean users never receive a
      // code while the server cheerfully reports success, and the code itself
      // would be sitting in the log for anyone with log access.
      logger.error('SMS provider is "log" in production — refusing to pretend a code was sent.');
      return { sent: false, provider: 'log', detail: 'log provider disabled in production' };
    }
    logger.info(`[SMS:mock] to ${maskPhone(to)} :: ${message}`);
    return { sent: true, provider: 'log', detail: 'written to server log' };
  }

  if (chosen === 'kaleyra') return sendViaKaleyra(to, message, purpose);
  if (chosen === 'jio_dlt') return sendViaJioDlt(to, message);
  if (chosen === 'msg91') return sendViaMsg91(to, message);
  if (chosen === 'twilio') return sendViaTwilio(to, message);

  logger.warn(`Unknown SMS provider "${chosen}" — message not sent.`);
  return { sent: false, provider: chosen, detail: 'unknown provider' };
}

/**
 * Kaleyra — the contracted gateway, configured from the environment.
 *
 * ── The shape of the request ───────────────────────────────────────────────
 *
 *   POST {endpoint}/v1/{SID}/messages
 *   api-key: <key>
 *   to=+91…&sender=IFQMSK&body=…&type=OTP&template_id=…&pe_id=…
 *
 * The SID is a path segment. Sending the key with no SID, or with the wrong
 * one, returns 401 "Incorrect SID or API key" — which reads as a bad key and
 * sends people to regenerate a key that was fine all along, so it is called out
 * by name in kaleyraMissing() above.
 *
 * `type=OTP` matters: Kaleyra routes OTP traffic separately, and a one-time
 * code sent down the transactional route can be delayed past its own expiry.
 */
async function sendViaKaleyra(to, message, purpose) {
  const cfg = config.sms;
  const missing = kaleyraMissing(cfg, purpose);
  if (missing.length) {
    logger.error(`Kaleyra selected but not configured: ${missing.join(', ')}`);
    return { sent: false, provider: 'kaleyra', detail: `not configured: ${missing.join(', ')}` };
  }

  const url = `${cfg.endpoint}/v1/${encodeURIComponent(cfg.sid)}/messages`;
  const body = new URLSearchParams({
    to: toE164(to),
    // Six characters. A configured "IFQMID-T" is the header plus its category
    // annotation, and the gateway refuses the annotated form outright.
    sender: senderHeader(cfg.senderId),
    body: message,
    type: 'OTP',
    template_id: cfg.templates[purpose] || cfg.templates.login,
    pe_id: cfg.peId,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) {
      logger.error(`Kaleyra responded ${res.status}`);
      return {
        sent: false, provider: 'kaleyra', status: res.status,
        detail: gatewayMessage(text) || `http ${res.status}`,
      };
    }
    return {
      sent: true, provider: 'kaleyra', status: res.status, ref: gatewayRef(text),
      // Accepted by the gateway is not delivered to the handset. A template
      // whose wording has drifted from its registration is accepted here and
      // dropped by the carrier afterwards.
      detail: 'accepted by gateway',
    };
  } catch (e) {
    logger.error('Kaleyra send failed', e.message);
    return { sent: false, provider: 'kaleyra', detail: networkReason(e, url) };
  }
}

/** +91XXXXXXXXXX. Kaleyra wants the country code, and a leading plus. */
function toE164(v, defaultCc = '91') {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 10) return `+${defaultCc}${d}`;
  if (d.length > 10) return `+${d}`;
  return `+${d}`;
}

/**
 * An Indian DLT gateway, configured from the console rather than from env.
 *
 * Per-deployment env variables were fine while no provider had been chosen.
 * They are wrong now: the operator who holds the DLT registration is a member
 * of the IFQM platform team, not somebody with shell access to the host, and
 * asking them to raise a deployment to correct a template ID guarantees the
 * template ID stays wrong.
 */
async function sendViaJioDlt(to, message) {
  const cfg = await dltConfig();
  const missing = dltMissing(cfg);
  if (missing.length) {
    logger.error(`DLT gateway selected but not configured: ${missing.join(', ')}`);
    return { sent: false, provider: 'jio_dlt', detail: `not configured: ${missing.join(', ')}` };
  }

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`,
        // Gateways differ on which header they read the key from. Sending both
        // is harmless and saves a support round trip on first setup.
        'X-API-Key': cfg.api_key,
      },
      body: JSON.stringify({
        // The three DLT identifiers. A message missing any of them is dropped
        // by the carrier without a delivery report.
        entityId: cfg.entity_id,
        senderId: cfg.sender_id,
        templateId: cfg.template_id,
        to: normaliseIndian(to),
        message,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const body = await res.text();
    if (!res.ok) {
      logger.error(`DLT gateway responded ${res.status}`);
      return {
        sent: false, provider: 'jio_dlt', status: res.status,
        detail: gatewayMessage(body) || `http ${res.status}`,
      };
    }
    return {
      sent: true, provider: 'jio_dlt', status: res.status,
      ref: gatewayRef(body),
      // Accepted by the gateway is not the same as delivered to the handset,
      // and saying so here stops the console overclaiming.
      detail: 'accepted by gateway',
    };
  } catch (e) {
    logger.error('DLT gateway send failed', e.message);
    return { sent: false, provider: 'jio_dlt', detail: networkReason(e, cfg.endpoint) };
  }
}

/**
 * Turn a fetch failure into something an operator can act on.
 *
 * Node reports almost every network problem as the bare string "fetch failed",
 * with the real cause one level down in `cause`. Passing that through means the
 * console shows "fetch failed" for a hostname that does not exist, a refused
 * connection and an expired certificate alike — three different problems with
 * three different fixes.
 */
export function networkReason(e, endpoint = '') {
  if (e.name === 'TimeoutError' || e.name === 'AbortError') {
    return 'The gateway did not respond within 15 seconds.';
  }
  const code = e.cause?.code || e.code || '';
  const host = (() => { try { return new URL(endpoint).host; } catch { return 'the endpoint'; } })();
  const map = {
    ENOTFOUND: `${host} does not resolve. Check the endpoint URL with your gateway provider — `
      + 'the default in this field is a placeholder and must be replaced with the real one.',
    EAI_AGAIN: `Could not look up ${host}. This is usually a temporary DNS problem.`,
    ECONNREFUSED: `${host} refused the connection.`,
    ECONNRESET: `${host} closed the connection unexpectedly.`,
    CERT_HAS_EXPIRED: `The TLS certificate for ${host} has expired.`,
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: `The TLS certificate for ${host} could not be verified.`,
  };
  return map[code] || (code ? `${code} talking to ${host}.` : e.message || 'Network error.');
}

/** Pull a request/message id out of whatever shape the gateway answered with. */
function gatewayRef(body) {
  try {
    const j = JSON.parse(body);
    const v = j.requestId || j.request_id || j.messageId || j.message_id || j.id || j.data?.id;
    return v ? String(v).slice(0, 120) : null;
  } catch { return null; }
}

/** The gateway's own explanation, if it gave one, for showing in the console. */
function gatewayMessage(body) {
  try {
    const j = JSON.parse(body);
    const v = j.message || j.error || j.description || j.errorMessage;
    return v ? String(v).slice(0, 200) : null;
  } catch {
    return String(body || '').trim().slice(0, 200) || null;
  }
}

/**
 * Append one row to the delivery log.
 *
 * Never the message body — it carries the code. The recipient is masked before
 * it is written, so the table cannot become a phone directory either.
 */
async function recordDelivery({ provider, purpose, to, tenantSlug, result }) {
  try {
    /*
     * Which registration the message actually went out under.
     *
     * Only the DLT connector filled this in, so every Kaleyra row logged a NULL
     * template — and a NULL here is the one column that could tell a dropped
     * message from a delivered one. "Accepted by the gateway, never reached the
     * handset" is always a template question, and answering it meant guessing
     * which id was in force at the time rather than reading it back.
     */
    let templateId = null;
    let sender = null;
    if (provider === 'jio_dlt') {
      const cfg = await dltConfig();
      templateId = cfg.template_id || null;
      sender = senderHeader(cfg.sender_id) || null;
    } else if (provider === 'kaleyra') {
      templateId = config.sms.templates[purpose] || config.sms.templates.login || null;
      /*
       * The other half of the pair.
       *
       * template_id alone could not answer the question it was added for.
       * Codes stopped arriving with the gateway returning 202 and every row
       * logged ok=1: the ids were registered against IFQMID while the
       * deployment transmitted IFQMSK, a valid sender on the same account but
       * the wrong one for those templates. Kaleyra accepts it and the carrier
       * discards it, silently.
       *
       * "Accepted but never arrived" is always about the id and the header
       * AGREEING, so both belong on the row. As sent, not as configured — the
       * category annotation is stripped before transmission and the log should
       * show what actually went out.
       */
      sender = senderHeader(config.sms.senderId) || null;
    }
    await masterDb().execute(
      `INSERT INTO sms_delivery_log
         (provider, sender, purpose, recipient, tenant_slug, template_id, ok, http_status, gateway_ref, detail)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [provider, sender, purpose, maskPhone(to), tenantSlug, templateId,
        result.sent ? 1 : 0, result.status ?? null,
        result.ref ?? null, (result.detail || '').slice(0, 255) || null]
    );
  } catch (e) {
    // A logging failure must never fail the send it describes.
    logger.warn('sms: could not write delivery log', e.message);
  }
}

/** 'YYYY-MM-DD HH:MM:SS' in local time, the same shape MySQL's NOW() writes. */
export function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Never log a full number. Enough digits to correlate, not enough to reuse. */
export function maskPhone(v) {
  const d = String(v).replace(/\D/g, '');
  return d.length <= 4 ? '****' : `${'*'.repeat(d.length - 4)}${d.slice(-4)}`;
}

async function sendViaMsg91(to, message) {
  const key = process.env.SMS_API_KEY;
  const sender = process.env.SMS_SENDER_ID;
  const template = process.env.SMS_TEMPLATE_ID;
  if (!key || !sender) {
    logger.error('MSG91 selected but SMS_API_KEY / SMS_SENDER_ID are not set.');
    return { sent: false, provider: 'msg91', detail: 'not configured' };
  }
  try {
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: key },
      body: JSON.stringify({
        template_id: template,
        sender,
        // The gateway expects the code as a template variable, not as free
        // text: an unregistered body is dropped by the carrier.
        recipients: [{ mobiles: normaliseIndian(to), OTP: extractCode(message) }],
      }),
    });
    if (!res.ok) {
      logger.error(`MSG91 responded ${res.status}`);
      return { sent: false, provider: 'msg91', detail: `http ${res.status}` };
    }
    return { sent: true, provider: 'msg91' };
  } catch (e) {
    logger.error('MSG91 send failed', e.message);
    return { sent: false, provider: 'msg91', detail: e.message };
  }
}

async function sendViaTwilio(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    logger.error('Twilio selected but TWILIO_* variables are not set.');
    return { sent: false, provider: 'twilio', detail: 'not configured' };
  }
  try {
    const body = new URLSearchParams({ To: to, From: from, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) return { sent: false, provider: 'twilio', detail: `http ${res.status}` };
    return { sent: true, provider: 'twilio' };
  } catch (e) {
    logger.error('Twilio send failed', e.message);
    return { sent: false, provider: 'twilio', detail: e.message };
  }
}

/** MSG91 wants 91XXXXXXXXXX. Accept whatever the user typed and normalise. */
function normaliseIndian(v) {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  return d;
}

const extractCode = (message) => (String(message).match(/\b(\d{4,8})\b/) || [])[1] || '';

/**
 * Fill a DLT template's {#var#} placeholders, left to right.
 *
 * The wording must come from the registered template rather than from a string
 * literal in this file. If the two ever drift — someone edits the sentence here
 * to read better — every message starts being dropped by the carrier with no
 * error anywhere, and the cause is invisible from inside the application.
 */
export function fillTemplate(template, vars = []) {
  let i = 0;
  return String(template || '').replace(/\{#var#\}/g, () => String(vars[i++] ?? ''));
}

/**
 * Does this message still match the registered template?
 *
 * Compares the two with every placeholder's substitution allowed to be
 * anything. A mismatch is the single most common cause of "the gateway says
 * accepted and nothing arrives", so it is worth catching before the send
 * rather than after a support call.
 */
export function matchesTemplate(template, message) {
  const t = String(template || '').trim();
  if (!t) return true;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.split(/\\\{#var#\\\}/).join('(.+?)');
  return new RegExp(`^${pattern}$`, 's').test(String(message || '').trim());
}

/**
 * Send a real message to one number, for the console's Test Connection button.
 *
 * Deliberately a real send. A test that only checks the credentials parse would
 * pass on a template ID that the carrier has never approved, which is exactly
 * the failure this button exists to catch — so it goes all the way to the
 * gateway and reports what came back.
 */
export async function sendTestSms(phone, { provider } = {}) {
  // Defaulting to jio_dlt meant this button tested a connector the deployment
  // was not using: on a Kaleyra deployment it reported the DLT connector's
  // configuration state, so "Test Connection" could fail while sign-in codes
  // were going out fine, or pass while they were not.
  const chosen = (provider || effectiveProvider()).toLowerCase();
  const cfg = await dltConfig();

  if (chosen === 'jio_dlt') {
    const missing = dltMissing(cfg);
    if (missing.length) {
      return { sent: false, provider: chosen, detail: `Not configured: ${missing.join(', ')}` };
    }
  }
  if (chosen === 'kaleyra') {
    const missing = kaleyraMissing(config.sms, 'login');
    if (missing.length) {
      return { sent: false, provider: chosen, detail: `Not configured: ${missing.join(', ')}` };
    }
  }

  /*
   * Built from the registered wording so the test exercises the same path a
   * real code takes, including the substitution — and, more importantly, so it
   * carries the same text the carrier will check against the template id. A
   * test that sent a literal would be accepted by the gateway and dropped by
   * the carrier, reporting a pass for a configuration that cannot deliver.
   */
  let message;
  if (chosen === 'jio_dlt' && cfg.template_text) {
    message = fillTemplate(cfg.template_text, ['000000', '5']);
  } else if (chosen === 'kaleyra') {
    message = messageFor('login', '000000', 5).text;
  } else {
    message = '000000 is your Kalpion sign-in code. It expires in 5 minute(s). Do not share it with anyone.';
  }

  const result = await deliver(chosen, String(phone || '').trim(), message);
  await recordDelivery({ provider: result.provider, purpose: 'test', to: phone, tenantSlug: null, result });

  // Remember the outcome, so the console can show when the gateway was last
  // proven to work rather than only that somebody filled the fields in.
  try {
    const stamp = [
      // Local time, to match the NOW() used by every other timestamp in
      // these tables. toISOString() is UTC, which showed the last test as
      // five and a half hours before the log row it wrote.
      ['sms_dlt_last_test_at', localStamp()],
      ['sms_dlt_last_test_ok', result.sent ? '1' : '0'],
      ['sms_dlt_last_test_note', (result.detail || '').slice(0, 255)],
    ];
    for (const [k, v] of stamp) {
      await masterDb().execute(
        `INSERT INTO platform_settings (key_name, value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`, [k, v]
      );
    }
  } catch (e) {
    logger.warn('sms: could not record test result', e.message);
  }

  return result;
}

/** The most recent send attempts, for the console's activity panel. */
export async function recentDeliveries(limit = 20) {
  const n = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  try {
    const [rows] = await masterDb().query(
      `SELECT id, provider, purpose, recipient, tenant_slug, ok, http_status,
              gateway_ref, detail, created_at
         FROM sms_delivery_log ORDER BY id DESC LIMIT ${n}`
    );
    return rows;
  } catch { return []; }
}

export default {
  sendSms, sendTestSms, maskPhone, dltConfig, dltMissing,
  fillTemplate, matchesTemplate, recentDeliveries,
  messageFor, kaleyraMissing, smsReady,
};

/**
 * Can a code actually be sent by SMS right now?
 *
 * Asked before offering the option, and before telling somebody a code is on
 * its way. Reported as a reason rather than a boolean so a failure names the
 * setting that is missing instead of "SMS is unavailable".
 */
export function smsReady(purpose = 'login') {
  const chosen = (config.sms.provider || providerFromEnv() || '').toLowerCase();
  if (!chosen) return { ready: false, reason: 'SMS_PROVIDER is not set.' };
  if (chosen === 'log') {
    return config.env === 'production'
      ? { ready: false, reason: 'The mock provider is refused in production.' }
      : { ready: true, reason: 'Codes are written to the server log, not sent.' };
  }
  if (chosen === 'kaleyra') {
    const missing = kaleyraMissing(config.sms, purpose);
    return missing.length
      ? { ready: false, reason: `Incomplete: ${missing.join(', ')}.` }
      : { ready: true, reason: 'Kaleyra configured.' };
  }
  if (chosen === 'jio_dlt') return { ready: false, reason: 'Configured in the platform console, not here.' };
  if (chosen === 'msg91') {
    return process.env.SMS_API_KEY && process.env.SMS_SENDER_ID
      ? { ready: true, reason: 'MSG91 configured.' } : { ready: false, reason: 'SMS_API_KEY / SMS_SENDER_ID unset.' };
  }
  if (chosen === 'twilio') {
    return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM
      ? { ready: true, reason: 'Twilio configured.' } : { ready: false, reason: 'TWILIO_* unset.' };
  }
  return { ready: false, reason: `Unknown provider "${chosen}".` };
}
