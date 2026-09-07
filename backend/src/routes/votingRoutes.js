/*
 * Voting routes - /api/votes/* Ported from PHP api/votes.php + board/community_vote from
 * api/ideas.php.
 */
import { Router } from 'express';
import * as voting from '../controllers/votingController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/rate', voting.rate);                 // votes.php action=vote
router.post('/upvote', voting.upvote);             // votes.php action=upvote
router.post('/downvote', voting.downvote);         // votes.php action=downvote
router.post('/community', voting.communityVote);   // ideas.php action=community_vote
router.get('/community-stats', voting.communityStats); // votes.php action=community_stats
router.get('/poll-all', voting.pollAll);           // votes.php action=poll_all
router.get('/stats', voting.stats);                // votes.php action=stats
router.get('/board', voting.board);                // ideas.php action=board

export default router;
