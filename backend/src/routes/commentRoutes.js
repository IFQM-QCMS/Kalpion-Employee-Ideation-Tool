/** Comment routes - /api/comments/* Ported from PHP api/comments.php. */
import { Router } from 'express';
import * as comments from '../controllers/commentController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', comments.list);        // action=list&idea_id=
router.post('/', comments.add);        // action=add
router.delete('/:id', comments.remove); // action=delete

export default router;
