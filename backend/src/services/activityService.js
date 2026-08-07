/**
 * Login activity — MOM 29 Jul 2026 §12.12.
 *
 * `login_attempts` already existed but is lockout STATE: it is cleared on every
 * successful sign-in, so it can never answer "who signed in, and when". This is
 * the append-only record that can, and it is what the platform console's
 * notifications read.
 *
 * Every write here is best-effort. An audit trail that can fail a login is worse
 * than no audit trail: it turns a logging outage into an outage.
 */
import { masterDb } from '../database/master.js';
import logger from '../utils/logger.js';

/** Keep the table from growing without bound on a busy platform. */
const RETENTION_DAYS = 180;

/**
 * Record one sign-in attempt.
 * @param {object} entry
 * @param {'platform_admin'|'tenant_user'} entry.actorType
 */
export function recordLogin({
  actorType, actorId = null, actorName = null, actorEmail = null,
  tenantId = null, tenantSlug = null, outcome = 'success', ip = null, userAgent = null,
} = {}) {
  // Fire-and-forget: the caller is on a login path and must not wait for this.
  masterDb()
    .execute(
      `INSERT INTO platform_login_activity
         (actor_type, actor_id, actor_name, actor_email, tenant_id, tenant_slug, outcome, ip, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        actorType, actorId == null ? null : String(actorId).slice(0, 40),
        actorName ? String(actorName).slice(0, 120) : null,
        actorEmail ? String(actorEmail).slice(0, 255) : null,
        tenantId ?? null, tenantSlug ? String(tenantSlug).slice(0, 50) : null,
        outcome, ip ? String(ip).slice(0, 45) : null,
        userAgent ? String(userAgent).slice(0, 255) : null,
      ]
    )
    .catch((e) => logger.warn('login activity write failed', e.message));
}

/**
 * Recent sign-in activity for the platform console.
 * @param {{ limit?: number, outcome?: string, tenantId?: number }} opts
 */
export async function recentActivity({ limit = 50, outcome = '', tenantId = null } = {}) {
  const where = [];
  const params = [];
  if (['success', 'failure', 'lockout'].includes(outcome)) {
    where.push('outcome = ?');
    params.push(outcome);
  }
  if (tenantId) { where.push('tenant_id = ?'); params.push(Number(tenantId)); }

  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  try {
    const [rows] = await masterDb().query(
      `SELECT * FROM platform_login_activity
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC LIMIT ${n}`,
      params
    );
    const [[counts]] = await masterDb().query(
      `SELECT SUM(outcome='success') AS successes,
              SUM(outcome='failure') AS failures,
              SUM(outcome='lockout') AS lockouts
         FROM platform_login_activity
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );
    return {
      success: true,
      activity: rows,
      last_24h: {
        successes: Number(counts?.successes || 0),
        failures: Number(counts?.failures || 0),
        lockouts: Number(counts?.lockouts || 0),
      },
    };
  } catch (e) {
    // The table does not exist until migration 010 runs. A missing audit feed
    // must not take the console down with it.
    logger.warn('login activity unavailable', e.message);
    return { success: true, activity: [], last_24h: { successes: 0, failures: 0, lockouts: 0 } };
  }
}

/** Drop rows past the retention window. Safe to call on any schedule. */
export async function pruneActivity() {
  try {
    const [res] = await masterDb().execute(
      'DELETE FROM platform_login_activity WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
      [RETENTION_DAYS]
    );
    return res.affectedRows;
  } catch (e) {
    logger.warn('login activity prune failed', e.message);
    return 0;
  }
}

export default { recordLogin, recentActivity, pruneActivity };
