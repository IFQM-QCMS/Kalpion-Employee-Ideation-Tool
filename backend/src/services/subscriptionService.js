/**
 * What each organisation is on, until when, and what happens when it runs out.
 *
 * Two ideas are kept apart on purpose:
 *
 *   tenants.status         what a PERSON did to this organisation
 *                          (active / on hold / pending). An operator may put an
 *                          organisation on hold for a reason that has nothing
 *                          to do with money.
 *
 *   tenants.billing_status where the MONEY stands
 *                          (trial / active / past_due / expired / exempt).
 *
 * Collapsing them into one field would mean reinstating a customer who paid
 * also silently undoes a suspension somebody imposed for another reason — and
 * would leave nobody able to answer "why is this organisation switched off?".
 */
import { masterDb } from '../database/master.js';
import { badRequest, notFound } from '../utils/respond.js';
import { decoratePlan, CYCLE_DAYS } from './planService.js';
import { getPlatformSetting } from './platformSettingsService.js';
import logger from '../utils/logger.js';
import { invalidateQuotaCache, usageFor } from '../middleware/tenantQuota.js';

const DAY = 86400000;

/** Whole days from now until `when`. Negative once it has passed. */
export function daysUntil(when) {
  if (!when) return null;
  const t = new Date(when).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / DAY);
}

const addDays = (from, days) => new Date(new Date(from).getTime() + days * DAY);

/** Format for a DATETIME column without dragging in a date library. */
const sqlDate = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');

async function record(tenantId, event, fields = {}, actor = null) {
  // An audit write must never be able to fail the operation it describes.
  try {
    await masterDb().execute(
      `INSERT INTO tenant_billing_events
         (tenant_id, event, from_plan_id, to_plan_id, from_value, to_value, note, actor_id, actor_name)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        tenantId, event,
        fields.fromPlanId ?? null, fields.toPlanId ?? null,
        fields.fromValue ?? null, fields.toValue ?? null,
        fields.note ? String(fields.note).slice(0, 500) : null,
        actor?.id ?? null, actor?.name ? String(actor.name).slice(0, 120) : null,
      ]
    );
  } catch (e) {
    logger.warn('billing event not recorded', e.message);
  }
}

/**
 * Where this organisation stands right now.
 *
 * Derived from the dates on every read rather than trusted from a stored flag,
 * because a stored flag is only as fresh as the last time something ran. An
 * organisation whose trial expired overnight is expired the moment somebody
 * looks, whether or not any sweep has happened yet.
 */
export function billingState(tenant) {
  const status = tenant.billing_status || 'trial';
  if (status === 'exempt') {
    return { state: 'exempt', days_left: null, blocked: false, label: 'Not billed' };
  }

  const endsAt = status === 'trial' ? tenant.trial_ends_at : (tenant.period_end || tenant.trial_ends_at);
  const left = daysUntil(endsAt);

  if (left === null) {
    // No end date on file. Treated as not yet started rather than as expired:
    // locking somebody out because a field was never filled in is the wrong way
    // round.
    return { state: status, days_left: null, blocked: false, ends_at: null, label: 'No end date set' };
  }
  if (left > 0) {
    return {
      state: status,
      days_left: left,
      ends_at: endsAt,
      blocked: false,
      label: status === 'trial' ? `Trial — ${left} day(s) left` : `Paid — ${left} day(s) left`,
    };
  }
  return {
    state: 'expired',
    days_left: left,
    ends_at: endsAt,
    blocked: true,
    label: status === 'trial' ? 'Trial ended' : 'Subscription ended',
  };
}

/** The full picture for one organisation, plan included. */
export async function subscriptionFor(tenantId) {
  const [[tenant]] = await masterDb().execute(
    'SELECT * FROM tenants WHERE id = ? LIMIT 1', [Number(tenantId) || 0]
  );
  if (!tenant) throw notFound('Organisation not found.');

  let plan = null;
  if (tenant.plan_id) {
    const [[row]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [tenant.plan_id]);
    plan = decoratePlan(row);
  }
  const [events] = await masterDb().execute(
    `SELECT e.*, fp.name AS from_plan_name, tp.name AS to_plan_name
       FROM tenant_billing_events e
       LEFT JOIN plans fp ON fp.id = e.from_plan_id
       LEFT JOIN plans tp ON tp.id = e.to_plan_id
      WHERE e.tenant_id = ? ORDER BY e.created_at DESC LIMIT 50`,
    [tenant.id]
  );

  // How much of the plan's request allowance this organisation has used. Shown
  // beside the plan so the platform team sees somebody approaching a limit
  // before the customer does.
  const quota = await usageFor(tenant.id);

  return {
    success: true,
    quota,
    subscription: {
      tenant_id: tenant.id,
      billing_status: tenant.billing_status,
      trial_days: tenant.trial_days,
      trial_ends_at: tenant.trial_ends_at,
      period_start: tenant.period_start,
      period_end: tenant.period_end,
      billing_note: tenant.billing_note,
      ...billingState(tenant),
    },
    plan,
    history: events,
  };
}

/** The trial length a newly approved organisation gets by default. */
export async function defaultTrialDays() {
  const raw = await getPlatformSetting('default_trial_days');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 365 ? n : 14;
}

/**
 * Put an organisation on a plan, with a trial.
 *
 * Called when an application is approved, and again whenever the platform team
 * changes what somebody is on. `trialDays` of 0 means no trial: billing starts
 * at once and the paid period runs from today.
 */
export async function assignPlan(tenantId, { planId, trialDays, note } = {}, actor = null) {
  const id = Number(tenantId) || 0;
  const [[tenant]] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [id]);
  if (!tenant) throw notFound('Organisation not found.');

  const wanted = Number(planId) || 0;
  if (!wanted) throw badRequest('Choose a plan.');
  const [[plan]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [wanted]);
  if (!plan) throw badRequest('That plan no longer exists.');

  const days = trialDays === undefined || trialDays === null || trialDays === ''
    ? await defaultTrialDays()
    : Math.max(0, Math.min(365, parseInt(trialDays, 10) || 0));

  const now = new Date();
  const cycleDays = CYCLE_DAYS[plan.billing_cycle] || 365;

  let billingStatus;
  let trialEnds = null;
  let periodStart = null;
  let periodEnd = null;

  if (days > 0) {
    billingStatus = 'trial';
    trialEnds = addDays(now, days);
    // The paid period starts when the trial ends, so the organisation is never
    // billed for days it was still evaluating.
    periodStart = trialEnds;
    periodEnd = addDays(trialEnds, cycleDays);
  } else {
    billingStatus = 'active';
    periodStart = now;
    periodEnd = addDays(now, cycleDays);
  }

  await masterDb().execute(
    `UPDATE tenants
        SET plan_id = ?, trial_days = ?, trial_ends_at = ?, billing_status = ?,
            period_start = ?, period_end = ?, billing_note = ?
      WHERE id = ?`,
    [
      plan.id, days, trialEnds ? sqlDate(trialEnds) : null, billingStatus,
      sqlDate(periodStart), sqlDate(periodEnd),
      note ? String(note).slice(0, 500) : tenant.billing_note,
      id,
    ]
  );

  /*
   * The request allowance comes from the plan, and limits are cached for a
   * minute. Without this, moving somebody onto a bigger plan leaves them
   * refused for up to a minute afterwards — which is exactly the moment they
   * are watching, because they just paid to be moved.
   */
  invalidateQuotaCache(id);

  await record(id, tenant.plan_id ? 'plan_changed' : 'plan_assigned', {
    fromPlanId: tenant.plan_id, toPlanId: plan.id,
    fromValue: tenant.plan_id ? `${tenant.trial_days} day trial` : null,
    toValue: days ? `${days} day trial` : 'no trial',
    note,
  }, actor);

  return {
    success: true,
    message: days
      ? `${tenant.name} is on ${plan.name} with a ${days}-day trial.`
      : `${tenant.name} is on ${plan.name}, billing from today.`,
  };
}

/**
 * Lengthen or shorten the free evaluation.
 *
 * Measured from today rather than added to whatever is on file, so "give them
 * 30 days" means thirty days from now — which is what the person asking meant.
 * Adding to an already-expired date would grant nothing at all.
 */
export async function setTrialDays(tenantId, days, actor = null, note = '') {
  const id = Number(tenantId) || 0;
  const [[tenant]] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [id]);
  if (!tenant) throw notFound('Organisation not found.');

  const n = Math.max(0, Math.min(365, parseInt(days, 10)));
  if (!Number.isFinite(n)) throw badRequest('Enter a number of days between 0 and 365.');

  const before = daysUntil(tenant.trial_ends_at);
  const trialEnds = n > 0 ? addDays(new Date(), n) : null;

  // Push the paid period out to start when the new trial ends, so extending a
  // trial does not leave the organisation billed for days it did not use.
  let cycleDays = 365;
  if (tenant.plan_id) {
    const [[plan]] = await masterDb().execute(
      'SELECT billing_cycle FROM plans WHERE id = ? LIMIT 1', [tenant.plan_id]
    );
    cycleDays = CYCLE_DAYS[plan?.billing_cycle] || 365;
  }

  let periodStart = tenant.period_start;
  let periodEnd = tenant.period_end;
  if (trialEnds) {
    periodStart = sqlDate(trialEnds);
    periodEnd = sqlDate(addDays(trialEnds, cycleDays));
  }

  await masterDb().execute(
    `UPDATE tenants SET trial_days = ?, trial_ends_at = ?, billing_status = ?,
            period_start = ?, period_end = ?
      WHERE id = ?`,
    [
      n, trialEnds ? sqlDate(trialEnds) : null,
      n > 0 ? 'trial' : (tenant.billing_status === 'trial' ? 'active' : tenant.billing_status),
      periodStart, periodEnd, id,
    ]
  );

  await record(id, (before ?? 0) <= n ? 'trial_extended' : 'trial_shortened', {
    fromValue: before === null ? 'no trial' : `${before} day(s) left`,
    toValue: n ? `${n} day(s) from today` : 'no trial',
    note,
  }, actor);

  return {
    success: true,
    message: n
      ? `Trial set to ${n} day(s) from today.`
      : 'Trial removed — billing starts now.',
  };
}

/**
 * Record that an organisation has paid for the next period.
 *
 * There is no payment gateway here, and this does not pretend to be one. IFQM
 * collects by invoice and bank transfer today; this is the platform team saying
 * "the money arrived", which is the fact the software actually needs.
 */
export async function markPaid(tenantId, { periods = 1, note = '' } = {}, actor = null) {
  const id = Number(tenantId) || 0;
  const [[tenant]] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [id]);
  if (!tenant) throw notFound('Organisation not found.');
  if (!tenant.plan_id) throw badRequest('Put this organisation on a plan first.');

  const [[plan]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [tenant.plan_id]);
  const cycleDays = CYCLE_DAYS[plan?.billing_cycle] || 365;
  const n = Math.max(1, Math.min(12, parseInt(periods, 10) || 1));

  // Extend from whichever is later: the current period end, or today. Extending
  // from a lapsed end date would sell them days that have already gone by.
  const from = tenant.period_end && new Date(tenant.period_end) > new Date()
    ? new Date(tenant.period_end)
    : new Date();
  const until = addDays(from, cycleDays * n);

  await masterDb().execute(
    `UPDATE tenants
        SET billing_status = 'active', period_start = ?, period_end = ?, trial_ends_at = NULL
      WHERE id = ?`,
    [sqlDate(from), sqlDate(until), id]
  );

  // Paying reinstates an organisation that was held for non-payment — but not
  // one an operator suspended for some other reason, which is why the note is
  // checked rather than the status alone.
  if (tenant.status === 'suspended' && /non-payment/i.test(tenant.billing_note || '')) {
    await masterDb().execute("UPDATE tenants SET status = 'active', billing_note = NULL WHERE id = ?", [id]);
    await record(id, 'reinstated', { note: 'Payment received' }, actor);
  }

  await record(id, 'marked_paid', {
    toPlanId: tenant.plan_id,
    toValue: `paid to ${sqlDate(until).slice(0, 10)}`,
    note,
  }, actor);

  return { success: true, message: `Paid up to ${until.toLocaleDateString('en-IN')}.` };
}

/**
 * Find organisations whose time is up and put them on hold.
 *
 * Runs on demand from the platform console and on a timer. Two safeguards:
 * enforcement is off until the platform team switches it on, so nobody is
 * locked out before prices have even been set; and organisations marked exempt
 * are never touched, which is what every organisation that existed before
 * billing arrived is marked as.
 *
 * @returns {{checked:number, lapsed:number, held:number, enforced:boolean}}
 */
export async function sweepLapsed({ dryRun = false } = {}) {
  const enforce = String(await getPlatformSetting('billing_enforce')) === '1';

  const [rows] = await masterDb().query(
    `SELECT id, name, slug, status, billing_status, trial_ends_at, period_end, billing_note
       FROM tenants
      WHERE billing_status IN ('trial','active','past_due')`
  );

  let lapsed = 0;
  let held = 0;
  for (const t of rows) {
    const state = billingState(t);
    if (!state.blocked) continue;
    lapsed += 1;
    if (dryRun) continue;

    await masterDb().execute(
      "UPDATE tenants SET billing_status = 'expired' WHERE id = ?", [t.id]
    );
    await record(t.id, 'lapsed', {
      fromValue: t.billing_status,
      toValue: 'expired',
      note: `Ended ${state.ends_at ? sqlDate(state.ends_at).slice(0, 10) : 'unknown'}`,
    });

    // Suspending is the part that locks people out, so it is the part that is
    // gated. An organisation is only ever held for a reason written down in
    // billing_note, so reinstating on payment can tell "held for money" from
    // "held by a person for something else".
    if (enforce && t.status === 'active') {
      await masterDb().execute(
        "UPDATE tenants SET status = 'suspended', billing_note = ? WHERE id = ?",
        ['On hold for non-payment. Reinstated automatically once payment is recorded.', t.id]
      );
      await record(t.id, 'put_on_hold', { note: 'Automatic: billing period ended' });
      held += 1;
    }
  }

  return { success: true, checked: rows.length, lapsed, held, enforced: enforce, dry_run: !!dryRun };
}

export default {
  billingState, subscriptionFor, assignPlan, setTrialDays, markPaid,
  sweepLapsed, defaultTrialDays, daysUntil,
};
