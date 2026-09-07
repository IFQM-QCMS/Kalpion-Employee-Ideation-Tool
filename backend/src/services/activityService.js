/** Login activity - MOM 29 Jul 2026 §12.12. */
import { masterDb } from '../database/master.js';
import logger from '../utils/logger.js';

/** Keep the table from growing without bound on a busy platform. */
const RETENTION_DAYS = 180;

/** What kind of network an address belongs to. */
function classifyNetwork(ip) {
  const a = String(ip || '').trim().replace(/^::ffff:/, '');
  if (!a) return null;
  if (a === '::1' || a.startsWith('127.')) return 'local';
  if (a.startsWith('10.') || a.startsWith('192.168.') || a.startsWith('169.254.')
      || /^172\.(1[6-9]|2\d|3[01])\./.test(a)
      || a.toLowerCase().startsWith('fc') || a.toLowerCase().startsWith('fd')) {
    return 'private';
  }
  return 'public';
}

/** A readable, approximate location. */
// The country a time zone belongs to, for the zones this platform actually sees.
const ZONE_COUNTRY = {
  'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India',
  'Asia/Colombo': 'Sri Lanka', 'Asia/Kathmandu': 'Nepal', 'Asia/Dhaka': 'Bangladesh',
  'Asia/Karachi': 'Pakistan', 'Asia/Dubai': 'UAE', 'Asia/Singapore': 'Singapore',
  'Europe/London': 'United Kingdom', 'America/New_York': 'United States',
  'America/Los_Angeles': 'United States', 'America/Chicago': 'United States',
  'Australia/Sydney': 'Australia', 'Asia/Tokyo': 'Japan', 'Asia/Shanghai': 'China',
};

/** A readable place from the browser's time zone. */
function describeLocation(timeZone) {
  const tz = String(timeZone || '').trim().slice(0, 60);
  if (!tz || !/^[A-Za-z_+\-0-9/]+$/.test(tz)) return null;
  const canonical = tz === 'Asia/Calcutta' ? 'Asia/Kolkata' : tz;
  const city = canonical.split('/').pop().replace(/_/g, ' ');
  if (!city) return null;
  const country = ZONE_COUNTRY[tz] || ZONE_COUNTRY[canonical];
  return country ? `${city}, ${country}` : city;
}

/** Record one sign-in attempt. */
export function recordLogin({
  actorType, actorId = null, actorName = null, actorEmail = null,
  tenantId = null, tenantSlug = null, outcome = 'success', ip = null, userAgent = null,
  timeZone = null,
} = {}) {
  // Fire-and-forget: the caller is on a login path and must not wait for this.
  masterDb()
    .execute(
      `INSERT INTO platform_login_activity
         (actor_type, actor_id, actor_name, actor_email, tenant_id, tenant_slug,
          outcome, ip, user_agent, location, network)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        actorType, actorId == null ? null : String(actorId).slice(0, 40),
        actorName ? String(actorName).slice(0, 120) : null,
        actorEmail ? String(actorEmail).slice(0, 255) : null,
        tenantId ?? null, tenantSlug ? String(tenantSlug).slice(0, 50) : null,
        outcome, ip ? String(ip).slice(0, 45) : null,
        userAgent ? String(userAgent).slice(0, 255) : null,
        describeLocation(timeZone), classifyNetwork(ip),
      ]
    )
    .catch((e) => logger.warn('login activity write failed', e.message));
}

/** Recent sign-in activity for the platform console. */
export async function recentActivity({
  limit = 50, outcome = '', tenantId = null, actorType = 'platform_admin',
} = {}) {
  const where = [];
  const params = [];
  if (actorType === 'platform_admin' || actorType === 'tenant_user') {
    where.push('actor_type = ?');
    params.push(actorType);
  }
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
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          ${actorType === 'all' ? '' : 'AND actor_type = ?'}`,
      actorType === 'all' ? [] : [actorType]
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
    // The table does not exist until migration 010 runs. A missing audit feed must not take
    // the console down with it.
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
