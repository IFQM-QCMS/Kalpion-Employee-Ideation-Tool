/**
 * Central configuration loader.
 *
 * Mirrors the constants defined in the PHP `api/config.php` so that the
 * migrated backend behaves identically. Anything that was a `define()` in
 * PHP lives here, sourced from environment variables with the same defaults.
 */
import dotenv from 'dotenv';
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

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),

  // Public base URL of the React frontend — used to build emailed links
  // (e.g. the password-reset URL, which PHP built from getAppBaseUrl()).
  frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:5173',

  // CORS allow-list (Vite dev server, etc.)
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ── Master DB (tenant registry) — MASTER_DB_* in config.php ──
  masterDb: {
    host: process.env.MASTER_DB_HOST || 'localhost',
    user: process.env.MASTER_DB_USER || 'root',
    password: process.env.MASTER_DB_PASS || '',
    database: process.env.MASTER_DB_NAME || 'ifqm_master',
  },

  // ── Built-in fallback tenant — FALLBACK_DB_* in config.php ──
  fallbackDb: {
    host: process.env.FALLBACK_DB_HOST || 'localhost',
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
