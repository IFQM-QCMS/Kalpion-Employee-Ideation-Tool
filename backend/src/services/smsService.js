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
 *   msg91     an Indian transactional SMS gateway, widely used for OTP because
 *             it handles DLT registration.
 *   twilio    international.
 *
 * "SMS tag" in the minutes is the DLT sender ID / template registration Indian
 * operators require: an unregistered template is silently dropped by the
 * carrier, which looks exactly like a bug in this application. Hence
 * SMS_SENDER_ID and SMS_TEMPLATE_ID below, and the warning in the docs.
 */
import config from '../config/index.js';
import logger from '../utils/logger.js';

const providerFromEnv = () => (process.env.SMS_PROVIDER || '').trim().toLowerCase();

/**
 * Send one text message.
 * @returns {Promise<{ sent: boolean, provider: string, detail?: string }>}
 */
export async function sendSms(phone, message, { provider } = {}) {
  const chosen = (provider || providerFromEnv() || 'log').toLowerCase();
  const to = String(phone || '').trim();
  if (!to) return { sent: false, provider: chosen, detail: 'no recipient' };

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

  if (chosen === 'msg91') return sendViaMsg91(to, message);
  if (chosen === 'twilio') return sendViaTwilio(to, message);

  logger.warn(`Unknown SMS provider "${chosen}" — message not sent.`);
  return { sent: false, provider: chosen, detail: 'unknown provider' };
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

export default { sendSms, maskPhone };
