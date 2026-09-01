/**
 * Platform controller — HTTP layer over platformService. Maps to api/platform.php.
 * All routes are guarded by requirePlatformAuth.
 */
import * as platformService from '../services/platformService.js';
import * as settings from '../services/platformSettingsService.js';
import * as activity from '../services/activityService.js';
import * as maintenance from '../services/maintenanceService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

// MOM §12.12 — recent sign-in activity for the console's notifications.
export const loginActivity = asyncHandler(async (req, res) =>
  respond(res, await activity.recentActivity({
    limit: req.query.limit,
    outcome: req.query.outcome || '',
    tenantId: req.query.tenant_id || null,
    // Defaults to IFQM staff. 'all' is what the notification feed asks for.
    actorType: req.query.actor_type || 'platform_admin',
  }))
);

export const tenants = asyncHandler(async (req, res) =>
  respond(res, await platformService.tenants())
);

/*
 * The /tenants/:id/hierarchy endpoint is gone on purpose — it served the
 * tenant's full org chart (names, managers, per-person idea counts) to the
 * vendor. tenantDetail now returns the aggregate shell instead, and that is the
 * only per-tenant view.
 */
export const tenantDetail = asyncHandler(async (req, res) =>
  respond(res, await platformService.tenantDetail(req.params.id ?? req.query.id))
);

export const createTenant = asyncHandler(async (req, res) =>
  respond(res, await platformService.createTenant(req.body || {}))
);

export const updateTenant = asyncHandler(async (req, res) =>
  respond(res, await platformService.updateTenant(req.params.id, req.body || {}))
);

export const resetTenantAdminPassword = asyncHandler(async (req, res) =>
  respond(res, await platformService.resetTenantAdminPassword(req.params.id, req.body || {}))
);

export const deleteTenant = asyncHandler(async (req, res) =>
  respond(res, await platformService.deleteTenant(req.params.id, req.body || {}))
);

// ── Settings: new-tenant defaults ──
export const getDefaults = asyncHandler(async (_req, res) =>
  respond(res, await settings.getDefaults())
);

export const updateDefaults = asyncHandler(async (req, res) =>
  respond(res, await settings.updateDefaults(req.body || {}))
);

// ── Settings: an existing tenant's own org_settings ──
export const getTenantSettings = asyncHandler(async (req, res) =>
  respond(res, await settings.getTenantSettings(req.params.id))
);

export const updateTenantSettings = asyncHandler(async (req, res) =>
  respond(res, await settings.updateTenantSettings(req.params.id, req.body || {}))
);

// ── Settings: platform admin accounts ──
export const listAdmins = asyncHandler(async (_req, res) =>
  respond(res, await settings.listAdmins())
);

export const createAdmin = asyncHandler(async (req, res) =>
  respond(res, await settings.createAdmin(req.body || {}))
);

export const deleteAdmin = asyncHandler(async (req, res) =>
  respond(res, await settings.deleteAdmin(req.user, req.params.id))
);

/*
 * ── Moving a platform admin's mobile number ────────────────────────────────
 *
 * The number is where a sign-in code and a password reset go, so it is a
 * credential in its own right — hence a code to the new handset before it is
 * written, and a notice to the old one afterwards.
 */
export const requestOwnPhoneChange = asyncHandler(async (req, res) =>
  respond(res, await settings.requestOwnPhoneChange(req.user, req.body || {}))
);

export const confirmOwnPhoneChange = asyncHandler(async (req, res) =>
  respond(res, await settings.confirmOwnPhoneChange(req.user, req.body || {}))
);

/*
 * Correcting somebody else's, for the account whose number was typed wrongly
 * when it was created and which therefore cannot verify itself out of the hole.
 */
export const updateAdminPhone = asyncHandler(async (req, res) =>
  respond(res, await settings.updateAdminPhone(req.user, req.params.id, req.body || {}))
);

export const changeOwnPassword = asyncHandler(async (req, res) =>
  respond(res, await settings.changeOwnPassword(req.user, req.body || {}))
);

// ── Maintenance mode ──
export const getMaintenance = asyncHandler(async (_req, res) =>
  respond(res, await maintenance.getMaintenance())
);

export const updateMaintenance = asyncHandler(async (req, res) =>
  respond(res, await maintenance.setMaintenance({
    enabled: req.body?.enabled,
    message: req.body?.message,
    actor: req.user,
  }))
);

// ── Health ──
export const health = asyncHandler(async (_req, res) =>
  respond(res, await settings.health())
);

export default {
  tenants, tenantDetail, createTenant, updateTenant, resetTenantAdminPassword, deleteTenant,
  getDefaults, updateDefaults, getTenantSettings, updateTenantSettings,
  listAdmins, createAdmin, deleteAdmin, changeOwnPassword, health,
  requestOwnPhoneChange, confirmOwnPhoneChange, updateAdminPhone,
  getMaintenance, updateMaintenance,
};
