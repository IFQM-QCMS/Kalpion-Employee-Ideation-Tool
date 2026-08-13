/**
 * User routes — /api/users/*
 * Ported from the user-management actions of PHP api/users.php.
 * Role guards mirror the PHP requireRole(...) calls exactly.
 */
import { Router } from 'express';
import multer from 'multer';
import * as users from '../controllers/userController.js';
import * as userImport from '../controllers/userImportController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { heavyLimiter } from '../middleware/rateLimiter.js';
import { badRequest } from '../utils/respond.js';

const router = Router();

// Spreadsheets are small even at 20k rows (a few MB). The cap is deliberately
// tight: exceljs decompresses the upload, so an unbounded file is a memory DoS.
const IMPORT_MAX_BYTES = 15 * 1024 * 1024;
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMPORT_MAX_BYTES, files: 1 },
});

function handleImportFile(req, res, next) {
  importUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(badRequest(`File is too large (max ${IMPORT_MAX_BYTES / 1024 / 1024} MB).`));
      }
      return next(err);
    }
    next();
  });
}

// Only an org admin (or super admin) may create accounts in bulk — the same
// guard single-user creation uses. The service additionally validates each row's
// role against what this specific actor is allowed to assign.
const ADMIN = requireRole('admin', 'super_admin');

// ── Bulk import ── declared before the /:id routes so "import" is never
// mistaken for a user id.
router.get('/import/template', ADMIN, userImport.template);
router.post('/import/preview', ADMIN, handleImportFile, userImport.preview);
router.post('/import', ADMIN, heavyLimiter, handleImportFile, userImport.start);

// §13.14 — reporting structure as an editable sheet. Download comes pre-filled
// with the organisation as it stands, so the admin edits reality rather than
// retyping it. Preview shows what would change; nothing is written until apply.
router.get('/hierarchy/template', ADMIN, users.hierarchyTemplate_download);
router.post('/hierarchy/preview', ADMIN, handleImportFile, users.hierarchyTemplate_preview);
router.post('/hierarchy/apply', ADMIN, heavyLimiter, handleImportFile, users.hierarchyTemplate_apply);
router.get('/import/:id', ADMIN, userImport.job);
router.get('/import/:id/errors.csv', ADMIN, userImport.errorsCsv);

// Literal paths first, before the /:id param routes.
router.get('/', requireAuth, users.list);                       // action=list
router.get('/admin', requireRole('admin', 'super_admin'), users.adminUsers);      // action=admin_users
// §13.8 — a user's reporting line. Admin-only: it names managers up the tree,
// which is org-chart data an ordinary employee has no need to enumerate.
router.get('/:id/chain', requireRole('admin', 'super_admin'), users.reportingChain);
router.get('/managers', requireRole('admin', 'super_admin'), users.managers);     // action=managers
// PHP scoped hierarchy to super_admin (Command Center). The tenant admin's
// Hierarchy screen (approval-chain + reporting-line management) needs the same
// tree, so org admins are allowed in too — it is their own org's data.
router.get('/hierarchy', requireRole('admin', 'super_admin'), users.hierarchy);   // action=hierarchy
router.post('/profile', requireAuth, users.updateProfile);      // action=profile
// Changing your own number is verified by code — each request costs a real SMS,
// so both legs sit behind the same limiter as the other code endpoints.
router.post('/me/phone/request-code', requireAuth, heavyLimiter, users.requestPhoneChangeCode);
router.post('/me/phone/confirm', requireAuth, heavyLimiter, users.confirmPhoneChange);

router.post('/', requireRole('admin', 'super_admin'), users.createUser);          // action=create_user
router.put('/:id/manager', requireRole('admin', 'super_admin'), users.updateManager); // hierarchy screen: reporting line only
router.put('/:id', requireRole('admin', 'super_admin'), users.updateUser);        // action=update_user
router.delete('/:id', requireRole('admin', 'super_admin'), users.deleteUser);     // action=delete_user

export default router;
