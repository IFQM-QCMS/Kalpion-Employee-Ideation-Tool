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
 * check). Every attempt counts against the budget, successful or not - this endpoint answers
 * 200 for all three outcomes (see authService.identifyAccount), so "skip successful requests"
 * (status < 400) would skip nearly everything and remove the budget entirely. That still has
 * to coexist with many real employees sharing one office/plant IP, so this is two budgets
 * rather than one flat per-IP cap:
 *
 *  - identifyPerIdentifierLimiter: per (IP, identifier) - catches a script hammering ONE
 *    identifier from one address. Low ceiling, because a real person never submits the same
 *    identifier 20+ times in 15 minutes.
 *  - identifyPerIpLimiter: per IP only, much higher ceiling - the backstop against sweeping
 *    many different identifiers from one address (enumeration), sized so a few hundred
 *    distinct employees behind one NAT in one window never trip it.
 *
 * Both run on every request; either one tripping is enough to reject it.
 */
const identifyPerIdentifierLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.IDENTIFY_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.identifier || '').trim().toLowerCase()}`,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});

const identifyPerIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.IDENTIFY_RATE_LIMIT_PER_IP) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts. Please try again later.' },
});

export const identifyLimiter = [identifyPerIpLimiter, identifyPerIdentifierLimiter];

/** Expensive endpoints (AI rescoring, exports) - cheap to ask for, costly to serve. */
export const heavyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'This operation is rate limited. Please try again later.' },
});

export default { globalLimiter, authLimiter, identifyLimiter, heavyLimiter };
