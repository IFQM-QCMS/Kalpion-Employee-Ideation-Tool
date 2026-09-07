/** Response helpers that mirror the PHP `respond()` shape exactly. */
export function respond(res, data, code = 200) {
  return res.status(code).json(data);
}

/*
 * Typed application error. Thrown from services/controllers and converted to the `{
 * success:false, error }` shape by the central error handler, matching how PHP
 * `respond([...], code)` short-circuits a request.
 */
export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (msg, extra) => new ApiError(400, msg, extra);
export const unauthorized = (msg = 'Not authenticated', extra) => new ApiError(401, msg, extra);
export const forbidden = (msg = 'Insufficient permissions', extra) => new ApiError(403, msg, extra);
export const notFound = (msg = 'Not found', extra) => new ApiError(404, msg, extra);
export const tooMany = (msg, extra) => new ApiError(429, msg, extra);
