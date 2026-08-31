/**
 * Rewards & Recognition routes — /api/rewards/*
 *
 * ── Who may read this ──────────────────────────────────────────────────────
 *
 * The org admin, and the roles that already export organisation-wide reports.
 *
 * It is deliberately NOT open to everyone the way the ordinary leaderboard is.
 * The public leaderboard is a ranking; this pack carries every employee's
 * contact details, their manager, the full text of every idea in the period and
 * the name of everybody who approved each one. That is an HR document about
 * identifiable people, and the fact that it is assembled from things each
 * reader could see individually does not make the compilation harmless — it is
 * precisely the compilation that makes it sensitive.
 *
 * Org admins are included even though they hold no approval authority. Running
 * the reward cycle is administration, not adjudication: reading who did well is
 * not deciding whether an idea is any good, so nothing here crosses the line
 * that keeps admins out of the approval chain.
 */
import { Router } from 'express';
import * as rewards from '../controllers/rewardsController.js';
import { requireRole } from '../middleware/auth.js';

const RR_ROLES = [
  'admin', 'super_admin',
  'executive', 'plant_head', 'senior_manager', 'department_manager', 'manager',
];

const router = Router();

router.get('/leaderboard', requireRole(...RR_ROLES), rewards.leaderboard);
router.get('/detail', requireRole(...RR_ROLES), rewards.detail);
router.get('/export.xlsx', requireRole(...RR_ROLES), rewards.excel);
router.get('/export.pdf', requireRole(...RR_ROLES), rewards.pdf);

export default router;
