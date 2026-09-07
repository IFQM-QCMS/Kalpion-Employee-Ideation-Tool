/** Challenge routes - /api/challenges/* Ported from PHP api/challenges.php. */
import { Router } from 'express';
import * as challenges from '../controllers/challengeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const CREATE_ROLES = ['admin', 'executive', 'manager', 'department_manager', 'senior_manager', 'plant_head', 'super_admin'];

const router = Router();

router.get('/', requireAuth, challenges.list);                    // action=list
router.get('/:id', requireAuth, challenges.get);                  // action=get&id=
router.post('/', requireRole(...CREATE_ROLES), challenges.create);   // action=create
router.put('/:id', requireRole(...CREATE_ROLES), challenges.update); // action=update
router.delete('/:id', requireRole('admin', 'super_admin'), challenges.remove); // action=delete

export default router;
