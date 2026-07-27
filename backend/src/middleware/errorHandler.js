/**
 * Central error handler + 404 handler.
 *
 * Converts thrown `ApiError`s (and unexpected errors) into the same
 * `{ success:false, error }` JSON shape the PHP `respond([...], code)` emitted.
 */
import { ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: 'Unknown action' });
}

// MySQL/driver error codes that indicate the DB is unreachable or misconfigured
// at the connection level — PHP surfaced these as "Database connection failed."
const DB_CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
]);

function dbConnectionCode(err) {
  if (err?.code && DB_CONNECTION_CODES.has(err.code)) return err.code;
  // mysql2 pool errors may be wrapped in an AggregateError of per-host attempts.
  if (Array.isArray(err?.errors)) {
    for (const e of err.errors) if (e?.code && DB_CONNECTION_CODES.has(e.code)) return e.code;
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      error: err.message,
      ...err.extra,
    });
  }

  const dbCode = dbConnectionCode(err);
  if (dbCode) {
    logger.error(`DB connection failed on ${req.method} ${req.originalUrl} [${dbCode}]`);
    return res.status(500).json({ success: false, error: 'Database connection failed.' });
  }

  // Body-parser rejects a request before it ever reaches a handler when the body
  // is too large or malformed. Those are the CLIENT's fault and carry their own
  // 4xx status (413 entity.too.large, 400 entity.parse.failed) — surfacing them
  // as 500s wrongly implicates the server and hides the real cause from callers.
  const clientStatus = err.status || err.statusCode;
  if (err.type && typeof clientStatus === 'number' && clientStatus >= 400 && clientStatus < 500) {
    const msg = err.type === 'entity.too.large'
      ? 'Request body is too large.'
      : 'Malformed request body.';
    return res.status(clientStatus).json({ success: false, error: msg });
  }

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
}

export default { notFoundHandler, errorHandler };
