/*
 * Report routes - /api/reports/* (JSON analytics + audit log) Ported from the `analytics`
 * / `audit` actions of PHP api/users.php.
 */
import { Router } from 'express';
import * as reports from '../controllers/reportController.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/analytics', requireRole('admin', 'executive', 'manager', 'department_manager', 'senior_manager', 'plant_head', 'super_admin'), reports.analytics);
router.get('/audit', requireRole('admin', 'manager', 'department_manager', 'senior_manager', 'plant_head', 'executive', 'super_admin'), reports.audit);

export default router;
