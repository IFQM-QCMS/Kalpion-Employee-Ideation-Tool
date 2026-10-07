/*
 * Auth routes - /api/auth/* Ported from PHP api/auth.php (action-based dispatch REST
 * sub-paths).
 */
import { Router } from 'express';
import * as auth from '../controllers/authController.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { authLimiter, identifyLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/me', optionalAuth, auth.me);
// Public on purpose: the sign-in screen has to be able to say why nobody can sign in, and
// it asks this before anyone has a session.
router.get('/maintenance', auth.maintenance);
// The sign-in screen's first step: given an identifier, where should this person go next.
// identifyLimiter, not authLimiter - see its own comment for why. It is an array of two
// limiters (per-identifier and per-IP), spread as separate middleware.
router.post('/identify', ...identifyLimiter, auth.identify);
// The real password rule this deployment enforces, so the sign-in/activation screens can
// show it rather than guess. No account-specific data in it, so the global limiter is enough.
router.get('/password-policy', auth.passwordPolicy);
router.post('/login', authLimiter, auth.login);
// §4.1 / §4.2 - sign in with a one-time code. Rate limited on the same footing as password
// login: both are unauthenticated ways to reach an account.
router.get('/otp/status', auth.otpStatus);
router.post('/otp/request', authLimiter, auth.otpRequest);
router.post('/otp/verify', authLimiter, auth.otpVerify);

router.post('/logout', auth.logout);
router.post('/forgot-password', authLimiter, auth.forgotPassword);
// Reset by code rather than by emailed link - for somebody who cannot reach the mailbox
// the link would land in. Ends at the same /reset-password below.
router.post('/password-reset/request-code', authLimiter, auth.requestResetCode);
router.post('/password-reset/verify-code', authLimiter, auth.verifyResetCode);
router.post('/reset-password', authLimiter, auth.resetPassword);
router.get('/check-reset-token', auth.checkResetToken);

// Signed-in change. Reachable even while must_change_password is set - it is on the
// allowlist in the auth middleware, and is the only way out of that state.
router.post('/change-password', requireAuth, auth.changePassword);
// The self-service alternative: any signed-in organisation user may change their own
// password by proving they hold their own registered phone (SMS OTP) instead of already
// knowing their current one. Also reachable while must_change_password is set - the
// allowlist matches on the '/change-password' prefix, which covers these sub-paths too.
router.post('/change-password/otp/request', requireAuth, authLimiter, auth.requestChangePasswordOtp);
router.post('/change-password/otp/confirm', requireAuth, authLimiter, auth.confirmChangePasswordOtp);

// requireAuth, so the password has already been proved - without it these would send a
// code to any address somebody cared to name, and would answer whether an account exists.
router.get('/platform/verify/status', requireAuth, auth.platformVerifyStatus);
router.post('/platform/verify/send', requireAuth, authLimiter, auth.platformVerifySend);
router.post('/platform/verify/confirm', requireAuth, authLimiter, auth.platformVerifyConfirm);

export default router;
