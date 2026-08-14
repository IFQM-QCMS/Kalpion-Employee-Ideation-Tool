/**
 * Maintenance mode — the whole platform on hold, deliberately.
 *
 * Switched on from the platform console while developers work on an update.
 * Every ORGANISATION is locked out; IFQM's own staff are not. That asymmetry is
 * the entire point: somebody has to be able to see the platform in order to
 * decide it is safe to turn back on, and that somebody cannot be locked out by
 * the switch they need to reach.
 *
 * ── Where it is enforced, and why in three places ──────────────────────────
 *
 *   1. authService.login   — a tenant user cannot obtain a session. Placed
 *                            AFTER the platform-admin branch, which returns on
 *                            success, so staff are exempt by construction
 *                            rather than by a role check that could drift.
 *   2. otpService          — the same door, by one-time code. Blocking only the
 *                            password path would leave the code path wide open,
 *                            and the login screen offers both.
 *   3. requireAuth         — a session issued BEFORE the switch stops working.
 *                            Without this, "on hold" would mean nothing to
 *                            anybody already signed in, which is most people
 *                            during a working day.
 *
 * ── Why it is cached ───────────────────────────────────────────────────────
 *
 * requireAuth runs on every authenticated request, so reading a settings row
 * there would add a database round trip to the entire API. The flag changes
 * roughly never, so it is held for a few seconds and dropped immediately on
 * write. The cost is that a second instance can be up to CACHE_MS behind after
 * a toggle; the alternative is a permanent tax on every request to make a
 * once-a-month change land a few seconds sooner.
 */
import { masterDb } from '../database/master.js';
import { ApiError, badRequest } from '../utils/respond.js';
import logger from '../utils/logger.js';

/** Shown to tenants when the operator has not written their own wording. */
export const DEFAULT_MESSAGE =
  'IFQM is temporarily unavailable while we carry out scheduled maintenance. '
  + 'Please check with your platform administrator.';

const CACHE_MS = 5000;
let cache = null;
let cachedAt = 0;

/** Drop the cache so the next read hits the database. Called on every write. */
export function invalidate() {
  cache = null;
  cachedAt = 0;
}

/**
 * Is the platform on hold, and what should tenants be told?
 *
 * Fails OPEN. If the registry cannot be read, this returns "not in
 * maintenance" rather than throwing: a database blip must not become a
 * platform-wide lockout that nobody can switch off, because the console used
 * to switch it off reads the same database.
 */
export async function maintenanceStatus() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  try {
    const [rows] = await masterDb().query(
      "SELECT key_name, value FROM platform_settings WHERE key_name LIKE 'maintenance\\_%'"
    );
    const m = Object.fromEntries(rows.map((r) => [r.key_name, r.value ?? '']));
    cache = {
      enabled: m.maintenance_enabled === '1',
      message: (m.maintenance_message || '').trim() || DEFAULT_MESSAGE,
      since: m.maintenance_since || null,
    };
  } catch (e) {
    logger.warn('maintenance: could not read settings', e.message);
    cache = { enabled: false, message: DEFAULT_MESSAGE, since: null };
  }
  cachedAt = Date.now();
  return cache;
}

/**
 * The refusal a tenant sees, as a 503.
 *
 * 503 rather than 403: this is temporary and about the service, not about the
 * caller's permissions, and it is the status a client should be willing to
 * retry. `maintenance: true` lets the frontend recognise it without matching
 * on prose.
 */
export function maintenanceError(message) {
  return new ApiError(503, message || DEFAULT_MESSAGE, { maintenance: true });
}

/**
 * Throw if the platform is on hold. Call on any tenant-facing path.
 *
 * Takes no account of who is asking — every caller of this is already on a
 * branch that platform admins do not reach.
 */
export async function assertNotInMaintenance() {
  const s = await maintenanceStatus();
  if (s.enabled) throw maintenanceError(s.message);
  return s;
}

/** Read for the platform console, including the stored (possibly blank) text. */
export async function getMaintenance() {
  const s = await maintenanceStatus();
  return {
    success: true,
    enabled: s.enabled,
    message: s.message,
    since: s.since,
    default_message: DEFAULT_MESSAGE,
  };
}

/**
 * Turn it on or off.
 *
 * `since` is stamped on the transition into maintenance and cleared on the way
 * out, so the console can say how long this has been going on — a window that
 * has been open for two days is usually somebody who forgot, and that is worth
 * showing rather than making an operator remember.
 */
export async function setMaintenance({ enabled, message, actor } = {}) {
  if (typeof enabled !== 'boolean') {
    throw badRequest('Specify whether maintenance mode should be on or off.');
  }
  const text = String(message ?? '').trim().slice(0, 500);
  const current = await maintenanceStatus();
  const db = masterDb();

  const write = (key, value) => db.execute(
    `INSERT INTO platform_settings (key_name, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [key, String(value)]
  );

  await write('maintenance_enabled', enabled ? '1' : '0');
  await write('maintenance_message', text);
  // Only moved on an actual transition, so re-saving the message while already
  // in maintenance does not reset the clock.
  if (enabled && !current.enabled) {
    await write('maintenance_since', new Date().toISOString().slice(0, 19).replace('T', ' '));
  } else if (!enabled) {
    await write('maintenance_since', '');
  }

  invalidate();
  logger.warn(
    `platform: maintenance mode ${enabled ? 'ENABLED' : 'disabled'} by ${actor?.email || 'unknown'}`
  );
  return getMaintenance();
}

export default {
  maintenanceStatus, assertNotInMaintenance, getMaintenance, setMaintenance,
  maintenanceError, invalidate, DEFAULT_MESSAGE,
};
