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
import logger from '../utils/logger.js';
import { mailConfig, sendZeptoMail } from './zeptoMailService.js';

/**
 * The platform-wide sender, used when no tenant SMTP applies.
 *
 * Throws rather than returning false on failure, because that is the contract
 * sendSmtpEmail already has with the queue processor: a thrown error marks the
 * row failed and leaves it visible, whereas a quiet false would mark it sent.
 */
export async function sendViaPlatform(toEmail, toName, subject, bodyHtml) {
  const cfg = await mailConfig();
  if (cfg.zepto_enabled && cfg.token && cfg.endpoint) {
    const r = await sendZeptoMail({ to: toEmail, toName, subject, html: bodyHtml, cfg });
    if (r.sent) return true;
    logger.warn(`ZeptoMail HTTP API failed (${r.detail || 'unknown error'}). Falling back to direct ZeptoMail SMTP...`);
  }

  // Direct Nodemailer fallback to smtp.zeptomail.in:587
  const host = cfg.smtp_host || 'smtp.zeptomail.in';
  const port = cfg.smtp_port || 587;
  const user = cfg.smtp_user || 'emailappsmtp.3c0dea98bc74b18e';
  const pass = cfg.smtp_pass || 'CrSGv1Zhym0e';
  const from = cfg.from || 'noreply@ifqm.org.in';
  const fromName = cfg.from_name || 'IFQM Platform';

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
  });

  const safeFrom = headerSafe(from);
  const safeFromName = headerSafe(fromName);
  const safeTo = headerSafe(toEmail);

  await transport.sendMail({
    from: safeFromName ? `"${safeFromName}" <${safeFrom}>` : safeFrom,
    to: toName ? `"${headerSafe(toName)}" <${safeTo}>` : safeTo,
    subject: headerSafe(subject),
    html: bodyHtml,
  });

  logger.info(`email: delivered to ${toEmail} via ZeptoMail SMTP (${host}:${port})`);
  return true;
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
  if (!String(settings.smtp_host || '').trim()) {
    const cfg = await mailConfig();
    if (!cfg.zepto_enabled) {
      logger.warn('processEmailQueue: no SMTP host for this organisation and no platform '
        + 'mail provider — queued mail cannot be delivered.');
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

export default { getOrgSettings, sendSmtpEmail, queueEmail, processEmailQueue };
