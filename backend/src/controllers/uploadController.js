/** Upload controller - HTTP layer over uploadService. */
import { createReadStream } from 'node:fs';
import * as uploadService from '../services/uploadService.js';
import { respond } from '../utils/respond.js';
import asyncHandler from '../utils/asyncHandler.js';

export const upload = asyncHandler(async (req, res) => {
  const slug = req.tenant?.slug || 'ifqm';
  const { filename } = await uploadService.upload(req.db, slug, req.user, {
    ideaId: req.body?.idea_id,
    section: req.body?.section ?? 'situation',
    file: req.file,
  });
  // No public URL is returned any more - attachments are fetched through the authenticated
  // download route below, keyed by attachment id.
  return respond(res, { success: true, filename });
});

/** GET /api/upload/:id/download - authenticated, tenant-scoped file stream. */
export const download = asyncHandler(async (req, res) => {
  const slug = req.tenant?.slug || 'ifqm';
  const { absPath, filename, contentType } =
    await uploadService.getDownloadable(req.db, slug, req.user, req.params.id);

  // Always as an attachment, never inline: an uploaded file must not be able to execute in
  // the app's own origin. nosniff stops the browser second-guessing the declared type.
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/["\r\n]/g, '')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  createReadStream(absPath)
    .on('error', () => {
      if (!res.headersSent) res.status(404).json({ success: false, error: 'File missing on disk.' });
      else res.destroy();
    })
    .pipe(res);
});

export const remove = asyncHandler(async (req, res) => {
  const slug = req.tenant?.slug || 'ifqm';
  const result = await uploadService.remove(
    req.db, slug, req.user, req.params.id ?? req.body?.attachment_id
  );
  return respond(res, result);
});

export default { upload, download, remove };
