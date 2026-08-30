/**
 * Surviving a connection the database has already closed.
 *
 * ── The failure this exists to stop ────────────────────────────────────────
 *
 * "Sometimes it says server error, on any page." Intermittent, unreproducible,
 * spread across every endpoint, and always after the site had been sitting
 * quiet for a while. That shape is not an application bug — it is a pool
 * handing out a socket the server hung up on.
 *
 * Both ends have an idle timeout and they do not agree. MySQL closes a
 * connection after `wait_timeout` (Aiven ships 600s); the pool keeps holding
 * it, because nothing tells a client that its socket died. The next request
 * borrows that corpse, writes a query into it, and gets ECONNRESET or
 * PROTOCOL_CONNECTION_LOST. The error handler turns that into
 * "Database connection failed." and the user sees a server error on a platform
 * that is running perfectly.
 *
 * It looked random because it was: it happened to whoever made the first
 * request after a lull, on whichever pooled connection had gone stale, and the
 * retry they made by hand a second later got a fresh connection and worked.
 * That is also why it could never be reproduced on a busy system.
 *
 * ── Three separate fixes, because there are three separate holes ───────────
 *
 * 1. Do not let connections go stale. `enableKeepAlive` puts a TCP keepalive on
 *    the socket, and `idleTimeout` below the server's `wait_timeout` means WE
 *    close idle connections first — a connection we closed is one the pool
 *    knows about, and a connection the server closed is one it does not.
 *
 * 2. Retry once when it happens anyway. Keepalive does not survive a database
 *    restart, a failover, or a network blip, and Aiven's free tier does all
 *    three. See the note on `RETRYABLE` for why retrying is safe here.
 *
 * 3. Listen for 'error'. A pool that emits 'error' with no listener throws, and
 *    that throw is not inside any request — it lands on `uncaughtException`,
 *    which calls `process.exit(1)`. So one idle connection dying could take the
 *    whole server down and fail every request in flight, which is the same
 *    symptom with a much bigger blast radius. This is the one that made it look
 *    like "any part of the platform".
 */
import logger from '../utils/logger.js';

/**
 * Pool options that keep a connection alive, or retire it before the server
 * does. Spread into every createPool call so the two pools cannot drift.
 *
 * `idleTimeout` is deliberately well under the 600s MySQL default: the race is
 * only lost if the server reaps the connection first, so we want a wide margin,
 * and re-opening a connection is cheap next to serving an error page.
 */
export const KEEPALIVE_OPTIONS = {
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  // Retire our own idle connections long before MySQL's wait_timeout (600s on
  // Aiven) can close them behind our back.
  idleTimeout: 60000,
};

/**
 * Errors that mean "the connection died", as distinct from "the query was
 * wrong".
 *
 * ── Why retrying these is safe, and where the limit is ─────────────────────
 *
 * Every code here is a transport failure: the socket was already broken when
 * the driver tried to write the statement, so the server never saw it. That is
 * the whole point of the distinction — a duplicate-key error or a syntax error
 * comes back THROUGH a working connection and is never retried, because the
 * server did receive those and the answer would not change.
 *
 * The honest caveat: a connection can also break after the server has run the
 * statement but before the result comes back, and no client can tell those two
 * apart. In that window a retried write could apply twice. It is accepted here
 * for three reasons — a socket the server closed while idle (overwhelmingly the
 * common case) fails on write, before execution; the writes where a duplicate
 * would actually hurt are already guarded (approvals hold a row lock and check
 * for a recent identical entry, idea codes retry on ER_DUP_ENTRY, notifications
 * are best-effort); and the alternative is what we have now, which is failing
 * the request every time.
 *
 * Transactions are NOT covered: those run on a connection the caller checked
 * out with getConnection(), which is passed through untouched. Retrying one
 * statement out of a transaction that has already rolled back would be worse
 * than the error.
 */
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
  // mysql2 reports a multi-host attempt as an AggregateError of the individual
  // failures; one dead route among them is still a dead connection.
  if (Array.isArray(err.errors)) return err.errors.some((e) => RETRYABLE.has(e?.code));
  return false;
}

/**
 * Wrap a mysql2 promise pool so a dead pooled connection costs one retry
 * instead of one error page.
 *
 * Returns an object rather than a Proxy: the surface a pool is actually used
 * through here is three methods, and naming them keeps it obvious what is and
 * is not covered. `getConnection` is passed straight through precisely because
 * it must not be — see the note on RETRYABLE.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} label  which pool, for the log line
 */
export function resilientPool(pool, label) {
  /*
   * Without this listener, an idle connection dying is an unhandled 'error'
   * event, which Node throws, which reaches uncaughtException, which exits the
   * process. The pool has already discarded the connection by the time we are
   * called; there is nothing to do but say so.
   */
  pool.on('error', (err) => {
    logger.warn(`db(${label}): pool reported ${err?.code || err?.message || 'an error'} `
      + '— the connection was discarded, no request was affected');
  });

  const run = async (method, sql, params) => {
    try {
      return params === undefined ? await pool[method](sql) : await pool[method](sql, params);
    } catch (err) {
      if (!isRetryable(err)) throw err;

      /*
       * One retry, immediately. The pool has already thrown the broken
       * connection away, so this call opens or borrows a different one. A
       * second failure is a real outage rather than a stale socket, and
       * retrying again would only delay telling the truth about it.
       */
      logger.warn(`db(${label}): ${err.code} on a pooled connection — retrying once on a fresh one`);
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
    // Handed over as-is. The caller owns this connection and usually opens a
    // transaction on it; a retry underneath them would be silent corruption.
    getConnection: () => pool.getConnection(),
    end: () => pool.end(),
    // The raw pool, for the health endpoint and for shutdown.
    _pool: pool,
  };
}

export default { resilientPool, KEEPALIVE_OPTIONS };
