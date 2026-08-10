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
const CYCLES = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time'];
const GST_MODES = ['included', 'excluded'];
const SUPPORT = ['basic', 'standard', 'priority', 'dedicated'];

/** How many days one billing cycle covers. Used to set the next period end. */
export const CYCLE_DAYS = {
  monthly: 30,
  quarterly: 91,
  half_yearly: 182,
  yearly: 365,
  one_time: 3650,      // effectively perpetual; still has an end date on file
};

const CYCLE_LABEL = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
  one_time: 'One-time',
};

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
    cycle_days: CYCLE_DAYS[row.billing_cycle] || 365,
    // "Unlimited" is NULL, not 0. Zero would be a real limit meaning nobody may
    // join, which is never what an operator means by leaving a box empty.
    max_users_label: row.max_users == null ? 'Unlimited' : String(row.max_users),
    storage_label: row.storage_gb == null ? 'Unlimited' : `${row.storage_gb} GB`,
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
export async function retirePlan(id) {
  const planId = Number(id) || 0;
  const [[plan]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [planId]);
  if (!plan) throw notFound('Plan not found.');

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
  toPaise, toRupees, priceBreakdown, decoratePlan, CYCLE_DAYS,
};
