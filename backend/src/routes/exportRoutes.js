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
router.get('/analytics', requireRole(...ANALYTICS_ROLES), exp.analytics); // action=analytics (HTML)
router.get('/idea/:id/pdf', requireAuth, exp.ideaPdf); // single-idea closure summary PDF

export default router;
