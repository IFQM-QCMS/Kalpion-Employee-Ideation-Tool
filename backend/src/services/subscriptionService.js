/** What each organisation is on, until when, and what happens when it runs out. */
import { masterDb } from '../database/master.js';
import { badRequest, notFound } from '../utils/respond.js';
import { decoratePlan, priceBreakdown, CYCLE_DAYS, isLifetime, isPayg } from './planService.js';
import { usageHistory } from './usageBillingService.js';
import { getPlatformSetting } from './platformSettingsService.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import { invalidateQuotaCache, usageFor } from '../middleware/tenantQuota.js';
import { heldForNonPayment } from '../database/tenant.js';

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

/** Where this organisation stands right now. */
export function billingState(tenant, { graceDays = 2 } = {}) {
  const status = tenant.billing_status || 'trial';
  if (status === 'exempt') {
    // Two different situations share this status, and the screens should not describe them the
    // same way.
    const lifetime = tenant.billing_cycle === 'lifetime' || tenant.plan_cycle === 'lifetime';
    return {
      state: 'exempt', days_left: null, blocked: false, in_grace: false,
      grace_days_left: null, is_lifetime: lifetime,
      label: lifetime ? 'Lifetime - never expires' : 'Not billed',
    };
  }

  const endsAt = status === 'trial' ? tenant.trial_ends_at : (tenant.period_end || tenant.trial_ends_at);
  const left = daysUntil(endsAt);

  if (left === null) {
    // No end date on file. Treated as not yet started rather than as expired: locking somebody
    // out because a field was never filled in is the wrong way round.
    return {
      state: status, days_left: null, blocked: false, in_grace: false,
      grace_days_left: null, ends_at: null, label: 'No end date set',
    };
  }
  if (left > 0) {
    return {
      state: status,
      days_left: left,
      ends_at: endsAt,
      blocked: false,
      in_grace: false,
      grace_days_left: null,
      label: status === 'trial' ? `Trial - ${left} day(s) left` : `Paid - ${left} day(s) left`,
    };
  }

  // Past the due date - but not yet cut off.
  const overdueDays = Math.abs(left);
  const graceLeft = graceDays - overdueDays;
  if (graceLeft > 0) {
    return {
      state: 'past_due',
      days_left: left,
      ends_at: endsAt,
      blocked: false,
      in_grace: true,
      grace_days_left: graceLeft,
      overdue_days: overdueDays,
      label: `Payment overdue - ${graceLeft} day(s) before access is held`,
    };
  }

  return {
    state: 'expired',
    days_left: left,
    ends_at: endsAt,
    blocked: true,
    in_grace: false,
    grace_days_left: 0,
    overdue_days: overdueDays,
    label: status === 'trial' ? 'Trial ended' : 'Subscription ended',
  };
}

/** Save the payment gateway's settings. */
export async function updateGateway(body = {}, actor = null) {
  const write = async (k, v) => masterDb().execute(
    `INSERT INTO platform_settings (key_name, value) VALUES (?,?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`, [k, String(v)]
  );

  const { razorpayConfig, razorpayMissing } = await import('./razorpayService.js');
  const current = await razorpayConfig();

  const keyId = body.key_id !== undefined ? String(body.key_id).trim() : current.key_id;
  const secret = String(body.key_secret ?? '').trim();
  const clearing = body.key_secret_clear === true;
  const wantsOn = body.enabled === true || body.enabled === '1';

  if (wantsOn) {
    const effective = {
      key_id: keyId,
      key_secret: clearing ? '' : (secret || current.key_secret),
    };
    const missing = razorpayMissing(effective);
    if (missing.length) {
      throw badRequest(`The payment gateway is incomplete: ${missing.join(', ')}.`);
    }
  }

  let touched = 0;
  if (body.key_id !== undefined) { await write('razorpay_key_id', keyId); touched++; }
  if (body.business_name !== undefined) {
    await write('razorpay_business_name', String(body.business_name).trim().slice(0, 120)); touched++;
  }
  if (body.enabled !== undefined) { await write('razorpay_enabled', wantsOn ? '1' : '0'); touched++; }
  if (clearing) { await write('razorpay_key_secret', ''); touched++; }
  else if (secret) { await write('razorpay_key_secret', secret); touched++; }

  if (!touched) throw badRequest('Nothing to update.');
  logger.info(`billing: payment gateway updated by ${actor?.email || 'unknown'}`);

  const cfg = await razorpayConfig();
  const { razorpayMode } = await import('./razorpayService.js');
  return {
    success: true,
    updated: touched,
    enabled: cfg.enabled,
    key_id: cfg.key_id,
    business_name: cfg.business_name,
    key_secret_set: !!cfg.key_secret,
    mode: razorpayMode(cfg.key_id),
    missing: razorpayMissing(cfg),
    last_test: cfg.last_test,
  };
}

/** The configured grace window, in days. */
export async function graceDays() {
  const n = parseInt(await getPlatformSetting('billing_grace_days'), 10);
  return Number.isFinite(n) && n >= 0 && n <= 30 ? n : 2;
}

/** Every organisation's billing state on one screen. */
export async function billingOverview({ warnDays } = {}) {
  const warn = Number.isFinite(Number(warnDays)) ? Number(warnDays)
    : parseInt(await getPlatformSetting('billing_warn_days'), 10) || 5;
  const enforce = String(await getPlatformSetting('billing_enforce')) === '1';
  // The same window the sweep uses. Read once here rather than per row.
  const grace = await graceDays();

  const [rows] = await masterDb().query(
    `SELECT t.id, t.name, t.slug, t.status, t.billing_status, t.plan_id,
            t.trial_days, t.trial_ends_at, t.period_start, t.period_end,
            t.billing_note, t.created_at, t.last_login_at,
            p.name AS plan_name, p.code AS plan_code, p.tier AS plan_tier,
            p.amount_paise, p.billing_cycle, p.gst_percent, p.gst_mode,
            p.max_users
       FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
      WHERE t.status <> 'deleted'
      ORDER BY t.name`
  );

  const summary = {
    organisations: rows.length,
    on_trial: 0, paying: 0, lapsed: 0, exempt: 0, in_grace: 0,
    // The one that matters most operationally: nobody has decided what this customer pays, so
    // they are using the platform on nothing at all.
    no_plan: 0,
    expiring_soon: 0, on_hold: 0,
    recurring_paise: 0, trial_pipeline_paise: 0,
    warn_days: warn, grace_days: grace, enforce,
  };

  const organisations = rows.map((t) => {
    const state = billingState(t, { graceDays: grace });
    const plan = t.plan_id ? decoratePlan({
      id: t.plan_id, name: t.plan_name, code: t.plan_code, tier: t.plan_tier,
      amount_paise: t.amount_paise, billing_cycle: t.billing_cycle,
      gst_percent: t.gst_percent, gst_mode: t.gst_mode, max_users: t.max_users,
    }) : null;

    const total = plan ? priceBreakdown(plan).total_paise : 0;

    if (state.state === 'exempt') summary.exempt += 1;
    else if (state.state === 'trial') summary.on_trial += 1;
    else if (state.state === 'active') summary.paying += 1;
    else if (state.blocked) summary.lapsed += 1;

    if (state.in_grace) summary.in_grace += 1;
    if (!t.plan_id) summary.no_plan += 1;
    if (t.status === 'suspended') summary.on_hold += 1;

    // Counted separately: money being paid now, versus money a trial would be worth if it
    // converts. Adding them together would overstate both.
    if (state.state === 'active') summary.recurring_paise += total;
    if (state.state === 'trial') summary.trial_pipeline_paise += total;

    const days = state.days_left;
    const expiring = days !== null && days !== undefined && days >= 0 && days <= warn;
    if (expiring) summary.expiring_soon += 1;

    return {
      id: t.id, name: t.name, slug: t.slug,
      status: t.status,
      created_at: t.created_at,
      last_login_at: t.last_login_at,
      plan: plan && {
        id: plan.id, name: plan.name, code: plan.code, tier: plan.tier,
        amount_rupees: plan.amount_rupees, total_rupees: plan.total_rupees,
        cycle_label: plan.cycle_label, max_users: plan.max_users,
      },
      billing: {
        ...state,
        billing_status: t.billing_status,
        trial_days: t.trial_days,
        trial_ends_at: t.trial_ends_at,
        period_start: t.period_start,
        period_end: t.period_end,
        note: t.billing_note,
        expiring_soon: expiring,
      },
    };
  });

  return { success: true, summary, organisations };
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
  let events = [];
  try {
    const [rows] = await masterDb().execute(
      `SELECT e.*, fp.name AS from_plan_name, tp.name AS to_plan_name
         FROM tenant_billing_events e
         LEFT JOIN plans fp ON fp.id = e.from_plan_id
         LEFT JOIN plans tp ON tp.id = e.to_plan_id
        WHERE e.tenant_id = ? ORDER BY e.created_at DESC LIMIT 50`,
      [tenant.id]
    );
    events = rows;
  } catch {
    events = [];
  }

  // How much of the plan's request allowance this organisation has used.
  const quota = await usageFor(tenant.id);
  const grace = await graceDays();

  return {
    success: true,
    quota,
    grace_days: grace,
    subscription: {
      tenant_id: tenant.id,
      billing_status: tenant.billing_status,
      trial_days: tenant.trial_days,
      trial_ends_at: tenant.trial_ends_at,
      period_start: tenant.period_start,
      period_end: tenant.period_end,
      billing_note: tenant.billing_note,
      // The tenants row carries no billing cycle - it is on the plan - so it is handed in
      // explicitly.
      ...billingState({ ...tenant, plan_cycle: plan?.billing_cycle }, { graceDays: grace }),
      // Metered months, newest first, with the current one marked open.
      ...(isPayg(plan?.billing_cycle)
        ? { usage: (await usageHistory(tenant.id)).usage }
        : {}),
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

/** Put an organisation on a plan, with a trial. */
export async function assignPlan(tenantId, { planId, trialDays, note } = {}, actor = null) {
  const id = Number(tenantId) || 0;
  const [[tenant]] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [id]);
  if (!tenant) throw notFound('Organisation not found.');

  const wanted = Number(planId) || 0;
  if (!wanted) throw badRequest('Choose a plan.');
  const [[plan]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [wanted]);
  if (!plan) throw badRequest('That plan no longer exists.');

  const lifetimePlan = isLifetime(plan.billing_cycle);
  const paygPlan = isPayg(plan.billing_cycle);

  // A lifetime plan takes no trial, and that is not an error worth stopping for.
  // Pay as you go takes no trial either, for a different reason from lifetime.
  const days = (lifetimePlan || paygPlan) ? 0 : (
    trialDays === undefined || trialDays === null || trialDays === ''
      ? await defaultTrialDays()
      : Math.max(0, Math.min(365, parseInt(trialDays, 10) || 0)));

  // A trial runs on the trial plan, never on a paid one.
  if (days > 0 && plan.tier !== 'trial') {
    throw badRequest(
      `"${plan.name}" is a paid plan, so it cannot run as a trial. `
      + 'Leave the organisation on the Trial plan while it evaluates, then assign '
      + `"${plan.name}" with a trial length of 0 when it converts - the paid period starts then.`
    );
  }

  const now = new Date();
  const lifetime = lifetimePlan;
  const cycleDays = lifetime ? null : (CYCLE_DAYS[plan.billing_cycle] || 365);

  let billingStatus;
  let trialEnds = null;
  let periodStart = null;
  let periodEnd = null;

  if (lifetime) {
    // No end date, and 'exempt' rather than 'active'.
    billingStatus = 'exempt';
    periodStart = now;
    periodEnd = null;
  } else if (days > 0) {
    billingStatus = 'trial';
    trialEnds = addDays(now, days);
    // The paid period starts when the trial ends, so the organisation is never billed for days
    // it was still evaluating.
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
      sqlDate(periodStart), periodEnd ? sqlDate(periodEnd) : null,
      note ? String(note).slice(0, 500) : tenant.billing_note,
      id,
    ]
  );

  // The request allowance comes from the plan, and limits are cached for a minute.
  invalidateQuotaCache(id);

  await record(id, tenant.plan_id ? 'plan_changed' : 'plan_assigned', {
    fromPlanId: tenant.plan_id, toPlanId: plan.id,
    fromValue: tenant.plan_id ? `${tenant.trial_days} day trial` : null,
    toValue: days ? `${days} day trial` : 'no trial',
    note,
  }, actor);

  return {
    success: true,
    message: paygPlan
      ? `${tenant.name} is on ${plan.name}. Each month is billed for the people who signed in.`
      : lifetime
      ? `${tenant.name} is on ${plan.name}. It never expires and will not be billed again.`
      : (days
        ? `${tenant.name} is on ${plan.name} with a ${days}-day trial.`
        : `${tenant.name} is on ${plan.name}, billing from today.`),
  };
}

/** Lengthen or shorten the free evaluation. */
export async function setTrialDays(tenantId, days, actor = null, note = '') {
  const id = Number(tenantId) || 0;
  const [[tenant]] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [id]);
  if (!tenant) throw notFound('Organisation not found.');

  const n = Math.max(0, Math.min(365, parseInt(days, 10)));
  if (!Number.isFinite(n)) throw badRequest('Enter a number of days between 0 and 365.');

  const before = daysUntil(tenant.trial_ends_at);
  const trialEnds = n > 0 ? addDays(new Date(), n) : null;

  // Push the paid period out to start when the new trial ends, so extending a trial does not
  // leave the organisation billed for days it did not use.
  let cycleDays = 365;
  if (tenant.plan_id) {
    const [[plan]] = await masterDb().execute(
      'SELECT billing_cycle FROM plans WHERE id = ? LIMIT 1', [tenant.plan_id]
    );
    // Same trap as markPaid: a trial window on a plan that never ends would give the
    // organisation its first expiry date.
    if (isLifetime(plan?.billing_cycle)) {
      throw badRequest(`${tenant.name} is on a lifetime plan, which never expires - a trial period would only give it an end date.`);
    }
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
      : 'Trial removed - billing starts now.',
  };
}

/** Record that an organisation has paid for the next period. */
export async function markPaid(tenantId, { periods = 1, note = '' } = {}, actor = null) {
  const id = Number(tenantId) || 0;
  const [[tenant]] = await masterDb().execute('SELECT * FROM tenants WHERE id = ? LIMIT 1', [id]);
  if (!tenant) throw notFound('Organisation not found.');
  if (!tenant.plan_id) throw badRequest('Put this organisation on a plan first.');

  const [[plan]] = await masterDb().execute('SELECT * FROM plans WHERE id = ? LIMIT 1', [tenant.plan_id]);
  // A lifetime plan has nothing to extend, and quietly extending it is worse than refusing:
  // CYCLE_DAYS.lifetime is null, so the `|| 365` below would have turned a perpetual
  // organisation into a yearly one and handed it an expiry date a year out - visible to
  // nobody until the sweep suspended them.
  if (isLifetime(plan?.billing_cycle)) {
    throw badRequest(`${tenant.name} is on a lifetime plan. There is nothing to renew.`);
  }
  // Pay as you go is settled per month against a metered figure, so "extend by N periods" is
  // the wrong shape of action: it would move the period end without anybody having decided
  // what was owed.
  if (isPayg(plan?.billing_cycle)) {
    throw badRequest(
      `${tenant.name} is on pay as you go - a month is settled against its metered `
      + 'usage, not extended by a fixed period. Close the month from the usage view.'
    );
  }
  const cycleDays = CYCLE_DAYS[plan?.billing_cycle] || 365;
  const n = Math.max(1, Math.min(12, parseInt(periods, 10) || 1));

  // Extend from whichever is later: the current period end, or today. Extending from a
  // lapsed end date would sell them days that have already gone by.
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

  // Paying reinstates an organisation that was held for non-payment - but not one an
  // operator suspended for some other reason, which is why the note is checked rather than
  // the status alone.
  if (heldForNonPayment(tenant)) {
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

/** Find organisations whose time is up and put them on hold. */
export async function sweepLapsed({ dryRun = false } = {}) {
  const enforce = String(await getPlatformSetting('billing_enforce')) === '1';
  const grace = await graceDays();
  const reminderHours = parseInt(await getPlatformSetting('billing_reminder_hours'), 10) || 20;

  const [rows] = await masterDb().query(
    `SELECT id, name, slug, status, billing_status, trial_ends_at, period_end,
            billing_note, last_reminder_at
       FROM tenants
      WHERE billing_status IN ('trial','active','past_due')`
  );

  let lapsed = 0;
  let held = 0;
  let reminded = 0;
  for (const t of rows) {
    const state = billingState(t, { graceDays: grace });

    // Inside the grace window: still working, but chase it.
    if (state.in_grace) {
      const hoursSince = t.last_reminder_at
        ? (Date.now() - new Date(t.last_reminder_at).getTime()) / 3600000
        : Infinity;
      if (!dryRun && hoursSince >= reminderHours) {
        await sendOverdueReminder(t, state);
        await masterDb().execute(
          'UPDATE tenants SET last_reminder_at = NOW(), billing_status = ? WHERE id = ?',
          ['past_due', t.id]
        );
        reminded += 1;
      } else if (dryRun && hoursSince >= reminderHours) {
        reminded += 1;
      }
      continue;
    }

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

    // Suspending is the part that locks people out, so it is the part that is gated.
    if (enforce && t.status === 'active') {
      await masterDb().execute(
        "UPDATE tenants SET status = 'suspended', billing_note = ? WHERE id = ?",
        ['On hold for non-payment. Reinstated automatically once payment is recorded.', t.id]
      );
      await record(t.id, 'put_on_hold', {
        note: `Automatic: ${grace} day grace period expired`,
      });
      await sendHeldNotice(t);
      held += 1;
    }
  }

  return {
    success: true, checked: rows.length, lapsed, held, reminded,
    grace_days: grace, enforced: enforce, dry_run: !!dryRun,
  };
}

/** Who to chase at an organisation - its administrators. */
async function orgAdmins(tenant) {
  try {
    const { getTenantPool } = await import('../database/tenant.js');
    const db = getTenantPool(tenant);
    const [rows] = await db.query(
      "SELECT name, email FROM users WHERE role IN ('admin','super_admin') AND status='active' AND email <> ''"
    );
    return rows;
  } catch {
    return [];
  }
}

/** "Your payment is overdue - please pay to keep using the platform.". */
async function sendOverdueReminder(tenant, state) {
  const admins = await orgAdmins(tenant);
  if (!admins.length) return;
  const { sendZeptoMail, mailConfig } = await import('./zeptoMailService.js');
  const cfg = await mailConfig();
  if (!cfg.zepto_enabled) {
    logger.warn(`billing: ${tenant.slug} is overdue but no platform mail provider is configured`);
    return;
  }
  const left = state.grace_days_left;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>Hello,</p>
  <p>The subscription for <b>${String(tenant.name).replace(/[<>&]/g, '')}</b> on the IFQM
  Kalpion is <b>overdue</b>.</p>
  <p>Please make the payment within <b>${left} day(s)</b>. After that the organisation will be
  placed on hold, and nobody in your team will be able to sign in until payment is received.</p>
  <p>You can pay from <b>Settings &rarr; Billing</b> inside the application.</p>
  <p style="color:#666;font-size:13px">If you have already paid, no action is needed -
  this notice stops once the payment is recorded.</p>
</div>`;
  for (const a of admins) {
    await sendZeptoMail({
      to: a.email, toName: a.name, cfg,
      subject: `Payment overdue - ${tenant.name} - ${left} day(s) remaining`,
      html,
    }).catch(() => {});
  }
  logger.info(`billing: overdue reminder sent to ${admins.length} admin(s) at ${tenant.slug}`);
}

/** The organisation has just been put on hold. Tell its administrators why. */
async function sendHeldNotice(tenant) {
  const admins = await orgAdmins(tenant);
  if (!admins.length) return;
  const { sendZeptoMail, mailConfig } = await import('./zeptoMailService.js');
  const cfg = await mailConfig();
  if (!cfg.zepto_enabled) return;
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>Hello,</p>
  <p><b>${String(tenant.name).replace(/[<>&]/g, '')}</b> has been placed on hold because the
  subscription payment was not received within the grace period.</p>
  <p>Nobody in the organisation can sign in until the payment is made. Everything -
  ideas, history, points and files - is retained and returns the moment it is.</p>
  <p>To restore access, contact IFQM or complete the payment using the link in this message
  thread.</p>
</div>`;
  for (const a of admins) {
    await sendZeptoMail({
      to: a.email, toName: a.name, cfg,
      subject: `${tenant.name} is on hold - payment required`,
      html,
    }).catch(() => {});
  }
}

/** Where "Pay Monthly Invoice Now" should actually take somebody. */
function billingUrl() {
  const base = String(config.frontendBaseUrl || '').replace(/\/+$/, '');
  return base ? `${base}/billing` : '/billing';
}

export async function sendMonthlyInvoices() {
  const [rows] = await masterDb().query(
    `SELECT t.id, t.name, t.slug, t.plan_id, t.billing_status, t.period_end, p.name AS plan_name, p.total_rupees
       FROM tenants t
       LEFT JOIN plans p ON p.id = t.plan_id
      WHERE t.status = 'active' AND t.plan_id IS NOT NULL`
  );

  const { sendZeptoMail, mailConfig } = await import('./zeptoMailService.js');
  const cfg = await mailConfig();
  let count = 0;

  for (const t of rows) {
    const admins = await orgAdmins(t);
    if (!admins.length) continue;
    const amountStr = `₹${Number(t.total_rupees || 0).toLocaleString('en-IN')}`;
    const dueDate = t.period_end ? new Date(t.period_end).toLocaleDateString('en-IN') : 'End of Month';

    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>Hello,</p>
  <p>This is the monthly subscription invoice notice for <b>${String(t.name).replace(/[<>&]/g, '')}</b> on Kalpion.</p>
  <p><b>Plan:</b> ${t.plan_name || 'Standard'}<br>
  <b>Monthly Amount:</b> ${amountStr}<br>
  <b>Due Date:</b> ${dueDate}</p>
  <p>Please complete your payment directly from your admin panel under <b>Settings &rarr; Billing</b> or via Razorpay.</p>
  <p style="margin-top:16px"><a href="${billingUrl()}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Pay Monthly Invoice Now</a></p>
</div>`;

    if (cfg.zepto_enabled) {
      for (const a of admins) {
        await sendZeptoMail({
          to: a.email, toName: a.name, cfg,
          subject: `Monthly Invoice (${amountStr}) - ${t.name}`,
          html,
        }).catch(() => {});
      }
    }

    try {
      const { getTenantPool } = await import('../database/tenant.js');
      const { addNotification } = await import('./coreHelpers.js');
      const tenantDb = getTenantPool(t);
      const [urows] = await tenantDb.query("SELECT id FROM users WHERE role IN ('admin','super_admin')");
      for (const u of urows) {
        await addNotification(tenantDb, u.id, 'Monthly Invoice Issued', `Monthly subscription invoice for ${t.plan_name || 'Plan'} (${amountStr}) is due. Pay under Billing.`);
      }
    } catch (e) {
      logger.warn(`Failed to add in-app monthly invoice notif for ${t.slug}`, e.message);
    }

    count++;
  }

  return { success: true, count, message: `Sent monthly invoice payment notices to ${count} organization(s).` };
}

export default {
  billingState, subscriptionFor, assignPlan, setTrialDays, markPaid,
  sweepLapsed, billingOverview, graceDays, updateGateway, defaultTrialDays, daysUntil, sendMonthlyInvoices,
};
