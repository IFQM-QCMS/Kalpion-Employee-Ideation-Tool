/** Voting controller - HTTP layer over votingService. */
import * as voting from '../services/votingService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const rate = asyncHandler(async (req, res) =>
  respond(res, await voting.rate(req.db, req.user, req.body || {}))
);

export const upvote = asyncHandler(async (req, res) =>
  respond(res, await voting.upDownVote(req.db, req.user, 'upvote', req.body || {}))
);

export const downvote = asyncHandler(async (req, res) =>
  respond(res, await voting.upDownVote(req.db, req.user, 'downvote', req.body || {}))
);

export const communityVote = asyncHandler(async (req, res) =>
  respond(res, await voting.communityVote(req.db, req.user, req.body || {}))
);

export const communityStats = asyncHandler(async (req, res) =>
  respond(res, await voting.communityStats(req.db, req.user, req.query.idea_id))
);

export const pollAll = asyncHandler(async (req, res) =>
  respond(res, await voting.pollAll(req.db))
);

export const stats = asyncHandler(async (req, res) =>
  respond(res, await voting.stats(req.db, req.user, req.query.idea_id))
);

export const board = asyncHandler(async (req, res) =>
  respond(res, await voting.board(req.db, req.user, req.query.sort))
);

export default { rate, upvote, downvote, communityVote, communityStats, pollAll, stats, board };
