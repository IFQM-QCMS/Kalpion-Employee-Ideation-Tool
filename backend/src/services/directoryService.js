/**
 * Global login directory — maps a login identifier (email or phone) to the
 * tenant that owns it, so a user can sign in with no organisation code.
 *
 * The directory is an optimisation and the source of truth for phone→tenant
 * resolution. It is maintained as users are created/updated/deleted/imported,
 * and `resolveTenantByLogin` self-heals it for pre-existing users by scanning
 * active tenants once and caching what it finds — so no data back-fill is
 * required.
 */
import { masterDb } from '../database/master.js';
import { resolveTenant, getTenantPool } from '../database/tenant.js';
import logger from '../utils/logger.js';

export function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

/** Reduce a phone to a comparable key: digits only, last 10 (India-friendly). */
export function normalizePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  if (digits.length < 7) return '';
  return digits.slice(-10);
}

/** The directory key for a raw login input. */
export function directoryKey(raw) {
  const id = String(raw || '').trim();
  if (!id) return null;
  if (isEmail(id)) return { key: id.toLowerCase(), type: 'email' };
  const phone = normalizePhone(id);
  if (phone) return { key: phone, type: 'phone' };
  return { key: id.toLowerCase(), type: 'email' }; // fall back to treating it as an email-ish id
}

/** Upsert a user's email + phone identifiers into the directory (best-effort). */
export async function indexUser(tenant, user) {
  if (!tenant || !user) return;
  const rows = [];
  if (user.email) rows.push([String(user.email).toLowerCase(), 'email']);
  const phone = normalizePhone(user.phone);
  if (phone) rows.push([phone, 'phone']);
  if (!rows.length) return;
  try {
    const master = masterDb();
    for (const [identifier, type] of rows) {
      await master.execute(
        `INSERT INTO login_directory (identifier, id_type, tenant_id, tenant_slug, user_id)
              VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id_type=VALUES(id_type), tenant_id=VALUES(tenant_id),
                                 tenant_slug=VALUES(tenant_slug), user_id=VALUES(user_id)`,
        [identifier, type, tenant.id, tenant.slug, user.id]
      );
    }
  } catch (e) {
    // Never fail a user operation because the directory write failed — login
    // self-heals via the tenant scan.
    logger.warn('login_directory index failed', e.message);
  }
}

/** Remove a user's directory rows (best-effort). */
export async function deindexUser(tenantId, userId) {
  try {
    await masterDb().execute(
      'DELETE FROM login_directory WHERE tenant_id = ? AND user_id = ?',
      [tenantId, userId]
    );
  } catch (e) {
    logger.warn('login_directory deindex failed', e.message);
  }
}

/**
 * Resolve the tenant for a login identifier (email or phone).
 * 1) exact directory lookup; 2) scan active tenants and self-heal.
 * Returns a tenant row, or null when the identifier matches nobody.
 */
export async function resolveTenantByLogin(rawIdentifier) {
  const parsed = directoryKey(rawIdentifier);
  if (!parsed) return null;
  const { key, type } = parsed;

  let master;
  try { master = masterDb(); } catch { return null; }

  // 1) Fast path — directory row.
  try {
    const [rows] = await master.execute(
      'SELECT tenant_slug FROM login_directory WHERE identifier = ? LIMIT 1',
      [key]
    );
    if (rows.length) {
      const tenant = await resolveTenant({ slug: rows[0].tenant_slug }).catch(() => null);
      if (tenant) return tenant;
    }
  } catch (e) {
    logger.warn('login_directory lookup failed', e.message);
  }

  // 2) Fallback — scan active tenants, then cache the hit.
  let tenants;
  try {
    const [rows] = await master.execute("SELECT * FROM tenants WHERE status = 'active'");
    tenants = rows;
  } catch {
    return null;
  }

  for (const tenant of tenants) {
    try {
      const pool = getTenantPool(tenant);
      let sql; let params;
      if (type === 'phone') {
        // Phones are stored in varied formats; compare on digits only.
        sql = "SELECT id, email, phone FROM users WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+',''),'(','') LIKE ? AND status='active' LIMIT 1";
        params = [`%${key}`];
      } else {
        sql = "SELECT id, email, phone FROM users WHERE LOWER(email) = ? AND status='active' LIMIT 1";
        params = [key];
      }
      const [urows] = await pool.execute(sql, params);
      if (urows.length) {
        await indexUser(tenant, urows[0]); // self-heal
        return tenant;
      }
    } catch {
      // A tenant DB that can't be reached is skipped, not fatal.
    }
  }
  return null;
}

export default { isEmail, normalizePhone, directoryKey, indexUser, deindexUser, resolveTenantByLogin };
