/** Upload routes - /api/upload/* (idea attachments) Ported from PHP api/upload.php. */
import { Router } from 'express';
import multer from 'multer';
import * as uploads from '../controllers/uploadController.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest } from '../utils/respond.js';
import config from '../config/index.js';

// PHP receives the entire upload and THEN checks the size, returning a clean 400 "File
// exceeds NMB limit." - so the app's size rule is enforced in uploadService (size >
// MAX_FILE_MB). multer only imposes a much higher hard ceiling to prevent runaway memory
// use; a file between the app limit and this ceiling still buffers fully and gets the
// clean service-level 400 (matching PHP), rather than a mid-stream connection reset.
const HARD_CEILING_BYTES = Math.max(config.maxFileMb * 1024 * 1024 * 5, 50 * 1024 * 1024);
const multerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_CEILING_BYTES } });

function handleFile(req, res, next) {
  multerUpload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(badRequest(`File exceeds ${config.maxFileMb}MB limit.`));
      return next(err);
    }
    next();
  });
}

const router = Router();

router.post('/', requireAuth, handleFile, uploads.upload);            // action=upload
router.get('/:id/download', requireAuth, uploads.download);          // authenticated file fetch
router.delete('/:id', requireAuth, uploads.remove);                  // action=delete

export default router;
