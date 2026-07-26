/**
 * Rate limiters.
 *
 * The PHP app protected the login action with a per-identifier brute-force
 * lock (5 failed attempts → 15-min lockout) — that exact rule is reproduced in
 * authService (see loginAttempts). These IP-based limiters are an additional
 * coarse safety net ("maintain or improve security") applied globally and to
 * the auth routes, and do not change the per-account lockout behaviour.
 */
import rateLimit from 'express-rate-limit';

// Per-IP global cap. Tunable via GLOBAL_RATE_LIMIT so a large deployment (many
// users behind one office NAT) can raise it without a code change, and load
// tests can run a dedicated instance uncapped. Default stays 300/min.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' },
});

/**
 * Login / forgot-password / reset.
 *
 * The per-account lockout (5 strikes → 15 min, in authService) stops someone
 * grinding ONE account. It does nothing against password spraying — one guess
 * each against a thousand accounts never trips it. This IP limit is what caps
 * that, so it has to be far lower than the old 100-per-15-min.
 *
 * A whole office can share one NAT'd IP, so this is per-IP-per-15-min and sized
 * to be generous for humans (a real person mistyping a password a few times, or
 * a dozen colleagues signing in after a reboot) while still cutting a spray
 * attempt down to a trickle. Tune with AUTH_RATE_LIMIT if a customer's egress
 * IP is busier than expected.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failures count against the budget
  message: { success: false, error: 'Too many authentication attempts. Please try again later.' },
});

/** Expensive endpoints (AI rescoring, exports) — cheap to ask for, costly to serve. */
export const heavyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'This operation is rate limited. Please try again later.' },
});

export default { globalLimiter, authLimiter, heavyLimiter };
