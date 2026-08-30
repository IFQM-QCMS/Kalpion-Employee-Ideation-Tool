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
import { resilientPool, KEEPALIVE_OPTIONS } from './resilient.js';

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
/**
 * The most tenant pools this process will hold open at once.
 *
 * ── The ceiling this removes ───────────────────────────────────────────────
 *
 * Pools were created lazily and never evicted, so open connections grew
 * monotonically with the number of DISTINCT organisations touched since the
 * last restart. Nothing capped it and nothing reclaimed it: at DB_POOL_SIZE
 * connections per organisation, a process that had served enough customers
 * eventually exhausted the server's max_connections and every tenant — including
 * ones already working — started failing to get a connection.
 *
 * It is a slow failure and an unfair one. The organisation that finally trips
 * the limit is not the one that caused it, and a restart appears to "fix" it,
 * which is exactly the shape of problem that gets rebooted for months instead
 * of diagnosed.
 *
 * ── Why LRU, and why an idle pool is safe to close ────────────────────────
 *
 * A tenant nobody has touched recently is the cheapest thing to give up: the
 * cost of eviction is one pool re-creation on their next request, which is a
 * few milliseconds, against a hard failure for everybody otherwise.
 *
 * Closing is deliberately NOT awaited here. pool.end() waits for in-flight
 * queries to finish, and awaiting it would block whoever triggered the eviction
 * behind a stranger's slow query. The pool object is dropped from the cache
 * immediately, so nothing new can be handed out from it while it drains.
 */
const MAX_POOLS = Math.max(4, parseInt(process.env.DB_MAX_POOLS, 10) || 50);

/**
 * Drop the least recently used pools until the cache is within its cap.
 *
 * Map preserves insertion order, and getTenantPool re-inserts on every hit, so
 * the first key is always the least recently used one.
 */
function evictIfOverCap() {
  while (poolCache.size > MAX_POOLS) {
    const oldestKey = poolCache.keys().next().value;
    const pool = poolCache.get(oldestKey);
    poolCache.delete(oldestKey);
    logger.info(`db: evicted least-recently-used pool ${oldestKey} (cap ${MAX_POOLS})`);
    // Not awaited — see the note above. Draining happens in the background.
    Promise.resolve()
      .then(() => pool.end())
      .catch((e) => logger.warn(`db: evicted pool did not close cleanly — ${e.message}`));
  }
}

export function getTenantPool(tenant) {
  // Credentials come from config, NOT from the tenant row. The registry used to
  // hold a plaintext db_user/db_pass per tenant — in practice root for all of
  // them — which meant the master DB was a list of live root passwords. Only
  // the host and schema name are tenant-specific now.
  const user = config.appDb.user;
  const password = config.appDb.password;
  const host = tenant.db_host || config.masterDb.host;

  const key = `${host}|${tenant.db_name}|${user}`;
  if (poolCache.has(key)) {
    // Re-insert so this key moves to the end: Map keeps insertion order, which
    // is what makes the first key the least recently used one.
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
    /*
     * Every connection runs in UTC.
     *
     * DATETIME columns carry no zone, so NOW() and every stored timestamp mean
     * whatever the server's clock happens to be — UTC on the production host,
     * IST on a developer's laptop. The API then hands those naive strings to a
     * browser that reads them as LOCAL time, so the same row rendered "6h ago"
     * in production and correctly in development. Pinning the session makes the
     * contract true everywhere: naive datetimes from this API are UTC, which is
     * what helpers.parseServerDate assumes.
     */
    timezone: 'Z',
    // Real prepared statements (mysql2 default for execute()) — the PDO
    // ATTR_EMULATE_PREPARES=false equivalent. Keeps parameter binding honest.
    multipleStatements: false,
    /*
     * Keepalive, and the idle timeout that was already here — now shared with
     * the master pool so the two cannot drift. See database/resilient.js for
     * what a connection the server closed behind our back actually looks like
     * from in here.
     */
    ...KEEPALIVE_OPTIONS,
  });

  /*
   * `timezone: 'Z'` above only tells mysql2 how to CONVERT Date objects, and
   * with dateStrings it converts nothing at all. What actually makes NOW() and
   * CURRENT_TIMESTAMP return UTC is the session variable, set on every new
   * connection the pool opens.
   *
   * Without it the pinning above is decorative: rows would still be stamped in
   * whatever zone the database host happens to run in.
   */
  raw.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'", (err) => {
      if (err) logger.warn(`db: could not pin session to UTC — ${err.message}`);
    });
  });

  /*
   * In tests, be as strict as production is.
   *
   * Development runs on XAMPP, whose MariaDB 10.4 is permissive: writing a
   * value a column cannot hold truncates it, warns, and carries on. Aiven runs
   * STRICT_ALL_TABLES, where the same write is error 1265 and the request dies.
   *
   * That gap hid a real fault for as long as it existed. processEmailQueue
   * wrote status='processing' into an ENUM that had no such value; locally it
   * silently became '' and the suite passed, and on production every drain
   * threw and not one notification was ever delivered. CI caught it only
   * because its MariaDB is strict — so the suite was already capable of finding
   * it, on somebody else's machine, a push too late.
   *
   * Applied only under NODE_ENV=test, deliberately. Turning it on for local
   * development would be a larger change than this is the moment for; the
   * suite is where the difference has to be closed, because the suite is what
   * decides whether a change is safe to ship.
   */
  if (config.env === 'test') {
    raw.on('connection', (conn) => {
      conn.query("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',STRICT_ALL_TABLES')",
        (err) => { if (err) logger.warn(`db: could not pin test session to strict mode — ${err.message}`); });
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

/** Close every cached pool — used for graceful shutdown. */
export async function closeAllPools() {
  const pools = [...poolCache.values()];
  poolCache.clear();
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
}

export default {
  resolveTenant, resolveTenantBySlug, getTenantPool, poolStats, fallbackTenant, sanitizeSlug,
  heldForNonPayment, closeAllPools,
};
