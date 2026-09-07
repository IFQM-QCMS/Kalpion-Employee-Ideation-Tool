/** Email service - Node/nodemailer equivalent of PHP api/mailer.php. */
import nodemailer from 'nodemailer';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { mailConfig, sendZeptoMail } from './zeptoMailService.js';

/** Is the platform's own sender configured? */
export function platformMailReady(cfg = config.platformMail) {
  // "Can this deployment send mail at all?".
  if (cfg.transport === 'api') return !!(cfg.apiKey && cfg.from);
  return !!(cfg.host && cfg.user && cfg.pass && cfg.from);
}

/** The platform transport, built once. */
let platformTransport = null;
function getPlatformTransport() {
  if (platformTransport) return platformTransport;
  const { host, port, user, pass } = config.platformMail;

  platformTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,          // implicit TLS
    // On 587 STARTTLS is only offered, not required - without this nodemailer will happily
    // continue in the clear if the server declines the upgrade, putting the SMTP password and
    // the sign-in code on the wire.
    requireTLS: port !== 465,
    // Verified, deliberately. This was `rejectUnauthorized: false`, which accepts any
    // certificate at all: it turns TLS into encryption without authentication, so anything
    // able to answer for the host can read the credentials and every code that goes through
    // it.
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    // Cap the DNS lookup. This is the difference between mail working and not.
    dnsTimeout: 2000,
  });
  return platformTransport;
}

/** Send one message as the platform, rather than as a customer. */
// Some hosts block outbound SMTP outright - Render's free instances do.
const SMTP_COOLDOWN_MS = 5 * 60 * 1000;
let smtpDeadUntil = 0;

const isConnectionFailure = (err) => {
  const code = String(err?.code || '').trim();
  // ECONNECTION and EDNS are nodemailer's own wrappings; the rest come from the socket. A
  // blocked port shows up as ETIMEDOUT - the case this exists for.
  return [
    'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ESOCKET', 'ECONNECTION',
    'EDNS', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
  ].includes(code) || /timeout|timed out/i.test(err?.message || '');
};

/** Send over ZeptoMail's REST API, on 443. */

async function sendViaZeptoApi({ to, toName, subject, bodyHtml, attachments = [] }) {
  const { user, pass, from, fromName, apiKey: configured } = config.platformMail;
  // The API token, NOT the SMTP password.
  const apiKey = configured || pass || user;
  if (!apiKey) return false;
  const safeTo = headerSafe(to);
  try {
    const res = await fetch('https://api.zeptomail.in/v1.1/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: /^zoho-enczapikey\s/i.test(apiKey) ? apiKey : `Zoho-enczapikey ${apiKey}`,
      },
      body: JSON.stringify({
        from: { address: from, name: headerSafe(fromName) },
        to: [{ email_address: { address: safeTo, ...(toName ? { name: headerSafe(toName) } : {}) } }],
        subject: headerSafe(subject),
        htmlbody: bodyHtml,
        ...(attachments.length ? {
          attachments: attachments.map((a) => ({
            content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : String(a.content),
            mime_type: a.contentType || 'application/octet-stream',
            name: headerSafe(a.filename || 'attachment'),
          })),
        } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (res.ok) {
      logger.info(`email: delivered to ${maskEmail(to)} via ZeptoMail HTTPS API`);
      return true;
    }
    // 401 here almost always means PLATFORM_MAIL_API_KEY is unset and the SMTP password was
    // used instead, so say that rather than only the status.
    logger.error(
      `ZeptoMail HTTPS API responded ${res.status}: ${text.slice(0, 150)}`
      + (res.status === 401 && !configured
        ? ' - no PLATFORM_MAIL_API_KEY is set, so the SMTP password was sent as the API token.'
        : '')
    );
    return false;
  } catch (e) {
    logger.error(`ZeptoMail HTTPS API failed (${e.message})`);
    return false;
  }
}

export async function sendViaPlatform(toEmail, toName, subject, bodyHtml, attachments = []) {
  // No address is a normal state, not an error.
  if (!String(toEmail || '').trim()) {
    return { success: false, skipped: true, error: 'No email address on file for this recipient.' };
  }

  const { host, port, from, fromName, transport } = config.platformMail;

  // HTTPS only, because this host is known to block SMTP.
  if (transport === 'api') {
    if (await sendViaZeptoApi({ to: toEmail, toName, subject, bodyHtml, attachments })) return true;
    throw new Error(
      'Platform mail could not be sent. PLATFORM_MAIL_TRANSPORT is "api", so SMTP '
      + 'was not attempted - check PLATFORM_MAIL_API_KEY holds the provider\'s API '
      + 'token (not the SMTP password) and that the sender domain is still verified.'
    );
  }

  // SMTP is known unreachable - go straight over HTTPS rather than making the caller wait
  // out the connection timeout again.
  if (platformMailReady() && Date.now() < smtpDeadUntil) {
    if (await sendViaZeptoApi({ to: toEmail, toName, subject, bodyHtml, attachments })) return true;
    throw new Error(
      'Platform mail could not be sent: SMTP is unreachable from this host and the '
      + 'HTTPS API was refused. Set PLATFORM_MAIL_API_KEY to the ZeptoMail '
      + '"emailapikey" token (not the SMTP password).'
    );
  }

  if (platformMailReady()) {
    const safeTo = headerSafe(toEmail);
    try {
      await getPlatformTransport().sendMail({
        from: { name: headerSafe(fromName), address: headerSafe(from) },
        to: toName ? { name: headerSafe(toName), address: safeTo } : safeTo,
        subject: headerSafe(subject),
        html: bodyHtml,
        ...(attachments.length ? { attachments } : {}),
      });
      logger.info(`email: delivered to ${maskEmail(toEmail)} via platform SMTP (${host}:${port})`);
      smtpDeadUntil = 0; // it works after all - stop skipping it
      return true;
    } catch (err) {
      if (isConnectionFailure(err)) {
        smtpDeadUntil = Date.now() + SMTP_COOLDOWN_MS;
        logger.warn(
          `platform SMTP could not be reached (${err.message}) - skipping it for `
          + `${SMTP_COOLDOWN_MS / 60000} minutes so sends stop waiting on a blocked port. `
          + 'If this host blocks outbound SMTP, set PLATFORM_MAIL_API_KEY and mail will go over HTTPS instead.'
        );
      }
      logger.warn(`platform SMTP failed (${err.message}) - attempting ZeptoMail HTTP REST API fallback on port 443...`);
      if (await sendViaZeptoApi({ to: toEmail, toName, subject, bodyHtml, attachments })) return true;
      throw err;
    }
  }

  // No SMTP account in the environment - fall back to a console-configured API.
  const cfg = await mailConfig();
  if (cfg.zepto_enabled && cfg.token && cfg.endpoint) {
    const r = await sendZeptoMail({ to: toEmail, toName, subject, html: bodyHtml, cfg });
    if (r.sent) return true;
    throw new Error(r.detail || 'The platform mail provider refused the message.');
  }

  throw new Error(
    'Platform mail is not configured. '
    + 'Set PLATFORM_SMTP_HOST / PLATFORM_SMTP_USER / PLATFORM_SMTP_PASS / PLATFORM_MAIL_FROM.'
  );
}

/** Prove the account works, without needing a recipient. */
export async function verifyPlatformMail() {
  if (!platformMailReady()) return { ok: false, detail: 'not configured' };
  // On the API transport there is nothing to verify by opening a socket, and probing SMTP
  // would report "NOT working" at every boot for a deployment that sends perfectly well over
  // 443.
  if (config.platformMail.transport === 'api') {
    return { ok: true, detail: 'HTTPS API (SMTP not attempted)' };
  }
  try {
    await getPlatformTransport().verify();
    return { ok: true, detail: `${config.platformMail.host}:${config.platformMail.port}` };
  } catch (e) {
    // If SMTP times out (e.g. Render/Cloud host firewall blocking port 587), check HTTPS REST
    // API on port 443!
    try {
      const apiKey = config.platformMail.apiKey || config.platformMail.pass || config.platformMail.user;
      const httpRes = await fetch('https://api.zeptomail.in/v1.1/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': /^zoho-enczapikey\s/i.test(apiKey) ? apiKey : `Zoho-enczapikey ${apiKey}`,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10000),
      });
      if (httpRes.status < 500) {
        return { ok: true, detail: `https://api.zeptomail.in:443 (HTTP REST API ready, SMTP timed out: ${e.message})` };
      }
    } catch {}
    return { ok: false, detail: e.message };
  }
}

/** Enough of an address to correlate a log line, not enough to harvest one. */
export function maskEmail(v) {
  const [name = '', domain = ''] = String(v).split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}

/** Fetch all org_settings as a keyvalue map (PHP getOrgSettings). */
export async function getOrgSettings(db) {
  try {
    const [rows] = await db.query('SELECT key_name, value FROM org_settings');
    const map = {};
    for (const r of rows) map[r.key_name] = r.value;
    return map;
  } catch (e) {
    logger.error('getOrgSettings error', e.message);
    return {};
  }
}

/** Build a nodemailer transport from org_settings (mirrors sendSmtpEmail setup). */
function buildTransport(settings) {
  const host = String(settings.smtp_host || '').trim();
  const port = parseInt(settings.smtp_port || '587', 10) || 587;
  const user = String(settings.smtp_user || '').trim();
  const pass = settings.smtp_pass || '';

  if (!host) throw new Error('smtp_host is not configured.');

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // implicit TLS
    // On 587, STARTTLS is normally opportunistic - if the server doesn't offer it, nodemailer
    // would happily send the SMTP password in the clear.
    requireTLS: port !== 465,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    // Same AAAA-lookup stall as the platform transport above, and worse here: this one is
    // built per send rather than memoised, so it never gets the benefit of nodemailer's DNS
    // cache and pays the wait every time.
    dnsTimeout: 2000,
  });
}

/** Strip CR/LF (and quotes) from anything interpolated into an address header. */
function headerSafe(s) {
  return String(s ?? '').replace(/[\r\n"<>]/g, ' ').trim();
}

/*
 * Send one HTML email. Returns true on success; throws on SMTP error (matching the PHP
 * contract used by the queue processor).
 */
export async function sendSmtpEmail(settings, toEmail, toName, subject, bodyHtml) {
  // No address is a normal state, not an error.
  if (!String(toEmail || '').trim()) {
    return { success: false, skipped: true, error: 'No email address on file for this recipient.' };
  }

  // A tenant with its own SMTP host keeps using it - mail appearing to come from the
  // customer's own domain is a feature.
  if (!String(settings?.smtp_host || '').trim()) {
    return sendViaPlatform(toEmail, toName, subject, bodyHtml);
  }
  const transport = buildTransport(settings);
  const from = headerSafe(settings.smtp_from || settings.smtp_user || '');
  const fromName = headerSafe(settings.smtp_from_name || 'Kalpion');
  const safeTo = headerSafe(toEmail);

  await transport.sendMail({
    from: { name: fromName, address: from },
    to: toName ? { name: headerSafe(toName), address: safeTo } : safeTo,
    subject: headerSafe(subject),
    html: bodyHtml,
  });
  return true;
}

/** Insert an email into the queue (PHP queueEmail). */
/** Send somebody the temporary password their account was created with. */
export async function sendTemporaryPassword({ email, name, orgName, slug, password, reason }) {
  if (!String(email || '').trim() || !password) return false;

  const esc = (v) => String(v == null ? '' : v).replace(/[<>&]/g, '');
  const lead = reason === 'reset'
    ? `The password for your Kalpion administrator account at <b>${esc(orgName)}</b> has been reset.`
    : `Your Kalpion workspace for <b>${esc(orgName)}</b> is ready.`;

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>Hello ${esc(name) || 'there'},</p>
  <p>${lead}</p>
  <table style="border-collapse:collapse;font-size:14px;margin:14px 0">
    <tr><td style="padding:4px 14px 4px 0;color:#667089">Sign in with</td>
        <td style="padding:4px 0"><b>${esc(email)}</b></td></tr>
    ${slug ? `<tr><td style="padding:4px 14px 4px 0;color:#667089">Organisation code</td>
        <td style="padding:4px 0"><b>${esc(slug)}</b></td></tr>` : ''}
    <tr><td style="padding:4px 14px 4px 0;color:#667089">Temporary password</td>
        <td style="padding:4px 0"><b style="font-family:Consolas,monospace;font-size:16px;
            background:#F4F4F4;padding:3px 8px;border-radius:4px">${esc(password)}</b></td></tr>
  </table>
  <p>You will be asked to choose your own password the first time you sign in.
  Until you do, this one is the only thing standing in front of your organisation's
  account - so please sign in soon, and do not forward this message.</p>
  <p style="color:#667089;margin-top:18px">If you were not expecting this, tell us straight away.</p>
</div>`;

  const subject = reason === 'reset'
    ? 'Your IFQM administrator password has been reset'
    : `Your Kalpion workspace for ${orgName} is ready`;

  try {
    const res = await sendViaPlatform(email, name, subject, html);
    // sendViaPlatform reports a missing address as {skipped:true} rather than throwing, so a
    // falsy success has to be read as "not delivered".
    return !(res && res.success === false);
  } catch (e) {
    logger.warn(`temporary password email to ${email} failed: ${e.message}`);
    return false;
  }
}

export async function queueEmail(db, toEmail, toName, subject, body) {
  if (!String(toEmail || '').trim()) return { success: false, skipped: true };
  try {
    await db.execute(
      `INSERT INTO email_queue (to_email, to_name, subject, body, status, attempts, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, NOW())`,
      [toEmail, toName, subject, body]
    );
  } catch (e) {
    logger.error('queueEmail error', e.message);
  }
}

/** How long a queued notification is still worth delivering. */
const MAX_QUEUE_AGE_DAYS = 3;

/** Process up to 5 pending emails (PHP processEmailQueue). */
export async function processEmailQueue(db) {
  const settings = await getOrgSettings(db);

  // Retire anything too old to be true any more - first, before any gate.
  try {
    await db.execute(
      `UPDATE email_queue SET status = 'failed'
        WHERE status = 'pending' AND created_at < NOW() - INTERVAL ? DAY`,
      [MAX_QUEUE_AGE_DAYS]
    );

    // Reclaim rows left mid-flight.
    await db.execute(
      `UPDATE email_queue SET status = 'pending'
        WHERE status = 'processing' AND created_at < NOW() - INTERVAL 15 MINUTE`
    );
  } catch (e) {
    // A tenant whose migration has not run has no 'processing' in its enum. Tidying is not the
    // job; delivering is. Say so once and carry on.
    logger.warn(`processEmailQueue: queue housekeeping skipped - ${e.message}`);
  }

  // This used to read `(settings.email_enabled ??
  if (String(settings.email_enabled ?? '1') === '0') return;

  // No tenant SMTP is no longer a dead end: the platform provider can carry it.
  if (!String(settings.smtp_host || '').trim() && !platformMailReady()) {
    const cfg = await mailConfig();
    if (!cfg.zepto_enabled) {
      logger.warn('processEmailQueue: no SMTP host for this organisation and no platform '
        + 'mail sender - queued mail cannot be delivered.');
      return;
    }
  }

  const [emails] = await db.query(
    `SELECT * FROM email_queue
     WHERE status = 'pending' AND attempts < 5
     ORDER BY created_at ASC
     LIMIT 5`
  );

  for (const email of emails) {
    const id = Number(email.id);

    // Claim the row before sending.
    try {
      await db.execute(
        "UPDATE email_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ?",
        [id]
      );
    } catch (e) {
      logger.warn(`processEmailQueue: could not mark ${id} as processing (${e.code}) `
        + '- run migration 038; continuing without the claim marker');
      await db.execute(
        'UPDATE email_queue SET attempts = attempts + 1 WHERE id = ?', [id]
      );
    }

    try {
      const sent = await sendSmtpEmail(
        settings,
        email.to_email,
        email.to_name,
        email.subject,
        email.body
      );
      await db.execute(
        sent
          ? "UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = ?"
          : "UPDATE email_queue SET status = 'failed' WHERE id = ?",
        [id]
      );
    } catch (e) {
      logger.error(`processEmailQueue send error (id=${id})`, e.message);
      await db.execute("UPDATE email_queue SET status = 'failed' WHERE id = ?", [id]);
    }
  }
}

export default {
  getOrgSettings, sendSmtpEmail, queueEmail, processEmailQueue,
  sendViaPlatform, sendTemporaryPassword, platformMailReady, verifyPlatformMail,
};
