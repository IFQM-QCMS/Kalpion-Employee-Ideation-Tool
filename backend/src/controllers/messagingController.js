/** Messaging controller - HTTP layer over messagingService. */
import asyncHandler from '../utils/asyncHandler.js';
import { respond } from '../utils/respond.js';
import * as messaging from '../services/messagingService.js';

export const get = asyncHandler(async (_req, res) =>
  respond(res, await messaging.getMessagingConfig())
);

export const update = asyncHandler(async (req, res) =>
  respond(res, await messaging.updateMessagingConfig(req.body || {}, req.user))
);

export const test = asyncHandler(async (req, res) =>
  respond(res, await messaging.sendTest({
    phone: req.body?.phone,
    provider: req.body?.provider,
  }))
);

export const testMail = asyncHandler(async (req, res) =>
  respond(res, await messaging.sendTestMail({ to: req.body?.to }))
);

export default { get, update, test, testMail };
