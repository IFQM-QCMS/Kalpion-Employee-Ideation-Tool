/**
 * Master (tenant-registry) database connection.
 *
 * Mirrors PHP `masterDb()` in api/config.php — a single shared connection to
 * `ifqm_master`, which holds the `tenants` registry and `platform_admins`.
 */
import mysql from 'mysql2/promise';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { resilientPool, KEEPALIVE_OPTIONS } from './resilient.js';

let pool = null;

/**
 * Lazily-created singleton pool to the master DB. Returns null-safe pool;
 * callers that must tolerate a missing master DB should wrap queries in
 * try/catch (as the PHP code did with its fallback tenant).
 */
/** Close the singleton pool (graceful shutdown, test teardown). */
export async function closeMasterPool() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end().catch(() => {});
}

export function masterDb() {
  if (pool) return pool;
  const raw = mysql.createPool({
    host: config.masterDb.host,
    port: config.db.port,
    ssl: config.db.ssl,
    user: config.masterDb.user,
    password: config.masterDb.password,
    database: config.masterDb.database,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: config.dbPoolSize,
    namedPlaceholders: false,
    dateStrings: true, // keep DATE/DATETIME as strings, matching PDO defaults
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
    /*
     * Keepalive, and an idle timeout under the server's.
     *
     * The master pool had neither, which is why the intermittent server errors
     * hit EVERY endpoint rather than a few: every request resolves its tenant
     * through this pool first, so one stale master connection failed whatever
     * the user happened to be doing. See database/resilient.js.
     */
    ...KEEPALIVE_OPTIONS,
    maxIdle: Math.min(4, config.dbPoolSize),
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

  pool = resilientPool(raw, 'master');
  return pool;
}

export default masterDb;
