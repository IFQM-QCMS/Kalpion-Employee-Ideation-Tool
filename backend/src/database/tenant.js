/** Per-tenant database resolution and connection pooling. */
import mysql from 'mysql2/promise';
import config from '../config/index.js';
import { masterDb } from './master.js';
import { ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';
import { resilientPool, KEEPALIVE_OPTIONS } from './resilient.js';

const poolCache = new Map();

/** The built-in single-tenant fallback - identical to PHP's fallback array. */
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

/** Is this organisation suspended purely because it has not paid? */
export function heldForNonPayment(tenant) {
  return tenant?.status === 'suspended' && /non-payment/i.test(tenant.billing_note || '');
}

/** May this organisation's users still open a session? */
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

/** Resolve a tenant using the PHP login priority chain. */
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
    // An explicit org code is an assertion about WHICH organisation's database to open.
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

/** The tenant registry could not be reached. */
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

/** Get (or lazily create) the connection pool for a tenant. */
/** The most tenant pools this process will hold open at once. */
const MAX_POOLS = Math.max(4, parseInt(process.env.DB_MAX_POOLS, 10) || 50);

/** Drop the least recently used pools until the cache is within its cap. */
function evictIfOverCap() {
  while (poolCache.size > MAX_POOLS) {
    const oldestKey = poolCache.keys().next().value;
    const pool = poolCache.get(oldestKey);
    poolCache.delete(oldestKey);
    logger.info(`db: evicted least-recently-used pool ${oldestKey} (cap ${MAX_POOLS})`);
    // Not awaited - see the note above. Draining happens in the background.
    Promise.resolve()
      .then(() => pool.end())
      .catch((e) => logger.warn(`db: evicted pool did not close cleanly - ${e.message}`));
  }
}

export function getTenantPool(tenant) {
  // Credentials come from config, NOT from the tenant row.
  const user = config.appDb.user;
  const password = config.appDb.password;
  const host = tenant.db_host || config.masterDb.host;

  const key = `${host}|${tenant.db_name}|${user}`;
  if (poolCache.has(key)) {
    // Re-insert so this key moves to the end: Map keeps insertion order, which is what makes
    // the first key the least recently used one.
    const existing = poolCache.get(key);
    poolCache.delete(key);
    poolCache.set(key, existing);
    return existing;
  }

  const raw = mysql.createPool({
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
    namedPlaceholders: false,
    dateStrings: true,
    // Every connection runs in UTC.
    timezone: 'Z',
    // Real prepared statements (mysql2 default for execute()) - the PDO
    // ATTR_EMULATE_PREPARES=false equivalent. Keeps parameter binding honest.
    multipleStatements: false,
    // Keepalive, and the idle timeout that was already here - now shared with the master pool
    // so the two cannot drift.
    ...KEEPALIVE_OPTIONS,
  });

  // `timezone: 'Z'` above only tells mysql2 how to CONVERT Date objects, and with
  // dateStrings it converts nothing at all.
  raw.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'", (err) => {
      if (err) logger.warn(`db: could not pin session to UTC - ${err.message}`);
    });
  });

  // In tests, be as strict as production is.
  if (config.env === 'test') {
    raw.on('connection', (conn) => {
      conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',STRICT_ALL_TABLES')",
        (err) => { if (err) logger.warn(`db: could not pin test session to strict mode - ${err.message}`); });
    });
  }

  const pool = resilientPool(raw, tenant.db_name);
  poolCache.set(key, pool);
  evictIfOverCap();
  return pool;
}

/** How many tenant pools are open, and the cap. Read by the health endpoint. */
export function poolStats() {
  return { open: poolCache.size, max: MAX_POOLS, per_pool: config.dbPoolSize };
}

/** Close every cached pool - used for graceful shutdown. */
export async function closeAllPools() {
  const pools = [...poolCache.values()];
  poolCache.clear();
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
}

export default {
  resolveTenant, resolveTenantBySlug, getTenantPool, poolStats, fallbackTenant, sanitizeSlug,
  heldForNonPayment, closeAllPools,
};
