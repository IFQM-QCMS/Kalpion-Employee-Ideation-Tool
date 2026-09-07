/** Any signed-in tenant user may raise a ticket and follow their own. */
import { Router } from 'express';
import * as support from '../controllers/supportController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/tickets', support.listMine);
router.post('/tickets', support.create);
router.get('/tickets/:id', support.getOne);
router.post('/tickets/:id/messages', support.reply);
router.patch('/tickets/:id', support.update);   // tenant may only close

export default router;
