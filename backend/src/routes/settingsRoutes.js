/**
 * Settings routes — /api/settings/*
 * Ported from PHP api/settings.php.
 */
import { Router } from 'express';
import * as settings from '../controllers/settingsController.js';
import * as billing from '../controllers/billingController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Where this organisation's own account stands: the plan, the dates and how
// long is left. Readable by anybody signed in, because the banner warning that
// the trial is ending has to be visible to the people who will chase it.
router.get('/subscription', requireAuth, billing.mySubscription);

router.get('/', requireAuth, settings.get);                                   // action=get
router.post('/', requireRole('admin', 'super_admin'), settings.update);       // action=update
router.get('/test-email', requireRole('admin', 'super_admin'), settings.testEmail); // action=send_test_email

export default router;
