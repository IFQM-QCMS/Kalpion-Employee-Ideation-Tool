/**
 * Integration routes — /api/integrations/*  (org-admin only)
 *
 * The QCMS API key and the push action are administrative and secret-bearing, so
 * every route here is limited to the organisation's admins. The key never leaves
 * the server: the push is made from the backend, not the browser.
 */
import { Router } from 'express';
import * as integration from '../controllers/integrationController.js';
import { requireRole } from '../middleware/auth.js';

const ADMIN = ['admin', 'super_admin'];

const router = Router();

router.get('/approved-ideas', requireRole(...ADMIN), integration.approvedIdeas);
router.get('/qcms', requireRole(...ADMIN), integration.getConfig);
router.put('/qcms', requireRole(...ADMIN), integration.saveConfig);
router.post('/push', requireRole(...ADMIN), integration.push);

export default router;
