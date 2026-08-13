/**
 * Auth controller — thin HTTP layer over authService.
 * Maps to the PHP api/auth.php actions (me, login, logout, forgot_password,
 * reset_password, check_reset_token).
 */
import * as authService from '../services/authService.js';
import * as otpService from '../services/otpService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

const hostOf = (req) => req.headers['x-forwarded-host'] || req.headers.host || 'localhost';

/** GET /api/auth/me — mirrors action=me. Uses optionalAuth upstream. */
export const me = asyncHandler(async (req, res) => {
  if (!req.user) {
    return respond(res, { success: false, authenticated: false });
  }
  // CSRF token intentionally omitted — JWT-in-header removes the need (see
  // authService docblock). Response is otherwise identical to PHP.
  return respond(res, { success: true, authenticated: true, user: req.user });
});

/** POST /api/auth/login */
export const login = asyncHandler(async (req, res) => {
  const { email, password, org_slug } = req.body || {};
  const result = await authService.login({
    email,
    password,
    orgSlug: org_slug,
    host: hostOf(req),
    // MOM §12.12 — where the sign-in came from, for the activity feed. Read
    // here rather than in the service so the service stays free of req.
    meta: {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      // The browser's own time zone, which it sends with the sign-in. Used to
      // describe roughly where a platform-admin sign-in came from without
      // handing anybody's address to a geolocation service.
      timeZone: req.get('x-client-timezone') || req.body?.client_timezone || null,
    },
  });
  return respond(res, { success: true, user: result.user, token: result.token });
});

/*
 * One-time-code sign-in (MOM §4.1, §4.2). `verify` returns the same
 * { user, token } shape as a password login, so nothing downstream has to know
 * which route the session came from.
 */
export const otpStatus = asyncHandler(async (_req, res) =>
  respond(res, await otpService.otpStatus())
);

export const otpRequest = asyncHandler(async (req, res) =>
  respond(res, await otpService.requestOtp({
    identifier: req.body?.identifier,
    purpose: req.body?.purpose || 'login',
    meta: {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      // The browser's own time zone, which it sends with the sign-in. Used to
      // describe roughly where a platform-admin sign-in came from without
      // handing anybody's address to a geolocation service.
      timeZone: req.get('x-client-timezone') || req.body?.client_timezone || null,
    },
  }))
);

export const otpVerify = asyncHandler(async (req, res) => {
  const result = await otpService.verifyOtp({
    identifier: req.body?.identifier,
    code: req.body?.code,
    meta: {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      // The browser's own time zone, which it sends with the sign-in. Used to
      // describe roughly where a platform-admin sign-in came from without
      // handing anybody's address to a geolocation service.
      timeZone: req.get('x-client-timezone') || req.body?.client_timezone || null,
    },
  });
  return respond(res, { success: true, user: result.user, token: result.token });
});

/** POST /api/auth/logout — stateless; client discards the token. */
export const logout = asyncHandler(async (_req, res) => {
  return respond(res, { success: true });
});

/** POST /api/auth/forgot-password */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email, org_slug } = req.body || {};
  const result = await authService.forgotPassword({ email, orgSlug: org_slug, host: hostOf(req) });
  return respond(res, result);
});

/**
 * POST /api/auth/password-reset/request-code
 *
 * The other way to start a reset: a code to the registered address or mobile,
 * for somebody who cannot reach the mailbox the link would go to.
 */
export const requestResetCode = asyncHandler(async (req, res) =>
  respond(res, await authService.requestPasswordResetCode({
    identifier: req.body?.identifier, meta: { ip: req.ip },
  }))
);

/** POST /api/auth/password-reset/verify-code — exchange a code for a reset token. */
export const verifyResetCode = asyncHandler(async (req, res) =>
  respond(res, await authService.verifyPasswordResetCode({
    identifier: req.body?.identifier, code: req.body?.code,
  }))
);

/** POST /api/auth/reset-password */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, org_slug } = req.body || {};
  const result = await authService.resetPassword({
    token,
    password,
    orgSlug: org_slug,
    host: hostOf(req),
  });
  return respond(res, result);
});

/** GET /api/auth/check-reset-token */
export const checkResetToken = asyncHandler(async (req, res) => {
  const result = await authService.checkResetToken({
    token: req.query.token,
    orgSlug: req.query.org,
    host: hostOf(req),
  });
  return respond(res, result);
});

/**
 * POST /api/auth/change-password — signed-in password change.
 *
 * Also the exit route from the forced change a bulk-imported employee faces on
 * first login. Returns a new token: stamping password_changed_at revokes every
 * token issued before it, including the caller's.
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const result = await authService.changePassword(req.db, req.user, {
    currentPassword: current_password,
    newPassword: new_password,
    orgSlug: req.auth?.org_slug,
  });
  return respond(res, result);
});

export default {
  me, login, logout, forgotPassword, resetPassword, checkResetToken, changePassword,
  requestResetCode, verifyResetCode,
};
