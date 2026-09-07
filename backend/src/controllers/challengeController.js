/** Challenge controller - HTTP layer over challengeService. */
import * as challengeService from '../services/challengeService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) =>
  respond(res, await challengeService.list(req.db))
);

export const get = asyncHandler(async (req, res) =>
  respond(res, await challengeService.get(req.db, req.params.id ?? req.query.id))
);

export const create = asyncHandler(async (req, res) =>
  respond(res, await challengeService.create(req.db, req.user, req.body || {}))
);

export const update = asyncHandler(async (req, res) =>
  respond(res, await challengeService.update(req.db, req.user, req.params.id ?? req.body?.id, req.body || {}))
);

export const remove = asyncHandler(async (req, res) =>
  respond(res, await challengeService.remove(req.db, req.params.id ?? req.body?.id))
);

export default { list, get, create, update, remove };
