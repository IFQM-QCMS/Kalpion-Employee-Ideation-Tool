/** Surviving a connection the database has already closed. */
import logger from '../utils/logger.js';

/** Pool options that keep a connection alive, or retire it before the server does. */
export const KEEPALIVE_OPTIONS = {
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  // Retire our own idle connections long before MySQL's wait_timeout (as low as 600s on some managed services) can
  // close them behind our back.
  idleTimeout: 60000,
};

/** Errors that mean "the connection died", as distinct from "the query was wrong". */
const RETRYABLE = new Set([
  'PROTOCOL_CONNECTION_LOST',      // server closed it while we held it
  'ECONNRESET',                    // ...abruptly
  'EPIPE',                         // wrote into a socket that was already gone
  'ETIMEDOUT',                     // stale socket, no response
  'ER_CLIENT_INTERACTION_TIMEOUT', // mysql2's own idle read timeout
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ECONNREFUSED',                  // brief window during a database restart
]);

function isRetryable(err) {
  if (!err) return false;
  if (RETRYABLE.has(err.code)) return true;
  // mysql2 reports a multi-host attempt as an AggregateError of the individual failures; one
  // dead route among them is still a dead connection.
  if (Array.isArray(err.errors)) return err.errors.some((e) => RETRYABLE.has(e?.code));
  return false;
}

/*
 * Wrap a mysql2 promise pool so a dead pooled connection costs one retry instead of one
 * error page.
 */
export function resilientPool(pool, label) {
  // Without this listener, an idle connection dying is an unhandled 'error' event, which
  // Node throws, which reaches uncaughtException, which exits the process.
  pool.on('error', (err) => {
    logger.warn(`db(${label}): pool reported ${err?.code || err?.message || 'an error'} `
      + '- the connection was discarded, no request was affected');
  });

  const run = async (method, sql, params) => {
    try {
      return params === undefined ? await pool[method](sql) : await pool[method](sql, params);
    } catch (err) {
      if (!isRetryable(err)) throw err;

      // One retry, immediately. The pool has already thrown the broken connection away, so this
      // call opens or borrows a different one.
      logger.warn(`db(${label}): ${err.code} on a pooled connection - retrying once on a fresh one`);
      try {
        return params === undefined ? await pool[method](sql) : await pool[method](sql, params);
      } catch (again) {
        logger.error(`db(${label}): retry also failed [${again.code || again.message}]`);
        throw again;
      }
    }
  };

  return {
    execute: (sql, params) => run('execute', sql, params),
    query: (sql, params) => run('query', sql, params),
    // Handed over as-is. The caller owns this connection and usually opens a transaction on
    // it; a retry underneath them would be silent corruption.
    getConnection: () => pool.getConnection(),
    end: () => pool.end(),
    // The raw pool, for the health endpoint and for shutdown.
    _pool: pool,
  };
}

export default { resilientPool, KEEPALIVE_OPTIONS };
