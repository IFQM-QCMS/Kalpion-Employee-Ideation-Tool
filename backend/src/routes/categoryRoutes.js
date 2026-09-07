/** Reading is open to every signed-in user: the submission wizard cannot render without it. */
import { Router } from 'express';
import * as categories from '../controllers/categoryController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, categories.list);
router.post('/', requireRole('admin', 'super_admin'), categories.create);
router.delete('/:id', requireRole('admin', 'super_admin'), categories.remove);

export default router;
