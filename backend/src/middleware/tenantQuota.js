/**
 * Per-tenant API quota — MOM 29 Jul 2026 §8.3, §8.5, §8.6.
 *
 * The existing rate limiters are per-IP: they stop one machine hammering the
 * API, but say nothing about how much of the platform a single organisation
 * consumes, and an office behind one NAT gateway looks like one client while a
 * botnet looks like thousands. This counts by TENANT, which is the unit the
 * commercial limits are actually expressed in.
 *
 * Two limits, both from the MOM:
 *   • 10,000 requests total (lifetime)
 *   • 2,000 requests per calendar month
 *
 * Counting is deliberately asynchronous and slightly lossy. The alternative —
 * an awaited UPDATE on every request — puts a database round trip in front of
 * every single API call to protect against something that happens once a month.
 * Counts are buffered in memory and flushed periodically; a crash loses at most
 * one flush window, which for a quota measured in thousands is noise.
 *
 * Enforcement fails OPEN. If the quota tables cannot be read, requests are
 * served: a metering outage must not become a customer outage.
 */
import { masterDb } from '../database/master.js';
import { ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

const FLUSH_INTERVAL_MS = 30_000;
/** How long a tenant's limits are trusted before being re-read. */
const LIMIT_TTL_MS = 60_000;

/** tenantId → pending (unflushed) request count. */
const pending = new Map();
/** tenantId → { total, monthly, used_total, used_month, at } */
const cache = new Map();

let flushTimer = null;

const currentPeriod = () => new Date().toISOString().slice(0, 7); // YYYY-MM

/** Write buffered counts to the registry. Never throws. */
async function flush() {
  if (!pending.size) return;
  const batch = [...pending.entries()];
  pending.clear();

  const period = currentPeriod();
  for (const [tenantId, count] of batch) {
    if (!tenantId || count <= 0) continue;
    try {
      // Two rows per tenant: the lifetime counter and the current month.
      await masterDb().execute(
        `INSERT INTO tenant_api_usage (tenant_id, period, request_count)
              VALUES (?, 'total', ?), (?, ?, ?)
         ON DUPLICATE KEY UPDATE request_count = request_count + VALUES(request_count)`,
        [tenantId, count, tenantId, period, count]
      );
      // The cached entry now under-reports by exactly `count`, and the in-flight
      // counter that used to compensate has just been zeroed. Without this the
      // cache reports the usage it saw a minute ago for a further minute, and a
      // tenant sails past its limit for as long as the TTL lasts.
      cache.delete(tenantId);
    } catch (e) {
      logger.warn(`quota flush failed for tenant ${tenantId}`, e.message);
    }
  }
}

function ensureTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flush().catch(() => {}); }, FLUSH_INTERVAL_MS);
  // Never hold the process open for a metering timer.
  flushTimer.unref?.();
}

/** Flush and stop — for graceful shutdown and test teardown. */
/** Forget cached limits for a tenant (or all). Call after changing a quota. */
export function invalidateQuotaCache(tenantId = null) {
  if (tenantId == null) cache.clear();
  else cache.delete(Number(tenantId));
}

export async function stopQuotaMetering() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flush();
}

/**
 * Read a tenant's limits and current usage, cached briefly.
 * A tenant-specific limit wins; otherwise the platform default applies, so
 * raising the default lifts every organisation that has no bespoke number.
 */
async function limitsFor(tenantId) {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < LIMIT_TTL_MS) return hit;

  const db = masterDb();
  const [[t] = []] = await db.execute(
    'SELECT api_quota_total, api_quota_monthly FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  const [defaults] = await db.query(
    "SELECT key_name, value FROM platform_settings WHERE key_name IN ('api_quota_total','api_quota_monthly')"
  );
  const d = Object.fromEntries(defaults.map((r) => [r.key_name, parseInt(r.value, 10)]));

  const [usage] = await db.execute(
    'SELECT period, request_count FROM tenant_api_usage WHERE tenant_id = ? AND period IN (?, ?)',
    [tenantId, 'total', currentPeriod()]
  );
  const used = Object.fromEntries(usage.map((r) => [r.period, Number(r.request_count) || 0]));

  const entry = {
    total: t?.api_quota_total ?? d.api_quota_total ?? 10000,
    monthly: t?.api_quota_monthly ?? d.api_quota_monthly ?? 2000,
    used_total: used.total || 0,
    used_month: used[currentPeriod()] || 0,
    at: Date.now(),
  };
  cache.set(tenantId, entry);
  return entry;
}

/**
 * Meter one authenticated request against its organisation's quota.
 *
 * Called from the auth middleware immediately after the tenant is resolved —
 * the earliest point at which "which organisation is this?" has an answer.
 * Throws ApiError(429) when a limit is exceeded; resolves silently otherwise.
 *
 * Read-only requests count too: the MOM's number is about consumption, not
 * writes. Health and readiness probes are unauthenticated and never reach here.
 */
export async function meterTenantRequest(req) {
  const tenantId = Number(req.tenant?.id) || 0;
  if (!tenantId) return;                 // built-in fallback tenant has no registry row

  ensureTimer();
  pending.set(tenantId, (pending.get(tenantId) || 0) + 1);

  let lim;
  try {
    lim = await limitsFor(tenantId);
  } catch (e) {
    // Fail open. A metering outage must not become a customer outage.
    logger.warn('quota check skipped', e.message);
    return;
  }

  // Requests since the last flush count toward the ceiling too, or a burst
  // inside one flush window sails straight past the limit.
  const inFlight = pending.get(tenantId) || 0;
  const usedMonth = lim.used_month + inFlight;
  const usedTotal = lim.used_total + inFlight;

  if (usedMonth > lim.monthly) {
    throw new ApiError(429,
      `This organisation has reached its monthly limit of ${lim.monthly} API requests. `
      + 'It resets at the start of next month. Contact IFQM if you need a higher limit.',
      { quota: { scope: 'monthly', limit: lim.monthly, used: usedMonth } });
  }
  if (usedTotal > lim.total) {
    throw new ApiError(429,
      `This organisation has reached its total limit of ${lim.total} API requests. `
      + 'Contact IFQM to raise it.',
      { quota: { scope: 'total', limit: lim.total, used: usedTotal } });
  }
}

/** Current usage for one tenant — for the platform console. */
export async function usageFor(tenantId) {
  try {
    const lim = await limitsFor(Number(tenantId));
    return {
      total: lim.total, monthly: lim.monthly,
      used_total: lim.used_total, used_month: lim.used_month,
    };
  } catch {
    return null;
  }
}

export default { meterTenantRequest, usageFor, stopQuotaMetering, invalidateQuotaCache };
