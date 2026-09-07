/** Report controller - HTTP layer over reportService. */
import * as reportService from '../services/reportService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const analytics = asyncHandler(async (req, res) =>
  respond(res, await reportService.analytics(req.db))
);

export const audit = asyncHandler(async (req, res) =>
  respond(res, await reportService.audit(req.db))
);

export default { analytics, audit };
