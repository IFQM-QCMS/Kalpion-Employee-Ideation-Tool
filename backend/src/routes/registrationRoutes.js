/**
 * Public MSME registration — /api/registrations/*
 *
 * The only unauthenticated write path in the API, so it is rate limited on the
 * same footing as login: an anonymous caller can queue applications for a human
 * to read, and nothing else.
 */
import { Router } from 'express';
import * as registrations from '../controllers/registrationController.js';
import { authLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/', authLimiter, registrations.submit);
router.get('/check-email', authLimiter, registrations.checkEmail);
router.get('/channels', registrations.channels);
router.post('/send-otp', authLimiter, registrations.sendOtp);
router.post('/verify-otp', authLimiter, registrations.verifyOtp);
// The mobile leg. Rate limited on the same footing as the email one — each
// request costs a real message from a gateway that bills per send.
router.post('/send-phone-otp', authLimiter, registrations.sendPhoneOtp);
router.post('/verify-phone-otp', authLimiter, registrations.verifyPhoneOtp);

export default router;
