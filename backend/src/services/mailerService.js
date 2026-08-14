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
    /*
     * Cap the DNS lookup. This is the difference between mail working and not.
     *
     * nodemailer resolves A and then AAAA before every cold connection, and it
     * resolves AAAA unconditionally — succeeding on IPv4 does not skip it. It
     * only skips the family when the host has no interface of that family at
     * all, and a Wi-Fi link-local fe80:: address counts as one.
     *
     * On a network whose resolver never answers AAAA, that lookup runs to
     * nodemailer's own DNS_TIMEOUT (30s) and retries past a minute, so the 15s
     * connectionTimeout above fires and every send fails with "Connection
     * timeout" — while the host resolves over IPv4 in 8ms and the connection
     * itself takes ~110ms. Measured here: 66s and failing, against 1.4s and a
     * "250 Message received" with this set.
     *
     * 2s is far above a working resolver's latency and far below the budget,
     * so it costs a healthy network nothing and rescues a broken one. It has
     * to be the DNS timeout rather than a larger connectionTimeout: waiting a
     * minute for a sign-in code is its own failure.
     */
    dnsTimeout: 2000,
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
/*
 * ── Why SMTP gets skipped after it fails ───────────────────────────────────
 *
 * Some hosts block outbound SMTP outright — Render's free instances do. There
 * the connection does not refuse, it HANGS, so every send sat for the full
 * connectionTimeout before falling through to the HTTPS route. A person
 * registering an account clicked Submit and waited sixteen seconds for a form
 * to respond, on every attempt.
 *
 * So a connection-level failure is remembered, and for the next few minutes
 * sends go straight to the API. Only the first attempt in each window pays the
 * timeout. Deliberately NOT permanent: a blocked port and a brief network fault
 * look identical from here, and the second heals.
 *
 * Authentication failures are excluded — a wrong password is not a reason to
 * stop trying the transport, and it would come back the moment it is corrected.
 */
const SMTP_COOLDOWN_MS = 5 * 60 * 1000;
let smtpDeadUntil = 0;

const isConnectionFailure = (err) => {
  const code = String(err?.code || '').trim();
  // ECONNECTION and EDNS are nodemailer's own wrappings; the rest come from the
  // socket. A blocked port shows up as ETIMEDOUT — the case this exists for.
  return [
    'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ESOCKET', 'ECONNECTION',
    'EDNS', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH',
  ].includes(code) || /timeout|timed out/i.test(err?.message || '');
};

/**
 * Send over ZeptoMail's REST API, on 443.
 *
 * Extracted so both routes into it share one implementation: the catch below
 * when SMTP has just failed, and the skip above it once SMTP is known to be
 * unreachable. Returns false rather than throwing — every caller has its own
 * idea of what to do next.
 */
async function sendViaZeptoApi({ to, toName, subject, bodyHtml }) {
  const { user, pass, from, fromName, apiKey: configured } = config.platformMail;
  /*
   * The API token, NOT the SMTP password. This used to be `pass || user`, which
   * sends the SMTP password as a `Zoho-enczapikey` and earns a 401 every time —
   * so on a host that blocks outbound SMTP the fallback could never have
   * worked, and the failure reported itself as a mail problem rather than a
   * wrong-credential one. ZeptoMail issues the two separately: emailappsmtp…
   * for SMTP, emailapikey for this.
   */
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
      }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (res.ok) {
      logger.info(`email: delivered to ${maskEmail(to)} via ZeptoMail HTTPS API`);
      return true;
    }
    // 401 here almost always means PLATFORM_MAIL_API_KEY is unset and the SMTP
    // password was used instead, so say that rather than only the status.
    logger.error(
      `ZeptoMail HTTPS API responded ${res.status}: ${text.slice(0, 150)}`
      + (res.status === 401 && !configured
        ? ' — no PLATFORM_MAIL_API_KEY is set, so the SMTP password was sent as the API token.'
        : '')
    );
    return false;
  } catch (e) {
    logger.error(`ZeptoMail HTTPS API failed (${e.message})`);
    return false;
  }
}

export async function sendViaPlatform(toEmail, toName, subject, bodyHtml) {
  const { host, port, from, fromName } = config.platformMail;

  // SMTP is known unreachable — go straight over HTTPS rather than making the
  // caller wait out the connection timeout again.
  if (platformMailReady() && Date.now() < smtpDeadUntil) {
    if (await sendViaZeptoApi({ to: toEmail, toName, subject, bodyHtml })) return true;
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
      });
      logger.info(`email: delivered to ${maskEmail(toEmail)} via platform SMTP (${host}:${port})`);
      smtpDeadUntil = 0; // it works after all — stop skipping it
      return true;
    } catch (err) {
      if (isConnectionFailure(err)) {
        smtpDeadUntil = Date.now() + SMTP_COOLDOWN_MS;
        logger.warn(
          `platform SMTP could not be reached (${err.message}) — skipping it for `
          + `${SMTP_COOLDOWN_MS / 60000} minutes so sends stop waiting on a blocked port. `
          + 'If this host blocks outbound SMTP, set PLATFORM_MAIL_API_KEY and mail will go over HTTPS instead.'
        );
      }
      logger.warn(`platform SMTP failed (${err.message}) — attempting ZeptoMail HTTP REST API fallback on port 443...`);
      if (await sendViaZeptoApi({ to: toEmail, toName, subject, bodyHtml })) return true;
      throw err;
    }
  }

  // No SMTP account in the environment — fall back to a console-configured API.
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
    // If SMTP times out (e.g. Render/Cloud host firewall blocking port 587), check HTTPS REST API on port 443!
    try {
      const apiKey = config.platformMail.pass || config.platformMail.user;
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
    // Same AAAA-lookup stall as the platform transport above, and worse here:
    // this one is built per send rather than memoised, so it never gets the
    // benefit of nodemailer's DNS cache and pays the wait every time.
    dnsTimeout: 2000,
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
