/**
 * The plan catalogue — what IFQM sells.
 *
 * Money is handled in paise, as whole numbers, everywhere below. A price is an
 * exact quantity and a floating-point number is not: ₹2,500.10 has no exact
 * binary representation, and the error compounds the moment 18% tax is applied
 * and then a proportion of it is refunded. The screens send and receive rupees
 * because that is what a person types; the conversion happens here, once, at
 * the boundary.
 */
import { masterDb } from '../database/master.js';
import { badRequest, notFound } from '../utils/respond.js';

const TIERS = ['trial', 'starter', 'professional', 'enterprise', 'custom'];
const CYCLES = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time', 'lifetime', 'payg'];
const GST_MODES = ['included', 'excluded'];
const SUPPORT = ['basic', 'standard', 'priority', 'dedicated'];

/** How many days one billing cycle covers. Used to set the next period end. */
export const CYCLE_DAYS = {
  monthly: 30,
  quarterly: 91,
  half_yearly: 182,
  yearly: 365,
  one_time: 3650,      // a long fixed term — it does still expire
  /*
   * Lifetime has no length, and null is the honest way to say so. Every caller
   * has to decide what that means rather than receive a number that quietly
   * behaves like an expiry date.
   *
   * one_time above is the cautionary case: 3650 days was described as
   * "effectively perpetual", but the date is real and the nightly sweep reads
   * it, so in ten years it would expire an organisation sold a plan that does
   * not expire — long enough that nobody remembers why, near enough that it
   * arrives.
   */
  lifetime: null,
  /*
   * Pay as you go bills every month, so the period is a month — but the AMOUNT
   * is not the plan's amount. amount_paise on a PAYG plan is the price of one
   * active user for one month, and what is owed is that times however many
   * people signed in. usageBillingService owns that arithmetic; this constant
   * only says how long a period lasts.
   */
  payg: 30,
};

/** Does this plan ever need paying again? */
export const isLifetime = (cycle) => cycle === 'lifetime';

/** Billed on what was used, so the plan's amount is a UNIT price. */
export const isPayg = (cycle) => cycle === 'payg';

const CYCLE_LABEL = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
  one_time: 'One-time',
  lifetime: 'Lifetime',
  payg: 'Pay as you go',
};

/**
 * A sensible monthly request allowance for a plan with this many users.
 *
 * The arithmetic, so nobody has to guess: a signed-in person costs roughly 500
 * requests on a working day — a notification poll every two minutes, a screen
 * refreshing while they read it, and ordinary navigation. Over 22 working days
 * that is about 11,000 a month. Rounded to 15,000 to leave room for a heavy
 * user, a bulk import and a few exports.
 *
 * No user cap means no request cap: a limit derived from "unlimited" is a
 * contradiction, and a trial should never meet one at all.
 */
export function suggestQuota(maxUsers) {
  const n = parseInt(maxUsers, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(100000, n * 15000);
}

/** Rupees in, paise out. Accepts "2,500.50" as typed. */
export function toPaise(rupees) {
  const n = Number(String(rupees ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  // Round rather than truncate: 2500.555 should be 250056 paise, not 250055.
  return Math.round(n * 100);
}

export const toRupees = (paise) => (Number(paise) || 0) / 100;

/**
 * What an organisation is actually charged, tax broken out.
 *
 * With GST included, the stored amount already contains the tax and has to be
 * worked backwards. With GST excluded, the tax is added on top. Both appear on
 * invoices, so both are computed here rather than in a screen.
 */
export function priceBreakdown(plan) {
  const amount = Number(plan.amount_paise) || 0;
  const rate = Number(plan.gst_percent) || 0;
  if (!amount || !rate) {
    return { base_paise: amount, gst_paise: 0, total_paise: amount };
  }
  if (plan.gst_mode === 'included') {
    const base = Math.round(amount / (1 + rate / 100));
    return { base_paise: base, gst_paise: amount - base, total_paise: amount };
  }
  const gst = Math.round(amount * (rate / 100));
  return { base_paise: amount, gst_paise: gst, total_paise: amount + gst };
}

/** Decorate a stored row with the figures every screen needs. */
export function decoratePlan(row) {
  if (!row) return null;
  const b = priceBreakdown(row);
  return {
    ...row,
    is_custom: !!row.is_custom,
    amount_rupees: toRupees(row.amount_paise),
    base_rupees: toRupees(b.base_paise),
    gst_rupees: toRupees(b.gst_paise),
    total_rupees: toRupees(b.total_paise),
    cycle_label: CYCLE_LABEL[row.billing_cycle] || row.billing_cycle,
    // null for a lifetime plan, and left null rather than defaulted to 365 — the
  // screens read this to decide whether to show a renewal date at all.
  cycle_days: isLifetime(row.billing_cycle) ? null : (CYCLE_DAYS[row.billing_cycle] || 365),
  is_lifetime: isLifetime(row.billing_cycle),
  is_payg: isPayg(row.billing_cycle),
  // Reads as a price on every other plan and as a RATE on this one, so the
  // screens can label it without knowing the cycle rules.
  unit_label: isPayg(row.billing_cycle) ? 'per active user / month' : null,
    // "Unlimited" is NULL, not 0. Zero would be a real limit meaning nobody may
    // join, which is never what an operator means by leaving a box empty.
    max_users_label: row.max_users == null ? 'Unlimited' : String(row.max_users),
    storage_label: row.storage_gb == null ? 'Unlimited' : `${row.storage_gb} GB`,
    quota_label: row.api_quota_monthly == null
      ? 'Unlimited'
      : `${Number(row.api_quota_monthly).toLocaleString('en-IN')} / month`,
    // What this plan's allowance would be if it were derived from its user cap.
    // Shown next to the field so an operator can see whether the stored number
    // is sane rather than having to work it out.
    suggested_quota: suggestQuota(row.max_users),
  };
}

export async function listPlans({ includeInactive = true } = {}) {
  const where = includeInactive ? '' : "WHERE p.status = 'active'";
  const [rows] = await masterDb().query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM tenants t WHERE t.plan_id = p.id) AS subscriber_count
       FROM plans p ${where}
      ORDER BY FIELD(p.tier,'trial','starter','professional','enterprise','custom'),
               p.amount_paise, p.name`
  );
  const plans = rows.map(decoratePlan);
  return {
    success: true,
    plans,
    counts: {
      total: plans.length,
      active: plans.filter((p) => p.status === 'active').length,
      inactive: plans.filter((p) => p.status !== 'active').length,
      custom: plans.filter((p) => p.is_custom).length,
    },
  };
}

export async function getPlan(id) {
  const [[row]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [Number(id) || 0]);
  if (!row) throw notFound('Plan not found.');
  return { success: true, plan: decoratePlan(row) };
}

/** Shared validation for create and update. Returns the columns to write. */
function validate(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (has('code') || !partial) {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) {
      throw badRequest('Plan code must be 2-40 characters: letters, numbers, hyphen or underscore.');
    }
    out.code = code;
  }
  if (has('name') || !partial) {
    const name = String(body.name ?? '').trim();
    if (name.length < 2 || name.length > 80) throw badRequest('Enter a plan name (2-80 characters).');
    out.name = name;
  }
  if (has('description') || !partial) {
    out.description = String(body.description ?? '').trim().slice(0, 255) || null;
  }
  if (has('long_description')) out.long_description = String(body.long_description ?? '').trim() || null;

  if (has('tier') || !partial) {
    const tier = String(body.tier ?? 'starter').toLowerCase();
    if (!TIERS.includes(tier)) throw badRequest('Choose a valid plan tier.');
    out.tier = tier;
  }
  if (has('amount_rupees') || has('amount_paise') || !partial) {
    out.amount_paise = has('amount_paise')
      ? Math.max(0, parseInt(body.amount_paise, 10) || 0)
      : toPaise(body.amount_rupees);
  }
  if (has('billing_cycle') || !partial) {
    const cycle = String(body.billing_cycle ?? 'yearly').toLowerCase();
    if (!CYCLES.includes(cycle)) throw badRequest('Choose a valid billing cycle.');
    out.billing_cycle = cycle;
  }
  if (has('gst_percent') || !partial) {
    const gst = Number(body.gst_percent);
    if (!Number.isFinite(gst) || gst < 0 || gst > 100) throw badRequest('GST must be between 0 and 100.');
    out.gst_percent = gst;
  }
  if (has('gst_mode') || !partial) {
    const mode = String(body.gst_mode ?? 'included').toLowerCase();
    if (!GST_MODES.includes(mode)) throw badRequest('Choose whether GST is included or excluded.');
    out.gst_mode = mode;
  }
  if (has('is_custom') || !partial) {
    out.is_custom = body.is_custom === true || body.is_custom === 1 || body.is_custom === '1' ? 1 : 0;
  }

  // A blank limit means unlimited, which is NULL. Written out rather than using
  // `parseInt(v) || null`, because that turns a deliberate 0 into unlimited.
  const limit = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  if (has('max_users') || !partial) out.max_users = limit(body.max_users);
  /*
   * The monthly request allowance.
   *
   * Sized from the user cap: roughly 15,000 requests per permitted user per
   * month, which is about thirty times what ordinary use costs. A blank field
   * means unlimited. Getting this wrong is how a live customer was locked out
   * of their own workspace once already, so `suggestQuota` below exists to stop
   * anybody typing a number off the top of their head.
   */
  if (has('api_quota_monthly') || !partial) out.api_quota_monthly = limit(body.api_quota_monthly);
  if (has('api_quota_total')) out.api_quota_total = limit(body.api_quota_total);
  if (has('max_departments') || !partial) out.max_departments = limit(body.max_departments);
  if (has('max_ideas') || !partial) out.max_ideas = limit(body.max_ideas);
  if (has('storage_gb') || !partial) out.storage_gb = limit(body.storage_gb);

  if (has('support_level') || !partial) {
    const sup = String(body.support_level ?? 'standard').toLowerCase();
    if (!SUPPORT.includes(sup)) throw badRequest('Choose a valid support level.');
    out.support_level = sup;
  }
  if (has('status') || !partial) {
    out.status = String(body.status) === 'inactive' ? 'inactive' : 'active';
  }
  return out;
}

export async function createPlan(body) {
  const data = validate(body);
  const [[clash]] = await masterDb().execute('SELECT id FROM plans WHERE code = ? LIMIT 1', [data.code]);
  if (clash) throw badRequest(`A plan with the code "${data.code}" already exists.`);

  const cols = Object.keys(data);
  const [res] = await masterDb().execute(
    `INSERT INTO plans (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => data[c])
  );
  return { success: true, plan_id: res.insertId, message: `Plan "${data.name}" created.` };
}

export async function updatePlan(id, body) {
  const planId = Number(id) || 0;
  const [[existing]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [planId]);
  if (!existing) throw notFound('Plan not found.');

  const data = validate(body, { partial: true });
  if (data.code && data.code !== existing.code) {
    const [[clash]] = await masterDb().execute(
      'SELECT id FROM plans WHERE code = ? AND id <> ? LIMIT 1', [data.code, planId]
    );
    if (clash) throw badRequest(`A plan with the code "${data.code}" already exists.`);
  }
  const cols = Object.keys(data);
  if (!cols.length) throw badRequest('Nothing to update.');

  await masterDb().execute(
    `UPDATE plans SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...cols.map((c) => data[c]), planId]
  );
  return { success: true, message: 'Plan updated.' };
}

/**
 * Retiring a plan does not delete it.
 *
 * Organisations point at plans, and their history refers to them. Deleting one
 * an organisation is on would leave that organisation pointing at nothing, and
 * would erase what they were charged and why. Retired plans stop appearing on
 * the list an approver picks from; everything else is untouched.
 */
/**
 * The plan a brand-new organisation starts on.
 *
 * Every approved organisation is put on this automatically, so that none of
 * them exists unpriced: an organisation with no plan has no trial end date, so
 * it never lapses, is never billed, and quietly stays free forever because
 * nobody remembered to go back to it.
 *
 * Found by code first and by tier second, so renaming the plan in the console
 * does not break the lookup.
 */
export async function defaultTrialPlan() {
  const [[byCode]] = await masterDb().execute(
    "SELECT * FROM plans WHERE code = 'TRIAL' LIMIT 1"
  );
  if (byCode) return byCode;
  const [[byTier]] = await masterDb().execute(
    "SELECT * FROM plans WHERE tier = 'trial' AND status = 'active' ORDER BY id LIMIT 1"
  );
  return byTier || null;
}

/** Is this the plan every new organisation depends on? */
const isDefaultTrial = (plan) => String(plan?.code || '').toUpperCase() === 'TRIAL';

export async function retirePlan(id) {
  const planId = Number(id) || 0;
  const [[plan]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [planId]);
  if (!plan) throw notFound('Plan not found.');

  /*
   * The trial plan cannot be deleted, only edited.
   *
   * Every newly approved organisation is put on it, so removing it would break
   * approval itself - and it would break it later, quietly, for whoever next
   * approves an application rather than for the person who deleted the plan.
   * Its price, limits and trial length are all editable; only its existence is
   * fixed.
   */
  if (isDefaultTrial(plan)) {
    throw badRequest(
      'The Trial plan cannot be deleted - every newly approved organisation starts on it. '
      + 'You can edit its price, limits and description.'
    );
  }

  const [[used]] = await masterDb().execute(
    'SELECT COUNT(*) AS n FROM tenants WHERE plan_id = ?', [planId]
  );
  await masterDb().execute("UPDATE plans SET status = 'inactive' WHERE id = ?", [planId]);
  return {
    success: true,
    message: Number(used.n)
      ? `Plan retired. ${used.n} organisation(s) stay on it until you move them.`
      : 'Plan retired.',
  };
}

export default {
  listPlans, getPlan, createPlan, updatePlan, retirePlan,
  toPaise, toRupees, priceBreakdown, decoratePlan, suggestQuota, CYCLE_DAYS, isLifetime, isPayg,
};
