/**
 * Export routes — /api/export/*  (raw CSV / HTML downloads)
 * Ported from PHP api/export.php.
 */
import { Router } from 'express';
import * as exp from '../controllers/exportController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const ANALYTICS_ROLES = ['admin', 'executive', 'manager', 'department_manager', 'senior_manager', 'plant_head', 'super_admin'];
// The review hierarchy — the higher authorities who review employees' ideas.
// Only they can export a single idea as a closure-summary PDF; employees and
// trainees (the submitters) cannot.
const REVIEWER_ROLES = ['team_lead', 'project_lead', 'manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'admin', 'super_admin'];

const router = Router();

router.get('/ideas', requireAuth, exp.ideas);              // action=ideas
router.get('/leaderboard', requireAuth, exp.leaderboard);  // action=leaderboard
router.get('/analytics', requireRole(...ANALYTICS_ROLES), exp.analytics); // action=analytics (HTML)
router.get('/idea/:id/pdf', requireRole(...REVIEWER_ROLES), exp.ideaPdf); // single-idea closure summary PDF

export default router;
