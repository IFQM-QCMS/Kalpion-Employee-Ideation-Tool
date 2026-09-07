/** The org admin, and the roles that already export organisation-wide reports. */
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
