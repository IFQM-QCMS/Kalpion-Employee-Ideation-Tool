/**
 * Billing endpoints — HTTP only.
 *
 * Every one of these is platform-staff territory except `mySubscription`, which
 * is how an organisation's own admin sees where their account stands and how
 * long is left.
 */
import asyncHandler from '../utils/asyncHandler.js';
import { respond } from '../utils/respond.js';
import * as planService from '../services/planService.js';
import * as subscriptionService from '../services/subscriptionService.js';

// ── Plan catalogue ──────────────────────────────────────────────────
export const listPlans = asyncHandler(async (req, res) =>
  respond(res, await planService.listPlans({
    includeInactive: String(req.query.include_inactive ?? '1') === '1',
  }))
);

export const getPlan = asyncHandler(async (req, res) =>
  respond(res, await planService.getPlan(req.params.id))
);

export const createPlan = asyncHandler(async (req, res) =>
  respond(res, await planService.createPlan(req.body || {}))
);

export const updatePlan = asyncHandler(async (req, res) =>
  respond(res, await planService.updatePlan(req.params.id, req.body || {}))
);

export const retirePlan = asyncHandler(async (req, res) =>
  respond(res, await planService.retirePlan(req.params.id))
);

// ── One organisation's subscription ─────────────────────────────────
export const subscription = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.subscriptionFor(req.params.id))
);

export const assignPlan = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.assignPlan(req.params.id, {
    planId: req.body?.plan_id,
    trialDays: req.body?.trial_days,
    note: req.body?.note,
  }, req.user))
);

export const setTrial = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.setTrialDays(
    req.params.id, req.body?.trial_days, req.user, req.body?.note || ''
  ))
);

export const markPaid = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.markPaid(req.params.id, {
    periods: req.body?.periods,
    note: req.body?.note || '',
  }, req.user))
);

/** Find everyone whose time is up. `?dry_run=1` reports without changing. */
export const sweep = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.sweepLapsed({
    dryRun: String(req.query.dry_run ?? '') === '1',
  }))
);

// ── The organisation's own view ─────────────────────────────────────
/**
 * What the customer sees about their own account.
 *
 * Deliberately thinner than the platform view: the plan, where the dates stand
 * and how long is left. No billing history, no internal notes, and no figures
 * about other organisations.
 */
export const mySubscription = asyncHandler(async (req, res) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) return respond(res, { success: true, subscription: null, plan: null });

  const full = await subscriptionService.subscriptionFor(tenantId);
  const { history, ...rest } = full;
  return respond(res, {
    ...rest,
    subscription: rest.subscription ? {
      ...rest.subscription,
      billing_note: undefined,   // an internal note, not something to show a customer
    } : null,
  });
});

export default {
  listPlans, getPlan, createPlan, updatePlan, retirePlan,
  subscription, assignPlan, setTrial, markPaid, sweep, mySubscription,
};
