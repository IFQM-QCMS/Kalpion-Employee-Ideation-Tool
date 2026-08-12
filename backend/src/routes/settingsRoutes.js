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

/*
 * The organisation's own billing page: plan, dates, payment history, and — when
 * IFQM has a gateway configured — the means to pay.
 *
 * Reading is open to anybody signed in, because "this company is two days from
 * being cut off" is something staff should be able to see. Paying is admin
 * only: an employee should not be able to spend the company's money.
 */
router.get('/billing', requireAuth, billing.myBilling);
router.post('/billing/pay', requireRole('admin', 'super_admin'), billing.payStart);
router.post('/billing/verify', requireRole('admin', 'super_admin'), billing.payVerify);

router.get('/', requireAuth, settings.get);                                   // action=get
router.post('/', requireRole('admin', 'super_admin'), settings.update);       // action=update
router.get('/test-email', requireRole('admin', 'super_admin'), settings.testEmail); // action=send_test_email

export default router;
