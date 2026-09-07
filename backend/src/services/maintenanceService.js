/** Maintenance mode - the whole platform on hold, deliberately. */
import { masterDb } from '../database/master.js';
import { ApiError, badRequest } from '../utils/respond.js';
import logger from '../utils/logger.js';

/** Shown to tenants when the operator has not written their own wording. */
export const DEFAULT_MESSAGE =
  'We are carrying out scheduled maintenance and the platform is temporarily '
  + 'unavailable. Your data is safe and no action is required from you. '
  + 'Please try again shortly, or contact your administrator if you need help.';

const CACHE_MS = 5000;
let cache = null;
let cachedAt = 0;

/** Drop the cache so the next read hits the database. Called on every write. */
export function invalidate() {
  cache = null;
  cachedAt = 0;
}

/** Is the platform on hold, and what should tenants be told? */
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

/** The refusal a tenant sees, as a 503. */
export function maintenanceError(message) {
  return new ApiError(503, message || DEFAULT_MESSAGE, { maintenance: true });
}

/** Throw if the platform is on hold. */
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

/** Turn it on or off. */
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
  // Only moved on an actual transition, so re-saving the message while already in
  // maintenance does not reset the clock.
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
