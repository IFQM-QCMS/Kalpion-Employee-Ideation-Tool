/**
 * Auth routes — /api/auth/*
 * Ported from PHP api/auth.php (action-based dispatch → REST sub-paths).
 */
import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/me', optionalAuth, auth.me);
// Public on purpose: the sign-in screen has to be able to say why nobody can
// sign in, and it asks this before anyone has a session. It exposes only
// whether the platform is on hold and the notice to show — nothing about any
// organisation, account or credential.
router.get('/maintenance', auth.maintenance);
router.post('/login', authLimiter, auth.login);
// §4.1 / §4.2 — sign in with a one-time code. Rate limited on the same footing
// as password login: both are unauthenticated ways to reach an account.
router.get('/otp/status', auth.otpStatus);
router.post('/otp/request', authLimiter, auth.otpRequest);
router.post('/otp/verify', authLimiter, auth.otpVerify);

router.post('/logout', auth.logout);
router.post('/forgot-password', authLimiter, auth.forgotPassword);
// Reset by code rather than by emailed link — for somebody who cannot reach the
// mailbox the link would land in. Ends at the same /reset-password below.
router.post('/password-reset/request-code', authLimiter, auth.requestResetCode);
router.post('/password-reset/verify-code', authLimiter, auth.verifyResetCode);
router.post('/reset-password', authLimiter, auth.resetPassword);
router.get('/check-reset-token', auth.checkResetToken);

// Signed-in change. Reachable even while must_change_password is set — it is on
// the allowlist in the auth middleware, and is the only way out of that state.
router.post('/change-password', requireAuth, auth.changePassword);

export default router;
