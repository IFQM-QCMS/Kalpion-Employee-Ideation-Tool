/** Settings controller - HTTP layer over settingsService. */
import * as settingsService from '../services/settingsService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const get = asyncHandler(async (req, res) =>
  respond(res, await settingsService.getSettings(req.db, req.user))
);

export const update = asyncHandler(async (req, res) =>
  respond(res, await settingsService.updateSettings(req.db, req.body || {}))
);

export const testEmail = asyncHandler(async (req, res) =>
  respond(res, await settingsService.sendTestEmail(req.db, req.user))
);

export default { get, update, testEmail };
