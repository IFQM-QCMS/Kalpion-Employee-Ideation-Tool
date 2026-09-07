/** Idea-category controller - HTTP layer over categoryService. */
import * as categoryService from '../services/categoryService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) =>
  respond(res, await categoryService.list(req.db))
);

export const create = asyncHandler(async (req, res) =>
  respond(res, await categoryService.create(req.db, req.body || {}))
);

export const remove = asyncHandler(async (req, res) =>
  respond(res, await categoryService.remove(req.db, req.params.id ?? req.body?.id))
);

export default { list, create, remove };
