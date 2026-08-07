/**
 * Upload service — Node port of PHP api/upload.php (idea attachments).
 *
 *   upload          → validate params + ownership + size + extension, write the
 *                     file to the per-tenant uploads dir, record it in
 *                     idea_attachments.
 *   getDownloadable → authorise a read and resolve the file on disk.
 *   remove          → verify ownership, unlink the file, delete the row.
 *
 * Files live under backend/uploads/<slug>/ and are NOT web-accessible. They used
 * to be served straight off disk by express.static at /api/uploads/<file>, with
 * no authentication and no tenant check — every employee's uploaded document was
 * downloadable by anyone who had the URL. Reads now go through
 * GET /api/upload/:id/download, which authenticates the caller and resolves the
 * attachment inside their own tenant's database.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import config from '../config/index.js';
import { badRequest, forbidden, ApiError } from '../utils/respond.js';
import { masterDb } from '../database/master.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_BASE = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'xlsx', 'xls', 'csv', 'docx', 'doc'];

/** Per-tenant upload directory (created if missing). Mirrors PHP uploadDir(). */
export async function tenantUploadDir(slug) {
  const dir = path.join(UPLOADS_BASE, slug || 'ifqm');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * @param file { originalname, buffer, size } (from multer memoryStorage)
 * @returns { safeName, filename }
 */

/**
 * Bytes currently used by one tenant's uploads.
 *
 * A flat directory per tenant, so a single readdir is enough — no recursion,
 * and no reason for this to get slower as other tenants grow.
 */
async function dirSize(dir) {
  try {
    const names = await fs.readdir(dir);
    const sizes = await Promise.all(names.map(async (n) => {
      try { return (await fs.stat(path.join(dir, n))).size; } catch { return 0; }
    }));
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;                     // directory not created yet
  }
}

/**
 * This tenant's storage cap in MB: its own override, else the platform default,
 * else 0 meaning unlimited. Failures return 0 rather than blocking uploads — a
 * registry hiccup must not stop people attaching files.
 */
async function tenantStorageQuotaMb(slug) {
  try {
    const [[t] = []] = await masterDb().execute(
      'SELECT storage_quota_mb FROM tenants WHERE slug = ? LIMIT 1', [slug]
    );
    if (t?.storage_quota_mb != null) return Number(t.storage_quota_mb) || 0;
    const [[d] = []] = await masterDb().execute(
      "SELECT value FROM platform_settings WHERE key_name = 'storage_quota_mb' LIMIT 1"
    );
    return parseInt(d?.value, 10) || 0;
  } catch {
    return 0;
  }
}

export async function upload(db, slug, user, { ideaId, section, file }) {
  ideaId = Number(ideaId) || 0;
  // 'support' and 'benefits' let an employee attach the document(s) that back up
  // the Support Required and Benefits Expected they described on the business-case
  // step — alongside the existing situation/solution attachments.
  if (!ideaId || !['situation', 'solution', 'support', 'benefits'].includes(section)) {
    throw badRequest('Invalid parameters.');
  }

  const [rows] = await db.execute('SELECT id FROM ideas WHERE id=? AND submitter_id=?', [ideaId, user.id]);
  if (!rows.length) throw forbidden('Unauthorized or idea not found.');

  if (!file) throw badRequest('No file uploaded.');

  const maxBytes = config.maxFileMb * 1024 * 1024;
  if (file.size > maxBytes) throw badRequest(`File exceeds ${config.maxFileMb}MB limit.`);

  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw badRequest('File type not allowed.');

  const dir = await tenantUploadDir(slug);

  /*
   * MOM §8.5 — an upper limit per organisation, not just per file.
   *
   * The per-file cap alone stops one enormous upload; it does nothing about ten
   * thousand ordinary ones, which is how shared storage actually fills up. The
   * quota is measured from the directory on disk rather than a running total in
   * the database: a counter drifts the moment a file is removed by hand or a
   * write fails halfway, and a storage limit that quietly disagrees with the
   * storage is worse than none.
   *
   * Checked before the write, and the incoming file counts toward the total, so
   * the limit cannot be stepped over by exactly one file.
   */
  const quotaMb = await tenantStorageQuotaMb(slug);
  if (quotaMb > 0) {
    const usedBytes = await dirSize(dir);
    if (usedBytes + file.size > quotaMb * 1024 * 1024) {
      throw new ApiError(413,
        `Your organisation has used its ${quotaMb} MB of attachment storage. `
        + 'Delete some attachments, or ask IFQM to raise the limit.');
    }
  }
  const safeName = `attach_${Date.now().toString(16)}${crypto.randomBytes(7).toString('hex')}.${ext}`;

  try {
    await fs.writeFile(path.join(dir, safeName), file.buffer);
  } catch {
    throw new ApiError(500, 'Failed to save file.');
  }

  await db.execute(
    'INSERT INTO idea_attachments (idea_id,section,filename,filepath) VALUES (?,?,?,?)',
    [ideaId, section, file.originalname, safeName]
  );

  return { safeName, filename: file.originalname };
}

// Extension → content type. We serve a fixed type from this map rather than
// sniffing the client-supplied name, and always as an attachment, so a file
// can never be rendered inline in the app's origin.
const CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Resolve an attachment for download, enforcing tenant + visibility rules.
 *
 * Attachments used to be served by express.static on /api/uploads with no auth
 * at all: every employee's uploaded document was readable by anyone who had (or
 * guessed) the URL, across every tenant. Downloads now go through this check.
 *
 * `db` is already the caller's tenant pool, so an attachment id from another
 * organisation simply doesn't resolve — cross-tenant reads are impossible.
 */
export async function getDownloadable(db, slug, user, attachmentId) {
  const id = Number(attachmentId) || 0;
  if (!id) throw badRequest('Invalid attachment id.');

  const [rows] = await db.execute(
    `SELECT a.id, a.filename, a.filepath, i.status, i.submitter_id
       FROM idea_attachments a
       JOIN ideas i ON i.id = a.idea_id
      WHERE a.id = ?`,
    [id]
  );
  const att = rows[0];
  if (!att) throw new ApiError(404, 'Attachment not found.');

  // An unsubmitted draft is private to its author (and org admins).
  const isOwner = Number(att.submitter_id) === Number(user.id);
  const isAdmin = ['admin', 'super_admin'].includes(user.role);
  if (att.status === 'Draft' && !isOwner && !isAdmin) {
    throw forbidden('This attachment is not available.');
  }

  // filepath is a server-generated name (attach_<hex>.<ext>), but never trust a
  // stored value as a path — resolve it and confirm it stayed inside the
  // tenant's own directory.
  const dir = await tenantUploadDir(slug);
  const abs = path.resolve(dir, path.basename(String(att.filepath)));
  if (!abs.startsWith(path.resolve(dir) + path.sep)) {
    throw forbidden('Invalid attachment path.');
  }

  const ext = path.extname(abs).slice(1).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw forbidden('File type not allowed.');

  return {
    absPath: abs,
    filename: att.filename || path.basename(abs),
    contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
  };
}

export async function remove(db, slug, user, attachmentId) {
  attachmentId = Number(attachmentId) || 0;

  const [rows] = await db.execute(
    `SELECT a.* FROM idea_attachments a
     JOIN ideas i ON i.id = a.idea_id
     WHERE a.id=? AND i.submitter_id=?`,
    [attachmentId, user.id]
  );
  const att = rows[0];
  if (!att) throw forbidden('Not found or unauthorized.');

  const dir = await tenantUploadDir(slug);
  await fs.unlink(path.join(dir, att.filepath)).catch(() => {}); // best-effort (PHP @unlink)
  await db.execute('DELETE FROM idea_attachments WHERE id=?', [attachmentId]);

  return { success: true };
}

export default { upload, remove, tenantUploadDir, getDownloadable };
