/*
 * Notification routes - /api/notifications/* Ported from the `notifications` / `mark_read`
 * actions of PHP api/users.php.
 */
import { Router } from 'express';
import * as notifications from '../controllers/notificationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', notifications.list);              // action=notifications
router.post('/mark-read', notifications.markRead); // action=mark_read

export default router;
