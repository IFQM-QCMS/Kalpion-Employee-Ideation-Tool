/**
 * Master (tenant-registry) database connection.
 *
 * Mirrors PHP `masterDb()` in api/config.php — a single shared connection to
 * `ifqm_master`, which holds the `tenants` registry and `platform_admins`.
 */
import mysql from 'mysql2/promise';
import config from '../config/index.js';
import logger from '../utils/logger.js';

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
  pool = mysql.createPool({
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
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'", (err) => {
      if (err) logger.warn(`db: could not pin session to UTC — ${err.message}`);
    });
  });
  return pool;
}

export default masterDb;
