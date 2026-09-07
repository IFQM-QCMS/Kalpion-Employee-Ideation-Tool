/** Master (tenant-registry) database connection. */
import mysql from 'mysql2/promise';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { resilientPool, KEEPALIVE_OPTIONS } from './resilient.js';

let pool = null;

/** Lazily-created singleton pool to the master DB. */
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
    // Every connection runs in UTC.
    timezone: 'Z',
    // Keepalive, and an idle timeout under the server's.
    ...KEEPALIVE_OPTIONS,
    maxIdle: Math.min(4, config.dbPoolSize),
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

  pool = resilientPool(raw, 'master');
  return pool;
}

export default masterDb;
