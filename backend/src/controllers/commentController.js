/**
 * Comment controller — HTTP layer over commentService. Maps to api/comments.php.
 */
import * as commentService from '../services/commentService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) =>
  respond(res, await commentService.list(req.db, req.query.idea_id, req.user))
);

export const add = asyncHandler(async (req, res) =>
  respond(res, await commentService.add(req.db, req.user, req.body || {}))
);

export const remove = asyncHandler(async (req, res) =>
  respond(res, await commentService.remove(req.db, req.user, req.params.id ?? req.body?.id))
);

export default { list, add, remove };
