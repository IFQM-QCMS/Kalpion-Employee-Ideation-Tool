/** Rate limiters. */
import rateLimit from 'express-rate-limit';

// Per-IP global cap. Tunable via GLOBAL_RATE_LIMIT so a large deployment (many users
// behind one office NAT) can raise it without a code change, and load tests can run a
// dedicated instance uncapped.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' },
});

/** Login / forgot-password / reset. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failures count against the budget
  message: { success: false, error: 'Too many authentication attempts. Please try again later.' },
});

/** Expensive endpoints (AI rescoring, exports) - cheap to ask for, costly to serve. */
export const heavyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'This operation is rate limited. Please try again later.' },
});

export default { globalLimiter, authLimiter, heavyLimiter };
