/** Per-tenant API quota - MOM 29 Jul 2026 §8.3, §8.5, §8.6. */
import { masterDb } from '../database/master.js';
import { ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

const FLUSH_INTERVAL_MS = 30_000;
/** How long a tenant's limits are trusted before being re-read. */
const LIMIT_TTL_MS = 60_000;

/** tenantId pending (unflushed) request count. */
const pending = new Map();
/** tenantId { total, monthly, used_total, used_month, at } */
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
      // The cached entry now under-reports by exactly `count`, and the in-flight counter that
      // used to compensate has just been zeroed.
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

/** Flush and stop - for graceful shutdown and test teardown. */
/** Forget cached limits for a tenant (or all). Call after changing a quota. */
export function invalidateQuotaCache(tenantId = null) {
  if (tenantId == null) cache.clear();
  else cache.delete(Number(tenantId));
}

export async function stopQuotaMetering() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flush();
}

/** Read a tenant's limits and current usage, cached briefly. */
async function limitsFor(tenantId) {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < LIMIT_TTL_MS) return hit;

  const db = masterDb();
  // One join rather than two round trips: the plan's allowance is needed on every one of
  // these lookups, and this runs once a minute per organisation.
  const [[t] = []] = await db.execute(
    `SELECT t.api_quota_total, t.api_quota_monthly,
            p.api_quota_total   AS plan_total,
            p.api_quota_monthly AS plan_monthly,
            p.name              AS plan_name
       FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
      WHERE t.id = ? LIMIT 1`,
    [tenantId]
  );
  const [defaults] = await db.query(
    `SELECT key_name, value FROM platform_settings
      WHERE key_name IN ('api_quota_total','api_quota_monthly',
                         'quota_enforce','quota_grace_percent','quota_warn_percent')`
  );
  const d = Object.fromEntries(defaults.map((r) => [r.key_name, r.value]));

  const [usage] = await db.execute(
    'SELECT period, request_count FROM tenant_api_usage WHERE tenant_id = ? AND period IN (?, ?)',
    [tenantId, 'total', currentPeriod()]
  );
  const used = Object.fromEntries(usage.map((r) => [r.period, Number(r.request_count) || 0]));

  // NULL means no limit, and that is now the default at every level.
  const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const pct = (v, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const entry = {
    // Organisation override, then plan, then platform default, then unlimited.
    total: num(t?.api_quota_total) ?? num(t?.plan_total) ?? num(d.api_quota_total) ?? null,
    monthly: num(t?.api_quota_monthly) ?? num(t?.plan_monthly) ?? num(d.api_quota_monthly) ?? null,
    // Which of those answered, so the console can explain the number rather than just showing
    // it.
    source: num(t?.api_quota_monthly) ? 'organisation'
      : num(t?.plan_monthly) ? `plan (${t.plan_name})`
        : num(d.api_quota_monthly) ? 'platform default' : 'none',
    enforce: String(d.quota_enforce ?? '1') === '1',
    gracePercent: pct(d.quota_grace_percent, 20),
    warnPercent: pct(d.quota_warn_percent, 80),
    used_total: used.total || 0,
    used_month: used[currentPeriod()] || 0,
    at: Date.now(),
  };
  cache.set(tenantId, entry);
  return entry;
}

/** Meter one authenticated request against its organisation's quota. */
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

  // Requests since the last flush count toward the ceiling too, or a burst inside one flush
  // window sails straight past the limit.
  const inFlight = pending.get(tenantId) || 0;
  const usedMonth = lim.used_month + inFlight;
  const usedTotal = lim.used_total + inFlight;

  // No allowance anywhere: count for reporting and refuse nothing.
  if (lim.monthly == null && lim.total == null) return;

  // Tell the caller where they stand on every request, whether or not anything is being
  // refused.
  if (lim.monthly != null) {
    const usedPercent = Math.round((usedMonth / lim.monthly) * 100);
    req.quota = {
      limit: lim.monthly, used: usedMonth, percent: usedPercent,
      source: lim.source, warn: usedPercent >= lim.warnPercent,
    };
  }

  if (!lim.enforce) return;

  // Never refuse these, whatever the count says.
  const path = (req.originalUrl || '').split('?')[0];
  const alwaysAllowed = ['/api/auth', '/api/support/tickets', '/api/notifications',
    '/api/branding', '/api/settings', '/api/health', '/api/ready'];
  if (alwaysAllowed.some((a) => path === a || path.startsWith(a + '/'))) return;

  // The grace band. The allowance is an estimate of what normal use costs, not a measurement
  // of it, so being slightly over is more likely to mean a busy month than an abusive one.
  const ceiling = (n) => Math.ceil(n * (1 + lim.gracePercent / 100));

  if (lim.monthly != null && usedMonth > ceiling(lim.monthly)) {
    throw new ApiError(429,
      `This organisation has used ${usedMonth.toLocaleString('en-IN')} of its `
      + `${lim.monthly.toLocaleString('en-IN')} requests for this month. `
      + 'It resets at the start of next month. Signing in and Support still work - '
      + 'contact IFQM to move to a larger plan.',
      { quota: { scope: 'monthly', limit: lim.monthly, used: usedMonth, source: lim.source } });
  }
  if (lim.total != null && usedTotal > ceiling(lim.total)) {
    throw new ApiError(429,
      `This organisation has used ${usedTotal.toLocaleString('en-IN')} of its `
      + `${lim.total.toLocaleString('en-IN')} total requests. Contact IFQM to raise it.`,
      { quota: { scope: 'total', limit: lim.total, used: usedTotal, source: lim.source } });
  }
}

/** Current usage for one tenant - for the platform console. */
export async function usageFor(tenantId) {
  try {
    const lim = await limitsFor(Number(tenantId));
    return {
      total: lim.total, monthly: lim.monthly,
      used_total: lim.used_total, used_month: lim.used_month,
      // Where the number came from, so the console can explain it rather than leaving somebody
      // to guess whether it is the plan or an override.
      source: lim.source,
      percent: lim.monthly ? Math.round((lim.used_month / lim.monthly) * 100) : null,
      enforced: lim.enforce,
      grace_percent: lim.gracePercent,
    };
  } catch {
    return null;
  }
}

export default { meterTenantRequest, usageFor, stopQuotaMetering, invalidateQuotaCache };
