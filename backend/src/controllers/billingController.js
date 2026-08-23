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
import * as razorpayService from '../services/razorpayService.js';
import * as usageBilling from '../services/usageBillingService.js';

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
/**
 * Every organisation's billing state, for the payments dashboard.
 *
 * One request rather than one per organisation: the screen shows a summary and
 * a table that have to agree with each other, and totals computed in a browser
 * from N separate responses drift the moment one of them fails.
 */
/*
 * ── The organisation's own billing page ───────────────────────────────────
 *
 * Deliberately readable by any signed-in member of the organisation, and
 * payable only by its administrators. An employee seeing "your company is three
 * days from being cut off" is useful; an employee being able to spend the
 * company's money is not.
 */
export const myBilling = asyncHandler(async (req, res) => {
  const tenantId = req.tenant?.id;
  if (!tenantId) return respond(res, { success: true, subscription: null, plan: null });

  const [full, gateway, history] = await Promise.all([
    subscriptionService.subscriptionFor(tenantId),
    razorpayService.razorpayConfig(),
    razorpayService.paymentHistory(tenantId),
  ]);
  const { history: events, quota, ...rest } = full;

  return respond(res, {
    ...rest,
    events,
    payments: history,
    // Only what a browser legitimately needs: whether to show the Pay button,
    // and the PUBLIC key id. The secret is never in this response.
    gateway: {
      enabled: gateway.enabled && !razorpayService.razorpayMissing(gateway).length,
      mode: razorpayService.razorpayMode(gateway.key_id),
      business_name: gateway.business_name,
    },
  });
});

/** Raise a Razorpay order for this organisation's own plan. */
export const payStart = asyncHandler(async (req, res) => {
  const full = await subscriptionService.subscriptionFor(req.tenant.id);
  return respond(res, await razorpayService.createOrder({
    tenant: req.tenant,
    plan: full.plan,
    periods: req.body?.periods,
    actor: req.user,
  }));
});

/** Verify the checkout result and extend the subscription. */
export const payVerify = asyncHandler(async (req, res) =>
  respond(res, await razorpayService.verifyPayment({
    orderId: req.body?.razorpay_order_id,
    paymentId: req.body?.razorpay_payment_id,
    signature: req.body?.razorpay_signature,
    tenant: req.tenant,
    actor: req.user,
  }))
);

// ── Platform: the gateway's own configuration ──
export const gatewayGet = asyncHandler(async (_req, res) => {
  const cfg = await razorpayService.razorpayConfig();
  return respond(res, {
    success: true,
    enabled: cfg.enabled,
    key_id: cfg.key_id,
    business_name: cfg.business_name,
    // Never the secret — only whether one is on file.
    key_secret_set: !!cfg.key_secret,
    mode: razorpayService.razorpayMode(cfg.key_id),
    missing: razorpayService.razorpayMissing(cfg),
    last_test: cfg.last_test,
  });
});

export const gatewayUpdate = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.updateGateway(req.body || {}, req.user))
);

export const gatewayTest = asyncHandler(async (_req, res) =>
  respond(res, await razorpayService.testConnection())
);

export const overview = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.billingOverview({ warnDays: req.query.warn_days }))
);

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

export const sendMonthlyInvoices = asyncHandler(async (req, res) =>
  respond(res, await subscriptionService.sendMonthlyInvoices())
);

export default {
  listPlans, getPlan, createPlan, updatePlan, retirePlan,
  subscription, assignPlan, setTrial, markPaid, sweep, overview, mySubscription,
  myBilling, payStart, payVerify, gatewayGet, gatewayUpdate, gatewayTest, sendMonthlyInvoices,
};

/* ── Pay as you go ──────────────────────────────────────────────────────── */

/** GET /api/platform/tenants/:id/usage — metered months, newest first. */
export const usage = asyncHandler(async (req, res) =>
  respond(res, await usageBilling.usageHistory(req.params.id, { months: req.query.months }))
);

/**
 * POST /api/platform/tenants/:id/usage/close — fix a month's figures.
 *
 * Idempotent: closing an already-closed month returns what was stored rather
 * than recounting, because the sign-in log behind it is purged on a retention
 * window and a recount would quietly shrink an old invoice. `recount: true`
 * revises a month deliberately.
 */
export const closeUsageMonth = asyncHandler(async (req, res) =>
  respond(res, await usageBilling.closeMonth(
    req.params.id,
    req.body?.period || usageBilling.periodOf(),
    { recount: !!req.body?.recount }
  ))
);
