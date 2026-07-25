/**
 * User controller — HTTP layer over userService. Maps to the user-management
 * actions of PHP api/users.php.
 */
import * as userService from '../services/userService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const list = asyncHandler(async (req, res) =>
  respond(res, await userService.list(req.db, req.user, req.query.q))
);

export const adminUsers = asyncHandler(async (req, res) =>
  respond(res, await userService.adminUsers(req.db, {
    q: req.query.q,
    page: req.query.page,
    limit: req.query.limit,
  }))
);

export const createUser = asyncHandler(async (req, res) =>
  respond(res, await userService.createUser(req.db, req.user, req.body || {}, req.tenant))
);

export const updateUser = asyncHandler(async (req, res) =>
  respond(res, await userService.updateUser(req.db, req.user, req.params.id ?? req.body?.id, req.body || {}, req.tenant))
);

export const updateManager = asyncHandler(async (req, res) =>
  respond(res, await userService.updateManager(req.db, req.user, req.params.id, req.body || {}))
);

export const deleteUser = asyncHandler(async (req, res) =>
  respond(res, await userService.deleteUser(req.db, req.user, req.params.id ?? req.body?.id, req.tenant))
);

export const managers = asyncHandler(async (req, res) =>
  respond(res, await userService.managers(req.db))
);

export const hierarchy = asyncHandler(async (req, res) =>
  respond(res, await userService.hierarchy(req.db))
);

export const updateProfile = asyncHandler(async (req, res) =>
  respond(res, await userService.updateProfile(req.db, req.user, req.body || {}))
);

export default { list, adminUsers, createUser, updateUser, updateManager, deleteUser, managers, hierarchy, updateProfile };
