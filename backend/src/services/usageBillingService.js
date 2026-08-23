/**
 * Pay-as-you-go metering — an organisation is billed for the people who
 * actually signed in during the month.
 *
 * ── What counts as an active user ───────────────────────────────────────────
 *
 * Somebody who signed in successfully at least once in the calendar month. Not
 * somebody with an account: an organisation that provisions four hundred
 * employees and has thirty using the tool is billed for thirty, or the plan is
 * a seat licence wearing a different name.
 *
 * Counted from platform_login_activity, which is the only place that records a
 * sign-in per person per tenant. DISTINCT actor_id, so a person who signs in
 * every morning is one active user, not twenty-two.
 *
 * ── Why a month is counted once and then kept ──────────────────────────────
 *
 * The log this is derived from is purged after the retention window (migration
 * 029). Recomputing an old month would silently return a smaller number once
 * its sign-in rows had gone — and an invoice that quietly shrinks when it is
 * re-opened is worse than one that is simply wrong, because nobody can tell
 * afterwards which figure was actually charged.
 *
 * So closeMonth() writes the count and the unit price into tenant_active_users
 * and never revises them. That table outlives the log behind it, which is what
 * a billing record has to do.
 *
 * ── Why the unit price is stored with the count ────────────────────────────
 *
 * Raising the price of a PAYG plan must not rewrite what March was charged.
 * The rate in force at the moment the month closed is captured beside the
 * number of people it applied to, so an old invoice can still be explained
 * from its own row rather than from whatever the plan says today.
 */
import { masterDb } from '../database/master.js';
import { badRequest, notFound } from '../utils/respond.js';
import logger from '../utils/logger.js';

/** 'YYYY-MM' for a date, in the DATABASE's calendar — see closeMonth. */
export const periodOf = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export const isPayg = (cycle) => cycle === 'payg';

/**
 * How many distinct people signed in for this organisation in this month.
 *
 * Reads the live log, so it is only meaningful for months still inside the
 * retention window. Closed months should be read from tenant_active_users
 * instead — that is the whole reason the snapshot exists.
 */
export async function activeUsersIn(tenantId, period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    throw badRequest('Period must be in YYYY-MM form.');
  }
  const [[row]] = await masterDb().execute(
    `SELECT COUNT(DISTINCT actor_id) AS n
       FROM platform_login_activity
      WHERE tenant_id = ?
        AND actor_type = 'tenant_user'
        AND outcome = 'success'
        AND actor_id IS NOT NULL
        AND DATE_FORMAT(created_at, '%Y-%m') = ?`,
    [Number(tenantId) || 0, period]
  );
  return Number(row.n) || 0;
}

/**
 * Close a month for one organisation: count it, price it, and keep both.
 *
 * Idempotent by design. Re-running for a month already closed returns the
 * STORED figures rather than recounting — that is the guarantee the whole file
 * exists for, and a "just refresh it" that recomputed would quietly undo it.
 * Pass `recount: true` to deliberately revise a month that was closed in error.
 */
export async function closeMonth(tenantId, period, { recount = false } = {}) {
  const id = Number(tenantId) || 0;
  const master = masterDb();

  const [[tenant]] = await master.execute(
    `SELECT t.id, t.name, p.billing_cycle, p.amount_paise, p.name AS plan_name
       FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
      WHERE t.id = ? LIMIT 1`,
    [id]
  );
  if (!tenant) throw notFound('Organisation not found.');
  if (!isPayg(tenant.billing_cycle)) {
    throw badRequest(`${tenant.name} is not on a pay-as-you-go plan.`);
  }

  if (!recount) {
    const [[existing] = []] = await master.execute(
      'SELECT active_users, unit_paise, computed_at FROM tenant_active_users WHERE tenant_id = ? AND period = ? LIMIT 1',
      [id, period]
    );
    if (existing) {
      return {
        success: true, tenant_id: id, period,
        active_users: Number(existing.active_users),
        unit_paise: Number(existing.unit_paise),
        amount_paise: Number(existing.active_users) * Number(existing.unit_paise),
        closed_at: existing.computed_at,
        recomputed: false,
      };
    }
  }

  const activeUsers = await activeUsersIn(id, period);
  const unitPaise = Number(tenant.amount_paise) || 0;

  await master.execute(
    `INSERT INTO tenant_active_users (tenant_id, period, active_users, unit_paise)
          VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE active_users = VALUES(active_users),
                             unit_paise   = VALUES(unit_paise),
                             computed_at  = NOW()`,
    [id, period, activeUsers, unitPaise]
  );

  logger.info(
    `payg: ${tenant.name} ${period} — ${activeUsers} active user(s) at ${unitPaise} paise each`
  );
  return {
    success: true, tenant_id: id, period,
    active_users: activeUsers,
    unit_paise: unitPaise,
    amount_paise: activeUsers * unitPaise,
    recomputed: true,
  };
}

/**
 * What an organisation has been metered, month by month, newest first.
 *
 * The current month is included from the LIVE log and marked `open`, because
 * somebody asking "what am I running up this month?" wants today's number, not
 * silence until the month ends.
 */
export async function usageHistory(tenantId, { months = 12 } = {}) {
  const id = Number(tenantId) || 0;
  const master = masterDb();
  const limit = Math.max(1, Math.min(60, Number(months) || 12));

  const [rows] = await master.execute(
    `SELECT period, active_users, unit_paise, computed_at
       FROM tenant_active_users WHERE tenant_id = ?
      ORDER BY period DESC LIMIT ${limit}`,
    [id]
  );
  const closed = rows.map((r) => ({
    period: r.period,
    active_users: Number(r.active_users),
    unit_paise: Number(r.unit_paise),
    amount_paise: Number(r.active_users) * Number(r.unit_paise),
    closed_at: r.computed_at,
    open: false,
  }));

  const current = periodOf();
  if (!closed.some((r) => r.period === current)) {
    const [[tenant] = []] = await master.execute(
      `SELECT p.billing_cycle, p.amount_paise FROM tenants t
         LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = ? LIMIT 1`,
      [id]
    );
    if (tenant && isPayg(tenant.billing_cycle)) {
      const n = await activeUsersIn(id, current);
      const unit = Number(tenant.amount_paise) || 0;
      closed.unshift({
        period: current,
        active_users: n,
        unit_paise: unit,
        amount_paise: n * unit,
        closed_at: null,
        // Still moving. Anything reading this must not treat it as an invoice.
        open: true,
      });
    }
  }
  return { success: true, usage: closed };
}

export default { activeUsersIn, closeMonth, usageHistory, periodOf, isPayg };
