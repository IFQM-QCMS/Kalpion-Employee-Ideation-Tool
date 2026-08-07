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
    // MOM §13.9 — filtering happens in SQL, so the console never has to pull
    // the whole user table to narrow it.
    role: req.query.role,
    department: req.query.department,
    status: req.query.status,
    manager_id: req.query.manager_id,
  }))
);

/** GET /api/users/:id/chain — MOM §13.8, one person's full reporting line. */
export const reportingChain = asyncHandler(async (req, res) =>
  respond(res, await userService.reportingChain(req.db, req.params.id))
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

export default { list, adminUsers, reportingChain, createUser, updateUser, updateManager, deleteUser, managers, hierarchy, updateProfile };
