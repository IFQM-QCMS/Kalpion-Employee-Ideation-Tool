/**
 * Registration controller.
 *
 * `submit` is the only unauthenticated write endpoint in the API. The platform
 * handlers below sit behind requirePlatformAuth via the router they mount on.
 */
import * as registrations from '../services/registrationService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const submit = asyncHandler(async (req, res) =>
  respond(res, await registrations.submitRegistration(req.body || {}, { ip: req.ip }))
);

/** Live check for the signup form, so a personal address is caught as it is typed. */
export const checkEmail = asyncHandler(async (req, res) => {
  const result = registrations.checkCorporateEmail(req.query.email || '');
  return respond(res, {
    success: true,
    acceptable: result.ok,
    reason: result.reason || null,
    domain: registrations.emailDomain(req.query.email || ''),
  });
});

export const list = asyncHandler(async (req, res) =>
  respond(res, await registrations.listRegistrations({ status: req.query.status || '' }))
);

export const approve = asyncHandler(async (req, res) =>
  respond(res, await registrations.approveRegistration(req.params.id, {
    // req.user.id for a platform admin is the string "pa_<n>" (see authService);
    // the registry column stores the numeric platform_admins.id.
    adminId: Number(String(req.user?.id || '').replace(/^pa_/, '')) || null,
    slug: req.body?.slug || '',
  }))
);

export const reject = asyncHandler(async (req, res) =>
  respond(res, await registrations.rejectRegistration(req.params.id, {
    adminId: Number(String(req.user?.id || '').replace(/^pa_/, '')) || null,
    note: req.body?.note || '',
  }))
);
