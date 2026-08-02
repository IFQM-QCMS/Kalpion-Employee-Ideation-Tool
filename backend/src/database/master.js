/**
 * Master (tenant-registry) database connection.
 *
 * Mirrors PHP `masterDb()` in api/config.php — a single shared connection to
 * `ifqm_master`, which holds the `tenants` registry and `platform_admins`.
 */
import mysql from 'mysql2/promise';
import config from '../config/index.js';

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
  });
  return pool;
}

export default masterDb;
