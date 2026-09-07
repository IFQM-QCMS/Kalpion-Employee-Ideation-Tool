/** Leaderboard controller - HTTP layer over leaderboardService. */
import * as leaderboardService from '../services/leaderboardService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const leaderboard = asyncHandler(async (req, res) =>
  respond(res, await leaderboardService.leaderboard(req.db, req.query.period ?? 'all'))
);

export default { leaderboard };
