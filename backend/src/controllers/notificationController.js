/** Notification controller - HTTP layer over notificationService. */
import * as notificationService from '../services/notificationService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

// Platform admins have no tenant database (req.db is only attached for tenant tokens), and
// notifications are a tenant-DB feature.
export const list = asyncHandler(async (req, res) => {
  if (!req.db) return respond(res, { success: true, notifications: [], unread_count: 0, total: 0 });
  return respond(res, await notificationService.list(req.db, req.user, { limit: req.query.limit }));
});

/*
 * The `ids` in the body used to be read by nobody: this handler called the service with
 * two arguments and the service marked every notification the user had.
 */
export const markRead = asyncHandler(async (req, res) => {
  if (!req.db) return respond(res, { success: true, updated: 0 });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  return respond(res, await notificationService.markRead(req.db, req.user, ids));
});

export default { list, markRead };
