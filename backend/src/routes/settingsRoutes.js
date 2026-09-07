/** Settings routes - /api/settings/* Ported from PHP api/settings.php. */
import { Router } from 'express';
import * as settings from '../controllers/settingsController.js';
import * as billing from '../controllers/billingController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Where this organisation's own account stands: the plan, the dates and how long is left.
router.get('/subscription', requireAuth, billing.mySubscription);

// The organisation's own billing page: plan, dates, payment history, and - when IFQM has a
// gateway configured - the means to pay.
router.get('/billing', requireAuth, billing.myBilling);
router.post('/billing/pay', requireRole('admin', 'super_admin'), billing.payStart);
router.post('/billing/verify', requireRole('admin', 'super_admin'), billing.payVerify);

router.get('/', requireAuth, settings.get);                                   // action=get
router.post('/', requireRole('admin', 'super_admin'), settings.update);       // action=update
router.get('/test-email', requireRole('admin', 'super_admin'), settings.testEmail); // action=send_test_email

export default router;
