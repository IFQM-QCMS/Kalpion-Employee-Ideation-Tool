/*
 * Score routes - /api/score/* Ported from PHP api/score.php. `score` requires auth;
 * `batch_rescore` is admin-only (PHP requireRole('admin') - not super_admin).
 */
import { Router } from 'express';
import * as score from '../controllers/scoreController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/', requireAuth, score.score);                        // action=score&id=
// Batch rescore walks every idea through the AI scorer - one click, unbounded cost (and
// real money if a provider key is configured). Cap it.
router.post('/batch-rescore', requireRole('admin'), heavyLimiter, score.batchRescore);

export default router;
