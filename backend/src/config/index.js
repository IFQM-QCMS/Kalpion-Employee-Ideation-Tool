/**
 * Central configuration loader.
 *
 * Mirrors the constants defined in the PHP `api/config.php` so that the
 * migrated backend behaves identically. Anything that was a `define()` in
 * PHP lives here, sourced from environment variables with the same defaults.
 */
import dotenv from 'dotenv';
import { DLT_TEMPLATES, DLT_SENDER_ID, KALEYRA_SID, resolveTemplate } from './smsTemplates.js';

/** Collected at load, logged once at boot by smsService. */
export const smsTemplateWarnings = [];

/*
 * Build { templates, text } for every purpose, honouring an environment
 * override only when it supplies the id AND the wording.
 */
function smsTemplatePairs() {
  const ENV = {
    login: ['SMS_TEMPLATE_LOGIN', 'SMS_TEXT_LOGIN'],
    password_reset: ['SMS_TEMPLATE_RESET', 'SMS_TEXT_RESET'],
    registration_phone: ['SMS_TEMPLATE_ACTIVATION', 'SMS_TEXT_ACTIVATION'],
    phone_verify: ['SMS_TEMPLATE_ACTIVATION', 'SMS_TEXT_ACTIVATION'],
    phone_changed: ['SMS_TEMPLATE_PHONE_CHANGED', 'SMS_TEXT_PHONE_CHANGED'],
  };

  const templates = {};
  const text = {};

  for (const [purpose, spec] of Object.entries(DLT_TEMPLATES)) {
    const [idKey, textKey] = ENV[purpose] || [];
    const envId = (process.env[idKey] || '').trim();
    const envText = (process.env[textKey] || '').trim();

    if (envId && envText) {
      templates[purpose] = envId;
      text[purpose] = envText;
    } else {
      if (envId || envText) {
        smsTemplateWarnings.push(
          `${idKey}/${textKey}: only one of the pair is set, so both were ignored. `
          + `A template id and its wording must match exactly or the carrier drops the `
          + `message without an error. Using the registered "${spec.label}" instead.`
        );
      }
      /*
       * The resolver, not the raw spec: a purpose awaiting its own id may name
       * a fallback, and the fallback has to supply the id AND the wording
       * together. Reading spec.id here would hand out an empty id beside real
       * text, which is the mismatch this whole module is built to avoid.
       */
      const r = resolveTemplate(purpose);
      templates[purpose] = r.id;
      text[purpose] = r.text;
    }
  }

  return { templates, text };
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load backend/.env regardless of the process cwd.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const INSECURE_JWT_DEFAULT = 'change-this-to-a-long-random-secret-string';
const MIN_SECRET_LENGTH = 32;

/**
 * TLS settings for every MySQL connection, or undefined for a plaintext one.
 *
 * A local XAMPP MySQL speaks plaintext on 3306; every managed provider (Aiven,
 * PlanetScale, …) listens on some other port and rejects unencrypted clients.
 * Both differences are env-gated so the local setup keeps working untouched.
 *
 * DB_SSL_CA (the provider's CA certificate, pasted in full) is what makes the
 * connection *authenticated* as well as encrypted. Without it we still encrypt,
 * but cannot prove the server is the right one — acceptable for a throwaway
 * test deployment, not for real data.
 */
function readDbSsl() {
  if (String(process.env.DB_SSL || '').toLowerCase() !== 'true') return undefined;
  // Accept the PEM either with real newlines (pasting the file into a dashboard
  // field) or with the two-character sequence \n (single-line pastes, .env
  // files, and any tooling that flattens multi-line values). Node's TLS parser
  // rejects the flattened form, and the resulting "unable to get local issuer
  // certificate" is a long way from the actual mistake.
  const ca = (process.env.DB_SSL_CA || '').replace(/\\n/g, '\n').trim();
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}

const dbPort = int(process.env.DB_PORT, 3306);
const dbSsl = readDbSsl();

/*
 * How many proxies sit in front of this application.
 *
 * Express walks back through X-Forwarded-For by this many hops to decide what
 * req.ip is. Set to 1 — one hop — every sign-in on the hosted deployment was
 * recorded from a 10.x.x.x address, because the host runs more than one proxy
 * and one hop back is still its own internal load balancer. The login activity
 * screen was therefore showing the hosting provider's plumbing in a column
 * headed "IP address", which is worse than showing nothing: it looks like
 * evidence.
 *
 * 'true' trusts the whole chain and takes the left-most entry, which is the
 * client. That is right behind a provider whose edge rewrites the header, and
 * wrong behind anything that passes a client-supplied one through — there, a
 * caller can put whatever it likes in X-Forwarded-For and be believed. So it is
 * configuration rather than a constant: the deployment knows its own topology
 * and this file does not.
 */
function readTrustProxy() {
  const raw = (process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!raw) return 1;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

const config = {
  env: process.env.NODE_ENV || 'development',

  // See readTrustProxy above: how many proxy hops to believe.
  trustProxy: readTrustProxy(),
  port: int(process.env.PORT, 4000),

  // Public base URL of the React frontend — used to build emailed links
  // (e.g. the password-reset URL, which PHP built from getAppBaseUrl()).
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:5173',

  // CORS allow-list (Vite dev server, etc.)
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ── Transport settings shared by every MySQL connection ──
  db: { port: dbPort, ssl: dbSsl },

  // ── Master DB (tenant registry) — MASTER_DB_* in config.php ──
  masterDb: {
    host: process.env.MASTER_DB_HOST || 'localhost',
    port: dbPort,
    user: process.env.MASTER_DB_USER || 'root',
    password: process.env.MASTER_DB_PASS || '',
    database: process.env.MASTER_DB_NAME || 'ifqm_master',
  },

  // ── Built-in fallback tenant — FALLBACK_DB_* in config.php ──
  fallbackDb: {
    host: process.env.FALLBACK_DB_HOST || 'localhost',
    port: dbPort,
    user: process.env.FALLBACK_DB_USER || 'root',
    password: process.env.FALLBACK_DB_PASS || '',
    database: process.env.FALLBACK_DB_NAME || 'ifqm_ideation',
  },

  // ── Application DB credentials ──
  // Every tenant database is reached with THIS account, not with credentials
  // stored per-row in ifqm_master.tenants. Storing per-tenant credentials in
  // the registry meant the master DB held plaintext passwords, and in practice
  // every tenant was opened as root. Grant this user rights on `ifqm_%` only
  // (see docs/DEPLOYMENT.md) so a compromise of the app cannot touch anything
  // outside the product's own schemas.
  appDb: {
    user: process.env.APP_DB_USER || process.env.MASTER_DB_USER || 'root',
    password: process.env.APP_DB_PASS ?? process.env.MASTER_DB_PASS ?? '',
  },

  // ── Auth (replaces PHP sessions) ──
  // SESSION_LIFETIME in PHP = 28800 (8h). We reuse it as the JWT lifetime
  // so an idle token expires on the same schedule the PHP idle-session did.
  jwt: {
    secret: process.env.JWT_SECRET || INSECURE_JWT_DEFAULT,
    expiresIn: int(process.env.JWT_EXPIRES_IN, 28800),
  },
  sessionLifetime: int(process.env.JWT_EXPIRES_IN, 28800),

  // Minimum length for any password the app accepts (NIST 800-63B leans on
  // length over composition rules).
  minPasswordLength: int(process.env.MIN_PASSWORD_LENGTH, 12),

  // Force HTTPS + HSTS. Off in dev, on by default anywhere else.
  forceHttps: (process.env.FORCE_HTTPS ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',

  // ── Points — POINTS_* in config.php ──
  points: {
    submit: int(process.env.POINTS_SUBMIT, 10),
    approved: int(process.env.POINTS_APPROVED, 25),
    implemented: int(process.env.POINTS_IMPLEMENTED, 65),
  },

  // ── Uploads — MAX_FILE_MB in config.php ──
  maxFileMb: int(process.env.MAX_FILE_MB, 10),

  // ── DB pool sizing ──
  // Per-pool cap (one pool per tenant schema, plus the master registry).
  // Requests hold a connection for milliseconds, so 10 sustains hundreds of
  // req/s per tenant — but at scale this must be tunable without a deploy.
  // Budget: (number of tenants + 1) × DB_POOL_SIZE must stay under MySQL's
  // max_connections (151 by default — raise it in my.cnf for many tenants).
  dbPoolSize: int(process.env.DB_POOL_SIZE, 10),

  /*
   * ── The platform's own mail sender (ZeptoMail SMTP) ────────────────────────
   *
   * This is the account IFQM sends from when there is no customer SMTP to use:
   * one-time sign-in codes, password-reset links, registration acknowledgements
   * — everything addressed to somebody who is not yet inside a tenant, or whose
   * organisation has never configured a mail server of its own.
   *
   * Deliberately env-only, with no screen anywhere in the product. It is one
   * account belonging to IFQM, set once per deployment; putting it in the
   * platform console would mean a live credential sitting in a database and a
   * form that can break sign-in for every customer with one bad keystroke. The
   * per-tenant SMTP settings screen is unaffected and still wins where a
   * customer has filled it in.
   *
   * These four are all it takes to switch it on — see .env.example:
   *   PLATFORM_SMTP_HOST=smtp.zeptomail.in
   *   PLATFORM_SMTP_USER=emailappsmtp.xxxxxxxx
   *   PLATFORM_SMTP_PASS=…
   *   PLATFORM_MAIL_FROM=noreply@your-domain
   */
  platformMail: {
    host: (process.env.PLATFORM_SMTP_HOST || '').trim(),
    // 465 is implicit TLS, 587 is STARTTLS. ZeptoMail accepts both.
    port: int(process.env.PLATFORM_SMTP_PORT, 587),
    user: (process.env.PLATFORM_SMTP_USER || '').trim(),
    pass: process.env.PLATFORM_SMTP_PASS || '',
    // Must be on a domain verified in ZeptoMail, or every message is rejected.
    from: (process.env.PLATFORM_MAIL_FROM || '').trim(),
    fromName: process.env.PLATFORM_MAIL_FROM_NAME || 'IFQM',
    /*
     * The ZeptoMail HTTP API token — a DIFFERENT credential from the SMTP
     * password above, and the one that matters wherever SMTP is unavailable.
     *
     * ZeptoMail issues two sets: "weaker credentials" (emailappsmtp… + a
     * password) for SMTP, and "more secure credentials" (emailapikey + a
     * `Zoho-enczapikey …` token) for the REST API. The HTTPS fallback in
     * mailerService was sending the SMTP password as the API token, so on a
     * host that blocks SMTP it failed twice: once on the blocked port, then
     * again on a 401 that looked like a mail problem rather than a wrong-key
     * problem.
     *
     * Set this on any deployment whose provider blocks outbound SMTP — Render's
     * free instances do, which is why mail works locally and not there.
     */
    apiKey: (process.env.PLATFORM_MAIL_API_KEY || '').trim(),
    /*
     * Which route to send by: 'auto' | 'api' | 'smtp'.
     *
     * 'auto' (the default) tries SMTP and falls through to the HTTPS API when
     * SMTP cannot be reached. That is right where SMTP usually works, because
     * SMTP is the cheaper path and the fallback is only a rescue.
     *
     * 'api' skips SMTP altogether. On a host that BLOCKS outbound SMTP the port
     * does not refuse, it hangs, so 'auto' pays the full connection timeout on
     * the first send in every cooldown window - sixteen seconds of somebody
     * waiting on a registration form for a route that was never going to work.
     * Where the block is known rather than suspected, saying so is better than
     * rediscovering it on a timer.
     *
     * 'smtp' refuses to fall back, for a deployment that must not have mail
     * leaving by a second route.
     */
    transport: ['auto', 'api', 'smtp']
      .includes((process.env.PLATFORM_MAIL_TRANSPORT || '').trim().toLowerCase())
      ? process.env.PLATFORM_MAIL_TRANSPORT.trim().toLowerCase()
      : 'auto',
  },

  /*
   * ── SMS, for one-time codes ────────────────────────────────────────────────
   *
   * Env-only, for the same reasons as the mail sender above: one gateway
   * account belonging to IFQM, set once per deployment, with no screen anywhere
   * in the product. The platform console's older sms_dlt_* fields still work
   * for a deployment that was set up that way, but anything here wins.
   *
   * ── What India's DLT rules require ─────────────────────────────────────────
   *
   * A transactional SMS carries three registrations, and a message missing any
   * of them is dropped by the carrier silently — no error, no delivery report,
   * nothing to see from inside this application:
   *
   *   pe_id       the business, registered once on the DLT portal
   *   sender_id   the six-character header the recipient sees instead of a number
   *   template_id the exact approved wording — a DIFFERENT id per purpose, which
   *               is why sign-in, reset and activation are three settings and
   *               not one
   *
   * The wording matters as much as the id: the text sent must match the text
   * approved against that id, placeholder for placeholder. The templates below
   * are therefore configurable too, so the registered wording can be pasted in
   * rather than being a literal in this repository that quietly drifts from it.
   */
  sms: {
    // 'kaleyra' | 'jio_dlt' | 'msg91' | 'twilio' | 'log' (dev only)
    provider: (process.env.SMS_PROVIDER || '').trim().toLowerCase(),
    apiKey: (process.env.SMS_API_KEY || '').trim(),
    // Kaleyra's REST base. The account SID is a path segment, not a header.
    endpoint: (process.env.SMS_ENDPOINT || 'https://api.kaleyra.io').replace(/\/+$/, ''),
    // Both default to what is registered, so a deployment only has to supply
    // the API key. Either can still be overridden per environment.
    sid: (process.env.SMS_SID || '').trim() || KALEYRA_SID,
    senderId: (process.env.SMS_SENDER_ID || '').trim() || DLT_SENDER_ID,
    peId: (process.env.SMS_PE_ID || '').trim(),
    /*
     * Template ids and wording come from the DLT registration, not from here.
     *
     * The defaults used to be invented text with two variables ("expires in
     * {#var#} minute(s)"). None of the approved templates say that, and on a
     * DLT gateway a body that does not match its template id is accepted by the
     * gateway and dropped by the carrier — silently.
     *
     * ── Why an override has to supply both halves ─────────────────────────
     *
     * The id and the wording are one thing: the carrier's whole job is to check
     * them against each other. An environment that sets SMS_TEMPLATE_LOGIN and
     * leaves SMS_TEXT_LOGIN empty would pair a stale id with current wording,
     * which is the exact combination that gets dropped — and it is the state a
     * deployment naturally drifts into, because ids get updated and prose does
     * not.
     *
     * So a purpose takes the pair from the environment only when BOTH are
     * present. One without the other is refused, the registered pair is used
     * instead, and the mismatch is reported through smsTemplateWarnings so it
     * is visible at boot rather than in a support ticket about codes not
     * arriving.
     */
    ...smsTemplatePairs(),
  },

  /*
   * Sign-in by one-time code, forced on or off from the environment.
   *
   * `undefined` means "leave it to the platform_settings row", which is the
   * existing behaviour. Set OTP_ENABLED=true to switch the feature on for a
   * deployment without anybody opening the console — the point of configuring
   * delivery here rather than there.
   */
  otpEnabled: process.env.OTP_ENABLED === undefined || process.env.OTP_ENABLED === ''
    ? undefined
    : /^(1|true|yes|on)$/i.test(process.env.OTP_ENABLED),

  // ── AI providers (blank by default → heuristic fallback) ──
  ai: {
    provider: (process.env.AI_PROVIDER || '').trim().toLowerCase(),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
  },

  // ── QCMS integration (approved ideas are pushed to the QCMS tool) ──
  // Default base URL; a tenant may override it in the org admin screen. The
  // per-tenant QCMS API key lives in that tenant's org_settings, never here.
  qcms: {
    baseUrl: (process.env.QCMS_BASE_URL || 'http://localhost:5000/api/v1/integrations').replace(/\/+$/, ''),
  },
};

/**
 * Refuse to boot a production server that is configured insecurely.
 *
 * These were all live defaults during development: the JWT secret was the
 * placeholder string committed in .env.example (anyone reading the repo could
 * forge an admin token for any tenant), and the database was root with an
 * empty password. A silent default is the wrong failure mode for a secret —
 * so in production we crash loudly instead of running wide open.
 *
 * @returns {string[]} problems found (empty when the config is sound)
 */
export function validateConfig(cfg = config) {
  const problems = [];
  const isProd = cfg.env === 'production';

  const secret = cfg.jwt.secret || '';
  if (!secret || secret === INSECURE_JWT_DEFAULT) {
    problems.push(
      'JWT_SECRET is unset or still the example placeholder. Anyone with the repo can forge ' +
      'authentication tokens for any user in any tenant. Generate one with: ' +
      "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET is too short (${secret.length} chars); use at least ${MIN_SECRET_LENGTH}.`);
  }

  if (!cfg.appDb.password) {
    problems.push('Database password is empty (APP_DB_PASS / MASTER_DB_PASS). Set a real password.');
  }
  if (cfg.appDb.user === 'root') {
    problems.push(
      'Database user is "root". Create a least-privilege account limited to the `ifqm_%` schemas ' +
      'and set APP_DB_USER / APP_DB_PASS (see docs/DEPLOYMENT.md).'
    );
  }

  if (isProd) {
    if (!process.env.CORS_ORIGIN) {
      problems.push('CORS_ORIGIN is unset — it would default to localhost. Set your real frontend origin.');
    }
    if (cfg.corsOrigins.some((o) => o.includes('localhost'))) {
      problems.push(`CORS_ORIGIN still allows localhost (${cfg.corsOrigins.join(', ')}).`);
    }
    if (!process.env.FRONTEND_BASE_URL || cfg.frontendBaseUrl.includes('localhost')) {
      problems.push('FRONTEND_BASE_URL still points at localhost — password-reset emails would link there.');
    }
    if (cfg.frontendBaseUrl.startsWith('http://')) {
      problems.push('FRONTEND_BASE_URL is http:// — password-reset links must be https.');
    }
  }

  return problems;
}

/** Crash on insecure production config; warn (but keep going) in development. */
export function assertConfigOrExit(logger = console) {
  const problems = validateConfig();
  if (!problems.length) return;

  const isProd = config.env === 'production';
  // In dev these are advisory — a local XAMPP box really is root/no-password.
  // Logging them at ERROR made a perfectly healthy startup look like a crash.
  const say = isProd ? (m) => logger.error?.(m) : (m) => logger.warn?.(m);

  const banner = isProd
    ? 'REFUSING TO START — INSECURE CONFIG'
    : 'Config warnings (fine for local dev — must be fixed before production)';

  say(`\n${'─'.repeat(72)}\n${banner}\n${'─'.repeat(72)}`);
  problems.forEach((p, i) => say(`  ${i + 1}. ${p}`));
  say('─'.repeat(72));

  if (isProd) {
    logger.error?.('Fix the above in backend/.env, then restart. See docs/DEPLOYMENT.md.\n');
    process.exit(1);
  }
  say('Continuing to start normally.\n');
}

export default config;
