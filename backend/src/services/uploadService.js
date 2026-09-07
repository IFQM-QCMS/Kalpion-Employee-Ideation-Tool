/** Upload service - Node port of PHP api/upload.php (idea attachments). */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import config from '../config/index.js';
import { badRequest, forbidden, ApiError } from '../utils/respond.js';
import { masterDb } from '../database/master.js';
import { getOrgSettings } from './mailerService.js';
import { platformFileCeilingMb } from './platformSettingsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_BASE = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'xlsx', 'xls', 'csv', 'docx', 'doc'];

/** Per-tenant upload directory (created if missing). Mirrors PHP uploadDir(). */
export async function tenantUploadDir(slug) {
  const dir = path.join(UPLOADS_BASE, slug || 'ifqm');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}



/** Bytes currently used by one tenant's uploads. */
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

/*
 * This tenant's storage cap in MB: its own override, else the platform default, else 0
 * meaning unlimited.
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
  // 'support' and 'benefits' let an employee attach the document(s) that back up the Support
  // Required and Benefits Expected they described on the business-case step - alongside the
  // existing situation/solution attachments.
  if (!ideaId || !['situation', 'solution', 'support', 'benefits'].includes(section)) {
    throw badRequest('Invalid parameters.');
  }

  const [rows] = await db.execute('SELECT id FROM ideas WHERE id=? AND submitter_id=?', [ideaId, user.id]);
  if (!rows.length) throw forbidden('Unauthorized or idea not found.');

  if (!file) throw badRequest('No file uploaded.');

  // Each organisation sets its own attachment ceiling, bounded by the platform-wide one.
  const settings = await getOrgSettings(db);
  // The ceiling is the platform admin's, not the environment's - see
  // platformFileCeilingMb().
  const ceiling = await platformFileCeilingMb();
  const orgMb = Math.max(1, Math.min(ceiling, parseInt(settings.max_file_mb, 10) || ceiling));
  const maxBytes = orgMb * 1024 * 1024;
  if (file.size > maxBytes) throw badRequest(`File exceeds this organisation's ${orgMb} MB limit.`);

  const ext = path.extname(file.originalname).slice(1).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw badRequest('File type not allowed.');

  const dir = await tenantUploadDir(slug);

  // MOM §8.5 - an upper limit per organisation, not just per file.
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

// Extension content type. We serve a fixed type from this map rather than sniffing the
// client-supplied name, and always as an attachment, so a file can never be rendered
// inline in the app's origin.
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

/** Resolve an attachment for download, enforcing tenant + visibility rules. */
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

  // filepath is a server-generated name (attach_<hex>.<ext>), but never trust a stored value
  // as a path - resolve it and confirm it stayed inside the tenant's own directory.
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
