/**
 * Support controller — thin HTTP layer over supportService.
 *
 * The tenant handlers take req.tenant / req.user from the caller's own token, so
 * the org a ticket is read or written against is never a client-supplied value.
 */
import * as support from '../services/supportService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

// ── Tenant side (requireAuth) ──────────────────────────────────────
export const listMine = asyncHandler(async (req, res) =>
  respond(res, await support.listTenantTickets(req.tenant, req.user, req.query))
);

export const create = asyncHandler(async (req, res) =>
  respond(res, await support.createTicket(req.tenant, req.user, req.body || {}))
);

export const getOne = asyncHandler(async (req, res) =>
  respond(res, await support.getTenantTicket(req.tenant, req.user, req.params.id))
);

export const reply = asyncHandler(async (req, res) =>
  respond(res, await support.replyAsTenant(req.tenant, req.user, req.params.id, req.body || {}))
);

export const update = asyncHandler(async (req, res) =>
  respond(res, await support.updateTenantTicket(req.tenant, req.user, req.params.id, req.body || {}))
);

// ── Platform side (requirePlatformAuth) ────────────────────────────
export const platformList = asyncHandler(async (req, res) =>
  respond(res, await support.listPlatformTickets(req.query))
);

export const platformGet = asyncHandler(async (req, res) =>
  respond(res, await support.getPlatformTicket(req.params.id))
);

export const platformReply = asyncHandler(async (req, res) =>
  respond(res, await support.replyAsPlatform(req.user, req.params.id, req.body || {}))
);

export const platformUpdate = asyncHandler(async (req, res) =>
  respond(res, await support.updatePlatformTicket(req.params.id, req.body || {}))
);

export const platformBulkArchive = asyncHandler(async (req, res) =>
  respond(res, await support.bulkArchiveTickets(req.body || {}))
);

export const platformCreate = asyncHandler(async (req, res) =>
  respond(res, await support.createPlatformTicket(req.user, req.body || {}))
);

export default {
  listMine, create, getOne, reply, update,
  platformList, platformGet, platformReply, platformUpdate, platformCreate,
  platformBulkArchive,
};
