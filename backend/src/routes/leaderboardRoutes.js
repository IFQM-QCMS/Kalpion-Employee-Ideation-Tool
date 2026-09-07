/*
 * Leaderboard routes - /api/leaderboard Ported from the `leaderboard` action of PHP
 * api/users.php (auth required).
 */
import { Router } from 'express';
import * as leaderboard from '../controllers/leaderboardController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, leaderboard.leaderboard); // action=leaderboard&period=

export default router;
