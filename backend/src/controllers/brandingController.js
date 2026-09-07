/** Branding controller - thin HTTP layer over brandingService. */
import * as brandingService from '../services/brandingService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

/** GET /api/branding - any authenticated user; this is what their sidebar renders. */
export const get = asyncHandler(async (req, res) => {
  return respond(res, await brandingService.getBranding(req.tenant));
});

/** PUT /api/branding - admin only. */
export const updateName = asyncHandler(async (req, res) => {
  return respond(res, await brandingService.updateName(req.tenant, req.body?.org_name));
});

/** POST /api/branding/logo - admin only. Multipart field name "logo". */
export const updateLogo = asyncHandler(async (req, res) => {
  return respond(res, await brandingService.updateLogo(req.tenant, req.file));
});

/** DELETE /api/branding/logo - admin only. */
export const removeLogo = asyncHandler(async (req, res) => {
  return respond(res, await brandingService.removeLogo(req.tenant));
});

export default { get, updateName, updateLogo, removeLogo };
