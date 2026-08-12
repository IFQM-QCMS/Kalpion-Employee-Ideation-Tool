/**
 * Email service — Node/nodemailer equivalent of PHP api/mailer.php.
 *
 * Preserves the same behaviour:
 *   getOrgSettings(db)                          → all org_settings as a map
 *   queueEmail(db, to, name, subject, body)     → insert into email_queue
 *   processEmailQueue(db)                        → send up to 5 pending emails
 *   sendSmtpEmail(settings, to, name, subj, html)→ deliver one HTML email
 *
 * PHP hand-rolled a raw SMTP conversation supporting STARTTLS (port 587) and
 * implicit TLS (port 465) with AUTH LOGIN. nodemailer performs the identical
 * negotiation from the same org_settings values.
 */
import nodemailer from 'nodemailer';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { mailConfig, sendZeptoMail } from './zeptoMailService.js';

/**
 * Is the platform's own sender configured?
 *
 * All four are required. A host with no credentials, or credentials with no
 * From address, cannot deliver anything — and a half-configured sender that
 * reports itself ready is how sign-in codes end up silently going nowhere.
 */
export function platformMailReady(cfg = config.platformMail) {
  return !!(cfg.host && cfg.user && cfg.pass && cfg.from);
}

/**
 * The platform transport, built once.
 *
 * Memoised because this is on the path of every code and every reset link;
 * building a transport per message re-does the TLS handshake setup for no
 * reason. Not pooled — a pool holds sockets open, and this process should be
 * able to exit when told to.
 */
let platformTransport = null;
function getPlatformTransport() {
  if (platformTransport) return platformTransport;
  const { host, port, user, pass } = config.platformMail;

  platformTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,          // implicit TLS
    // On 587 STARTTLS is only offered, not required — without this nodemailer
    // will happily continue in the clear if the server declines the upgrade,
    // putting the SMTP password and the sign-in code on the wire.
    requireTLS: port !== 465,
    // Verified, deliberately. This was `rejectUnauthorized: false`, which
    // accepts any certificate at all: it turns TLS into encryption without
    // authentication, so anything able to answer for the host can read the
    // credentials and every code that goes through it.
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  return platformTransport;
}

/**
 * Send one message as the platform, rather than as a customer.
 *
 * Used for everything with no tenant SMTP behind it — sign-in codes, password
 * resets, registration mail, billing notices.
 *
 * Two routes, in this order:
 *   1. the SMTP account in the environment (see config.platformMail);
 *   2. the ZeptoMail HTTP API, if a platform admin configured one in the
 *      console. Kept as a fallback so an existing deployment that set it up
 *      that way keeps working; nothing new needs it.
 *
 * Throws rather than returning false on failure, because that is the contract
 * sendSmtpEmail already has with the queue processor: a thrown error marks the
 * row failed and leaves it visible, whereas a quiet false would mark it sent.
 */
export async function sendViaPlatform(toEmail, toName, subject, bodyHtml) {
  const { host, port, from, fromName } = config.platformMail;

  if (platformMailReady()) {
    const safeTo = headerSafe(toEmail);
    await getPlatformTransport().sendMail({
      from: { name: headerSafe(fromName), address: headerSafe(from) },
      to: toName ? { name: headerSafe(toName), address: safeTo } : safeTo,
      subject: headerSafe(subject),
      html: bodyHtml,
    });
    logger.info(`email: delivered to ${maskEmail(toEmail)} via platform SMTP (${host}:${port})`);
    return true;
  }

  // No SMTP account in the environment — fall back to a console-configured API.
  const cfg = await mailConfig();
  if (cfg.zepto_enabled && cfg.token && cfg.endpoint) {
    const r = await sendZeptoMail({ to: toEmail, toName, subject, html: bodyHtml, cfg });
    if (r.sent) return true;
    throw new Error(r.detail || 'The platform mail provider refused the message.');
  }

  throw new Error(
    'No SMTP host for this organisation and no platform mail sender configured. '
    + 'Set PLATFORM_SMTP_HOST / PLATFORM_SMTP_USER / PLATFORM_SMTP_PASS / PLATFORM_MAIL_FROM.'
  );
}

/**
 * Prove the account works, without needing a recipient.
 *
 * `verify()` opens the connection and authenticates, which is what actually
 * goes wrong on first setup — a wrong password and an unverified sender domain
 * both look identical from the outside until something is sent.
 */
export async function verifyPlatformMail() {
  if (!platformMailReady()) return { ok: false, detail: 'not configured' };
  try {
    await getPlatformTransport().verify();
    return { ok: true, detail: `${config.platformMail.host}:${config.platformMail.port}` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

/** Enough of an address to correlate a log line, not enough to harvest one. */
function maskEmail(v) {
  const [name = '', domain = ''] = String(v).split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}

/** Fetch all org_settings as a key→value map (PHP getOrgSettings). */
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
    // On 587, STARTTLS is normally opportunistic — if the server doesn't offer
    // it, nodemailer would happily send the SMTP password in the clear. Require
    // the upgrade instead, and refuse to talk to a server with a bad cert.
    requireTLS: port !== 465,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
}

/**
 * Strip CR/LF (and quotes) from anything interpolated into an address header.
 * The display names come from org settings, i.e. they are admin-controlled
 * input; a newline in one is the classic route to injecting extra SMTP headers
 * (Bcc:, Reply-To:) into the outgoing message.
 */
function headerSafe(s) {
  return String(s ?? '').replace(/[\r\n"<>]/g, ' ').trim();
}

/**
 * Send one HTML email. Returns true on success; throws on SMTP error
 * (matching the PHP contract used by the queue processor).
 */
export async function sendSmtpEmail(settings, toEmail, toName, subject, bodyHtml) {
  /*
   * A tenant with its own SMTP host keeps using it — mail appearing to come
   * from the customer's own domain is a feature. Everything else falls through
   * to the platform provider, which is the only route available for mail with
   * no tenant behind it and the only one that works where the host blocks
   * outbound SMTP ports.
   */
  if (!String(settings?.smtp_host || '').trim()) {
    return sendViaPlatform(toEmail, toName, subject, bodyHtml);
  }
  const transport = buildTransport(settings);
  const from = headerSafe(settings.smtp_from || settings.smtp_user || '');
  const fromName = headerSafe(settings.smtp_from_name || 'IFQM Ideation');
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
export async function queueEmail(db, toEmail, toName, subject, body) {
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

/** Process up to 5 pending emails (PHP processEmailQueue). */
export async function processEmailQueue(db) {
  const settings = await getOrgSettings(db);
  if ((settings.email_enabled ?? '0') !== '1') return;

  // No tenant SMTP is no longer a dead end: the platform provider can carry it.
  // Only give up when neither route exists, and say which is missing — this
  // used to log "smtp_host is not configured" once a minute forever with no
  // hint that a platform-wide provider would solve it.
  if (!String(settings.smtp_host || '').trim() && !platformMailReady()) {
    const cfg = await mailConfig();
    if (!cfg.zepto_enabled) {
      logger.warn('processEmailQueue: no SMTP host for this organisation and no platform '
        + 'mail sender — queued mail cannot be delivered.');
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
    await db.execute(
      "UPDATE email_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ?",
      [id]
    );
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
  sendViaPlatform, platformMailReady, verifyPlatformMail,
};
