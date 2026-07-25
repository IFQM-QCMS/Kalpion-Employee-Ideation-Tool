/**
 * Integration controller — org-admin "Approved Ideas" + "API & Integration".
 * All routes are org-admin guarded (see integrationRoutes).
 */
import * as integration from '../services/integrationService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const getConfig = asyncHandler(async (req, res) =>
  respond(res, await integration.getQcmsConfig(req.db))
);

export const saveConfig = asyncHandler(async (req, res) =>
  respond(res, await integration.saveQcmsConfig(req.db, req.body || {}))
);

export const approvedIdeas = asyncHandler(async (req, res) =>
  respond(res, await integration.listApprovedIdeas(req.db))
);

export const push = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const ideaIds = Array.isArray(body.idea_ids) ? body.idea_ids : null;
  respond(res, await integration.pushApprovedIdeas(req.db, ideaIds, { onlyPending: !!body.only_pending }));
});

export default { getConfig, saveConfig, approvedIdeas, push };
