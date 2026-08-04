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

export default router;
