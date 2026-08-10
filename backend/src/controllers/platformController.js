/**
 * Platform controller — HTTP layer over platformService. Maps to api/platform.php.
 * All routes are guarded by requirePlatformAuth.
 */
import * as platformService from '../services/platformService.js';
import * as settings from '../services/platformSettingsService.js';
import * as activity from '../services/activityService.js';
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

export const changeOwnPassword = asyncHandler(async (req, res) =>
  respond(res, await settings.changeOwnPassword(req.user, req.body || {}))
);

// ── Health ──
export const health = asyncHandler(async (_req, res) =>
  respond(res, await settings.health())
);

export default {
  tenants, tenantDetail, createTenant, updateTenant, resetTenantAdminPassword, deleteTenant,
  getDefaults, updateDefaults, getTenantSettings, updateTenantSettings,
  listAdmins, createAdmin, deleteAdmin, changeOwnPassword, health,
};
