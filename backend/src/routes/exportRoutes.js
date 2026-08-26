/**
 * Export routes — /api/export/*  (raw CSV / HTML downloads)
 * Ported from PHP api/export.php.
 */
import { Router } from 'express';
import * as exp from '../controllers/exportController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const ANALYTICS_ROLES = ['admin', 'executive', 'manager', 'department_manager', 'senior_manager', 'plant_head', 'super_admin'];
// Exporting a single idea as a closure-summary PDF is open to everybody.
//
// Restricting it by role never protected anything: the idea is loaded through
// ideaService.get(), which already decides what this particular reader may see
// and redacts the rest. An employee's PDF therefore carries the preview of the
// problem and no proposed solution — the same thing they see on screen. A
// reviewer's carries the full text. One rule, applied in one place.

const router = Router();

router.get('/ideas', requireAuth, exp.ideas);              // action=ideas
router.get('/leaderboard', requireAuth, exp.leaderboard);  // action=leaderboard
// Everyone who can see the leaderboard can export it — it is the same public
// ranking, in a shape that can be filed.
router.get('/leaderboard-pdf', requireAuth, exp.leaderboardPdf);
/*
 * POST, not GET: it sends mail, and a GET that sends is one browser prefetch
 * away from sending itself.
 *
 * ANALYTICS_ROLES rather than requireAuth: this takes an arbitrary recipient
 * and sends from IFQM's verified sending domain, so an unguarded version is a
 * spam relay wearing our authentication. It is the same set that may already
 * export organisation-wide reports, which is the same class of act.
 */
router.post('/leaderboard/send', requireRole(...ANALYTICS_ROLES), exp.sendLeaderboard);
router.get('/analytics', requireRole(...ANALYTICS_ROLES), exp.analytics); // action=analytics (HTML)
router.get('/idea/:id/pdf', requireAuth, exp.ideaPdf); // single-idea closure summary PDF
// The product manual. Authenticated but not tenant-scoped — it documents the
// software, not anybody's data, so every signed-in role may read it.
router.get('/user-guide', requireAuth, exp.userGuide);

export default router;
