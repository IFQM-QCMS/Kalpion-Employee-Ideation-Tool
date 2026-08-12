/**
 * Platform routes — /api/platform/*  (IFQM vendor console)
 * Ported from PHP api/platform.php. Every route requires platform-admin auth.
 */
import { Router } from 'express';
import * as platform from '../controllers/platformController.js';
import * as support from '../controllers/supportController.js';
import * as registrations from '../controllers/registrationController.js';
import * as billing from '../controllers/billingController.js';
import * as messaging from '../controllers/messagingController.js';
import { requirePlatformAuth } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(requirePlatformAuth);

/*
 * Billing. The plan catalogue is what IFQM sells; the per-tenant routes are what
 * a particular organisation is on. Both are staff-only — this whole router sits
 * behind requirePlatformAuth above.
 *
 * '/plans' is declared before '/tenants/:id' for the usual reason: a literal
 * path that could be read as a parameter has to be registered first.
 */
router.get('/plans', billing.listPlans);
router.post('/plans', billing.createPlan);
router.get('/plans/:id', billing.getPlan);
router.patch('/plans/:id', billing.updatePlan);
router.delete('/plans/:id', billing.retirePlan);      // retires, never deletes

router.get('/tenants/:id/subscription', billing.subscription);
router.post('/tenants/:id/plan', billing.assignPlan);
router.post('/tenants/:id/trial', billing.setTrial);
router.post('/tenants/:id/mark-paid', billing.markPaid);
// Every organisation's billing state on one screen — the payments dashboard.
router.get('/billing/overview', billing.overview);
// The Razorpay merchant account. Platform-wide: IFQM holds one, every
// organisation pays into it, and the key secret never leaves this server.
router.get('/billing/gateway', billing.gatewayGet);
router.put('/billing/gateway', billing.gatewayUpdate);
router.post('/billing/gateway/test', heavyLimiter, billing.gatewayTest);
// Sweep everyone whose period has ended. ?dry_run=1 reports without changing.
router.post('/billing/sweep', billing.sweep);
router.post('/billing/send-invoices', billing.sendMonthlyInvoices);

router.get('/tenants', platform.tenants);                       // action=tenants
router.get('/tenants/:id', platform.tenantDetail);              // action=tenant_detail
router.post('/tenants', platform.createTenant);                 // action=create_tenant

// Tenant management. GET /tenants/:id/hierarchy was removed rather than guarded:
// it existed only to serve the customer's org chart to the vendor.
router.patch('/tenants/:id', platform.updateTenant);                              // rename / re-slug / suspend
router.post('/tenants/:id/reset-admin-password', platform.resetTenantAdminPassword);
router.delete('/tenants/:id', platform.deleteTenant);                            // gated on confirm_slug

// Settings — new-tenant defaults, per-tenant overrides, admin accounts, health.
// /settings/* is declared before /tenants/:id/settings only for readability;
// Express matches on the literal prefix, so there is no ambiguity between them.
router.get('/settings/defaults', platform.getDefaults);
router.put('/settings/defaults', platform.updateDefaults);
router.get('/tenants/:id/settings', platform.getTenantSettings);
router.put('/tenants/:id/settings', platform.updateTenantSettings);

/*
 * Messaging — the SMS/DLT connector, one-time-code policy, and email health.
 *
 * Held apart from /settings/defaults deliberately. That endpoint edits the
 * settings a NEW ORGANISATION is seeded with; these are platform-wide delivery
 * credentials that belong to IFQM and are copied to nobody.
 *
 * The test send is rate limited because it reaches a gateway that bills per
 * message. Everything else here is a database write.
 */
router.get('/messaging', messaging.get);
router.put('/messaging', messaging.update);
router.post('/messaging/test', heavyLimiter, messaging.test);
router.post('/messaging/test-mail', heavyLimiter, messaging.testMail);

router.get('/admins', platform.listAdmins);
router.post('/admins', platform.createAdmin);
router.delete('/admins/:id', platform.deleteAdmin);
router.post('/admins/change-password', platform.changeOwnPassword);

// MSME self-registration queue. Approving one provisions a tenant, so these sit
// behind the same platform-admin guard as create_tenant.
router.get('/registrations', registrations.list);
router.post('/registrations/:id/approve', registrations.approve);
router.post('/registrations/:id/reject', registrations.reject);

router.get('/activity', platform.loginActivity);   // §12.12 sign-in feed

router.get('/health', platform.health);

// Support queue — every tenant's tickets, plus IFQM-only internal notes.
router.get('/tickets', support.platformList);
router.post('/tickets', support.platformCreate);          // IFQM raises against a tenant
// Registered before '/tickets/:id' so that "bulk-archive" is not read as an id.
router.post('/tickets/bulk-archive', support.platformBulkArchive);
router.get('/tickets/:id', support.platformGet);
router.post('/tickets/:id/messages', support.platformReply);
router.patch('/tickets/:id', support.platformUpdate);     // status / priority / assignee

export default router;
