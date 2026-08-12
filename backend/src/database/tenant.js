/**
 * Per-tenant database resolution and connection pooling.
 *
 * Faithfully reproduces the PHP `resolveTenant()` + `db()` behaviour from
 * api/config.php, adapted for a stateless (JWT) world:
 *
 *   PHP priority was: 1) session org_slug  2) ?org= param  3) domain
 *                     4) default tenant     5) hardcoded fallback
 *
 * In the migrated backend the authenticated tenant slug travels inside the
 * JWT (set at login), so for an authenticated request we resolve by that slug.
 * For the login request itself — where there is no token yet — we resolve using
 * the same priority chain the PHP login used: body org_slug → domain → default
 * → fallback.
 *
 * Each distinct tenant database gets its own connection pool, cached by
 * host+db+user so we never open more connections than the PHP `static $pdo`
 * memoisation implied.
 */
import mysql from 'mysql2/promise';
import config from '../config/index.js';
import { masterDb } from './master.js';
import { ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

const poolCache = new Map();

/** The built-in single-tenant fallback — identical to PHP's fallback array. */
export function fallbackTenant(host = 'localhost') {
  return {
    id: 0,
    name: 'IFQM',
    slug: 'ifqm',
    domain: host,
    db_host: config.fallbackDb.host,
    db_name: config.fallbackDb.database,
    db_user: config.fallbackDb.user,
    db_pass: config.fallbackDb.password,
    status: 'active',
    is_default: 1,
    primary_color: '#4f46e5',
  };
}

/**
 * Is this organisation suspended purely because it has not paid?
 *
 * The billing sweep writes a specific note when it puts an organisation on
 * hold, and `markPaid` already reads that note to decide whether paying should
 * reinstate them — "held for money" has to be distinguishable from "held by a
 * person for something else". This is that same rule, named once so the two
 * places cannot drift apart.
 */
export function heldForNonPayment(tenant) {
  return tenant?.status === 'suspended' && /non-payment/i.test(tenant.billing_note || '');
}

/**
 * May this organisation's users still open a session?
 *
 * Active organisations always. Organisations held for non-payment ALSO — and
 * that is the point: an organisation that cannot sign in cannot reach its own
 * billing page, and the only way back was a platform admin recording the
 * payment by hand. Withdrawing the ability to pay from the people you are
 * asking to pay is the wrong way round.
 *
 * They are not getting the product back by signing in. `enforceBilling` in the
 * auth middleware answers 402 to everything except the handful of paths a
 * paused organisation needs — billing, support, branding, notifications — so
 * what a session buys them here is the bill and a way to settle it.
 *
 * An organisation suspended by an operator for any other reason stays hard
 * blocked, exactly as before.
 */
const reachable = (row) => !!row && (row.status === 'active' || heldForNonPayment(row));

/** Sanitise an org slug exactly like PHP: lowercase, [a-z0-9_-] only. */
export function sanitizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function stripPort(host) {
  return String(host || 'localhost').toLowerCase().replace(/:\d+$/, '');
}

/**
 * Resolve a tenant using the PHP login priority chain.
 * @param {{ slug?: string, host?: string }} opts
 * @returns {Promise<object>} tenant row (or fallback)
 */
export async function resolveTenant({ slug = '', host = 'localhost' } = {}) {
  const cleanSlug = sanitizeSlug(slug);
  const cleanHost = stripPort(host);

  let master;
  try {
    master = masterDb();
  } catch (err) {
    return registryUnavailable(err, cleanHost);
  }

  try {
    // An explicit org code is an assertion about WHICH organisation's database
    // to open. If it doesn't match, fail — never fall through to the domain or
    // default tenant, which would quietly authenticate the user against another
    // organisation's data.
    // `status IN ('active','suspended')` rather than active-only, with the
    // decision made by reachable() above — one rule, in one place, instead of
    // the same condition spelled out three times in SQL.
    if (cleanSlug) {
      const [rows] = await master.execute(
        "SELECT * FROM tenants WHERE slug = ? AND status IN ('active','suspended') LIMIT 1",
        [cleanSlug]
      );
      const hit = rows.find(reachable);
      if (hit) return hit;
      throw new ApiError(404, 'Unknown organization code.');
    }

    // No org code given: resolve by domain, then the default tenant.
    let [rows] = await master.execute(
      "SELECT * FROM tenants WHERE domain = ? AND status IN ('active','suspended')",
      [cleanHost]
    );
    let hit = rows.find(reachable);
    if (hit) return hit;

    [rows] = await master.execute(
      "SELECT * FROM tenants WHERE is_default = 1 AND status IN ('active','suspended')"
    );
    hit = rows.find(reachable);
    if (hit) return hit;

    throw new ApiError(404, 'Unknown organization code.');
  } catch (err) {
    if (err instanceof ApiError) throw err; // a real "no such tenant" answer
    return registryUnavailable(err, cleanHost);
  }
}

/**
 * The tenant registry could not be reached. On a dev box we degrade to the
 * built-in fallback tenant; in production that would mean serving a different
 * organisation's database than the caller asked for, so we fail closed.
 */
function registryUnavailable(err, host) {
  if (config.env === 'production') {
    logger.error('Tenant registry (ifqm_master) unavailable', err.message);
    throw new ApiError(503, 'Service temporarily unavailable. Please try again shortly.');
  }
  logger.warn('ifqm_master unavailable, using fallback tenant', err.message);
  return fallbackTenant(host);
}

/** Resolve strictly by slug (used for authenticated requests carrying a JWT). */
export async function resolveTenantBySlug(slug, host = 'localhost') {
  return resolveTenant({ slug, host });
}

/**
 * Get (or lazily create) the connection pool for a tenant.
 * @param {object} tenant  a tenant row from resolveTenant()
 * @returns {import('mysql2/promise').Pool}
 */
export function getTenantPool(tenant) {
  // Credentials come from config, NOT from the tenant row. The registry used to
  // hold a plaintext db_user/db_pass per tenant — in practice root for all of
  // them — which meant the master DB was a list of live root passwords. Only
  // the host and schema name are tenant-specific now.
  const user = config.appDb.user;
  const password = config.appDb.password;
  const host = tenant.db_host || config.masterDb.host;

  const key = `${host}|${tenant.db_name}|${user}`;
  if (poolCache.has(key)) return poolCache.get(key);

  const pool = mysql.createPool({
    host,
    port: config.db.port,
    ssl: config.db.ssl,
    user,
    password,
    database: tenant.db_name,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: config.dbPoolSize,
    maxIdle: Math.min(4, config.dbPoolSize),
    idleTimeout: 60000,
    namedPlaceholders: false,
    dateStrings: true,
    // Real prepared statements (mysql2 default for execute()) — the PDO
    // ATTR_EMULATE_PREPARES=false equivalent. Keeps parameter binding honest.
    multipleStatements: false,
  });
  poolCache.set(key, pool);
  return pool;
}

/** Close every cached pool — used for graceful shutdown. */
export async function closeAllPools() {
  const pools = [...poolCache.values()];
  poolCache.clear();
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
}

export default {
  resolveTenant, resolveTenantBySlug, getTenantPool, fallbackTenant, sanitizeSlug,
  heldForNonPayment, closeAllPools,
};
