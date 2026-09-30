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

/*
 * Account-identify (the sign-in screen's "does this exist, and does it have a password"
 * check). Every attempt counts against the budget, successful or not - unlike authLimiter,
 * a lookup that resolves to a real account is not a "failure" to skip, and this endpoint's
 * whole job is answering a question that is otherwise deliberately never answered elsewhere
 * in this app.
 */
export const identifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.IDENTIFY_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});

/** Expensive endpoints (AI rescoring, exports) - cheap to ask for, costly to serve. */
export const heavyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'This operation is rate limited. Please try again later.' },
});

export default { globalLimiter, authLimiter, identifyLimiter, heavyLimiter };
