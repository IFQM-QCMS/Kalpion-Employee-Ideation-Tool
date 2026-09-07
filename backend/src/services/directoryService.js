/*
 * Global login directory - maps a login identifier (email, phone or username) to the
 * tenant that owns it, so a user can sign in with no organisation code.
 */
import { masterDb } from '../database/master.js';
import { resolveTenant, getTenantPool, heldForNonPayment } from '../database/tenant.js';
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

/*
 * A valid sign-in username: 3-30 characters of a-z, 0-9, dot, underscore or hyphen,
 * containing at least one letter.
 */
const USERNAME_RE = /^(?=.*[a-z])[a-z0-9._-]{3,30}$/;

export function isUsername(v) {
  return USERNAME_RE.test(String(v || '').trim().toLowerCase());
}

/** Normalise a username for storage and comparison, or '' if unusable. */
export function normalizeUsername(v) {
  const u = String(v || '').trim().toLowerCase();
  return isUsername(u) ? u : '';
}

/** The directory key for a raw login input. */
export function directoryKey(raw) {
  const id = String(raw || '').trim();
  if (!id) return null;
  if (isEmail(id)) return { key: id.toLowerCase(), type: 'email' };
  const phone = normalizePhone(id);
  if (phone) return { key: phone, type: 'phone' };
  const username = normalizeUsername(id);
  if (username) return { key: username, type: 'username' };
  // Neither a valid address, number nor username.
  return { key: id.toLowerCase(), type: 'email' };
}

/** Upsert a user's email, phone and username into the directory (best-effort). */
export async function indexUser(tenant, user) {
  if (!tenant || !user) return;
  const rows = [];
  if (user.email) rows.push([String(user.email).toLowerCase(), 'email']);
  const phone = normalizePhone(user.phone);
  if (phone) rows.push([phone, 'phone']);
  // Usernames are deliberately absent: they are claimed through claimUsername(), which is
  // allowed to fail.
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
    // Never fail a user operation because the directory write failed - login self-heals via
    // the tenant scan.
    logger.warn('login_directory index failed', e.message);
  }
}

/** Claim a username for one user, platform-wide. */
export async function claimUsername(tenant, userId, rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!username || !tenant || !userId) return false;
  const master = masterDb();

  await master.execute(
    `INSERT IGNORE INTO login_directory (identifier, id_type, tenant_id, tenant_slug, user_id)
          VALUES (?, 'username', ?, ?, ?)`,
    [username, tenant.id, tenant.slug, userId]
  );

  const [[row] = []] = await master.execute(
    'SELECT tenant_id, user_id FROM login_directory WHERE identifier = ? LIMIT 1',
    [username]
  );
  if (!row) return false;
  return Number(row.tenant_id) === Number(tenant.id) && Number(row.user_id) === Number(userId);
}

/** Is this username free, or already this user's own? Advisory - claim decides. */
export async function usernameAvailable(rawUsername, { tenantId, userId } = {}) {
  const username = normalizeUsername(rawUsername);
  if (!username) return false;
  try {
    const [[row] = []] = await masterDb().execute(
      'SELECT tenant_id, user_id FROM login_directory WHERE identifier = ? LIMIT 1',
      [username]
    );
    if (!row) return true;
    return Number(row.tenant_id) === Number(tenantId) && Number(row.user_id) === Number(userId);
  } catch {
    // The registry is unreachable. Report "taken" rather than "free": letting a claim through
    // unchecked is the one outcome that cannot be undone later.
    return false;
  }
}

/** Release a username so it can be claimed again. */
export async function releaseUsername(rawUsername) {
  const username = normalizeUsername(rawUsername);
  if (!username) return;
  try {
    await masterDb().execute(
      "DELETE FROM login_directory WHERE identifier = ? AND id_type = 'username'",
      [username]
    );
  } catch (e) {
    logger.warn('login_directory username release failed', e.message);
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

/** Resolve the tenant for a login identifier (email or phone). */
export async function resolveTenantByLogin(rawIdentifier) {
  const parsed = directoryKey(rawIdentifier);
  if (!parsed) return null;
  const { key, type } = parsed;

  let master;
  try { master = masterDb(); } catch { return null; }

  // 1) Fast path - directory row.
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

  // 2) Fallback - scan the tenants a person may still sign in to, then cache the hit.
  let tenants;
  try {
    const [rows] = await master.execute("SELECT * FROM tenants WHERE status IN ('active','suspended')");
    tenants = rows.filter((t) => t.status === 'active' || heldForNonPayment(t));
  } catch {
    return null;
  }

  for (const tenant of tenants) {
    try {
      const pool = getTenantPool(tenant);
      let sql; let params;
      const cols = 'SELECT id, email, phone, username FROM users WHERE ';
      if (type === 'phone') {
        // Phones are stored in varied formats; compare on digits only.
        sql = `${cols}REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+',''),'(','') LIKE ? AND status='active' LIMIT 1`;
        params = [`%${key}`];
      } else if (type === 'username') {
        sql = `${cols}LOWER(username) = ? AND status='active' LIMIT 1`;
        params = [key];
      } else {
        sql = `${cols}LOWER(email) = ? AND status='active' LIMIT 1`;
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

export default {
  isEmail, isUsername, normalizePhone, normalizeUsername, directoryKey,
  indexUser, deindexUser, resolveTenantByLogin,
  claimUsername, usernameAvailable, releaseUsername,
};
