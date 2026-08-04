/**
 * Platform routes — /api/platform/*  (IFQM vendor console)
 * Ported from PHP api/platform.php. Every route requires platform-admin auth.
 */
import { Router } from 'express';
import * as platform from '../controllers/platformController.js';
import * as support from '../controllers/supportController.js';
import * as registrations from '../controllers/registrationController.js';
import { requirePlatformAuth } from '../middleware/auth.js';

const router = Router();

router.use(requirePlatformAuth);

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

router.get('/admins', platform.listAdmins);
router.post('/admins', platform.createAdmin);
router.delete('/admins/:id', platform.deleteAdmin);
router.post('/admins/change-password', platform.changeOwnPassword);

// MSME self-registration queue. Approving one provisions a tenant, so these sit
// behind the same platform-admin guard as create_tenant.
router.get('/registrations', registrations.list);
router.post('/registrations/:id/approve', registrations.approve);
router.post('/registrations/:id/reject', registrations.reject);

router.get('/health', platform.health);

// Support queue — every tenant's tickets, plus IFQM-only internal notes.
router.get('/tickets', support.platformList);
router.post('/tickets', support.platformCreate);          // IFQM raises against a tenant
router.get('/tickets/:id', support.platformGet);
router.post('/tickets/:id/messages', support.platformReply);
router.patch('/tickets/:id', support.platformUpdate);     // status / priority / assignee

export default router;
