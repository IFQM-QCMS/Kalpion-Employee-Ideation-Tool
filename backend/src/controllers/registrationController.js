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
  const result = await registrations.checkCorporateEmail(req.query.email || '');
  return respond(res, {
    success: true,
    acceptable: result.ok,
    reason: result.reason || null,
    // The form uses this to soften its wording: a personal address is a "we can
    // enable this for you" case, not the same kind of no as a malformed one.
    free_provider: !!result.free_provider,
    allowed_by_exception: !!result.allowed_by_exception,
    domain: registrations.emailDomain(req.query.email || ''),
  });
});

export const sendOtp = asyncHandler(async (req, res) =>
  respond(res, await registrations.sendRegistrationEmailOtp(req.body?.email, { ip: req.ip }))
);

export const verifyOtp = asyncHandler(async (req, res) =>
  respond(res, await registrations.verifyRegistrationEmailOtp(req.body?.email, req.body?.code))
);

// The mobile leg of the same exercise. Both must be proved before an
// application is accepted — see submitRegistration.
export const sendPhoneOtp = asyncHandler(async (req, res) =>
  respond(res, await registrations.sendRegistrationPhoneOtp(req.body?.phone, { ip: req.ip }))
);

export const verifyPhoneOtp = asyncHandler(async (req, res) =>
  respond(res, await registrations.verifyRegistrationPhoneOtp(req.body?.phone, req.body?.code))
);

/**
 * Which channels can actually carry a code right now.
 *
 * The sign-up form asks before it draws itself: a "verify by SMS" button that
 * cannot send is worse than no button, because the applicant cannot finish and
 * has no way to find out why.
 */
export const channels = asyncHandler(async (_req, res) => {
  const { channelsAvailable } = await import('../services/verificationService.js');
  return respond(res, { success: true, ...channelsAvailable() });
});

export const list = asyncHandler(async (req, res) =>
  respond(res, await registrations.listRegistrations({ status: req.query.status || '' }))
);

export const approve = asyncHandler(async (req, res) =>
  respond(res, await registrations.approveRegistration(req.params.id, {
    // req.user.id for a platform admin is the string "pa_<n>" (see authService);
    // the registry column stores the numeric platform_admins.id.
    adminId: Number(String(req.user?.id || '').replace(/^pa_/, '')) || null,
    adminName: req.user?.name || null,
    slug: req.body?.slug || '',
    // Chosen by the approver, who has the company's size and turnover in front
    // of them at exactly this moment.
    planId: req.body?.plan_id || null,
    trialDays: req.body?.trial_days,
    billingNote: req.body?.billing_note || '',
  }))
);

export const reject = asyncHandler(async (req, res) =>
  respond(res, await registrations.rejectRegistration(req.params.id, {
    adminId: Number(String(req.user?.id || '').replace(/^pa_/, '')) || null,
    note: req.body?.note || '',
  }))
);

/* ── The corporate-email exception list (platform admins only) ────────────── */

export const whitelist = asyncHandler(async (_req, res) =>
  respond(res, await registrations.listWhitelist())
);

export const whitelistAdd = asyncHandler(async (req, res) =>
  respond(res, await registrations.addWhitelistEntry(req.body || {}, req.user), 201)
);

export const whitelistRemove = asyncHandler(async (req, res) =>
  respond(res, await registrations.removeWhitelistEntry(req.params.id))
);
