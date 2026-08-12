/**
 * Razorpay — raising an order, and verifying that a payment really happened.
 *
 * ── The one rule that matters ──────────────────────────────────────────────
 *
 * The browser tells us a payment succeeded. The browser is not a source of
 * truth. Razorpay's checkout hands back a payment id, an order id and a
 * signature; the signature is an HMAC of the first two, keyed with our secret,
 * and it is the ONLY thing that distinguishes a real payment from a forged
 * callback typed into a console.
 *
 * So: an order is created server-side with the amount WE computed, the callback
 * is verified against the signature, and the amount is re-read from our own
 * stored order rather than from anything the client sent. Without that, an
 * organisation could pay ₹1 for a ₹50,000 plan by editing one number.
 *
 * ── Test mode ──────────────────────────────────────────────────────────────
 *
 * Razorpay keys come in rzp_test_… and rzp_live_… pairs. Both work here. The
 * console shows which is in use, because "we took a real payment in test mode"
 * and "we took a test payment in live mode" are both bad afternoons.
 */
import crypto from 'node:crypto';
import { masterDb } from '../database/master.js';
import { badRequest, ApiError } from '../utils/respond.js';
import logger from '../utils/logger.js';

const API = 'https://api.razorpay.com/v1';

export async function razorpayConfig() {
  try {
    const [rows] = await masterDb().query(
      "SELECT key_name, value FROM platform_settings WHERE key_name LIKE 'razorpay\\_%'"
    );
    const m = Object.fromEntries(rows.map((r) => [r.key_name, r.value ?? '']));
    return {
      enabled: m.razorpay_enabled === '1',
      key_id: (m.razorpay_key_id || '').trim(),
      key_secret: m.razorpay_key_secret || '',
      business_name: m.razorpay_business_name || 'IFQM',
      last_test: {
        at: m.razorpay_last_test_at || null,
        ok: m.razorpay_last_test_ok === '1',
        note: m.razorpay_last_test_note || '',
      },
    };
  } catch (e) {
    logger.warn('razorpay: could not read settings', e.message);
    return { enabled: false, key_id: '', key_secret: '', business_name: 'IFQM', last_test: {} };
  }
}

export function razorpayMissing(cfg) {
  const missing = [];
  if (!cfg.key_id) missing.push('Key ID');
  if (!cfg.key_secret) missing.push('Key Secret');
  if (cfg.key_id && !/^rzp_(test|live)_/.test(cfg.key_id)) {
    missing.push('Key ID should begin rzp_test_ or rzp_live_');
  }
  return missing;
}

/** Which environment the configured key belongs to. */
export function razorpayMode(keyId) {
  if (/^rzp_live_/.test(keyId || '')) return 'live';
  if (/^rzp_test_/.test(keyId || '')) return 'test';
  return 'unknown';
}

const auth = (cfg) => `Basic ${Buffer.from(`${cfg.key_id}:${cfg.key_secret}`).toString('base64')}`;

/**
 * Raise an order for a tenant's current plan.
 *
 * The amount is computed here, from the plan on file, and stored. Nothing the
 * caller sends influences what is charged — the client picks how many periods
 * and that is all.
 */
export async function createOrder({ tenant, plan, periods = 1, actor = null }) {
  const cfg = await razorpayConfig();
  if (!cfg.enabled) throw new ApiError(503, 'Online payment is not switched on for this platform.');
  const missing = razorpayMissing(cfg);
  if (missing.length) throw new ApiError(503, `Payment gateway is not configured: ${missing.join(', ')}.`);
  if (!plan) throw badRequest('No plan is assigned to this organisation yet. Contact IFQM.');

  const n = Math.max(1, Math.min(24, parseInt(periods, 10) || 1));
  const { priceBreakdown } = await import('./planService.js');
  const b = priceBreakdown(plan);
  const amount = b.total_paise * n;
  if (amount <= 0) throw badRequest('This plan has no amount to charge.');

  let order;
  try {
    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth(cfg) },
      body: JSON.stringify({
        amount,                    // paise, which is Razorpay's own unit too
        currency: 'INR',
        // Shown on the Razorpay dashboard, so a finance person can match a
        // payment to a customer without opening this application.
        receipt: `ifqm-${tenant.slug}-${Date.now()}`.slice(0, 40),
        notes: {
          tenant: tenant.slug,
          tenant_name: tenant.name,
          plan: plan.code || plan.name,
          periods: String(n),
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    if (!res.ok) {
      logger.error(`razorpay: order failed ${res.status}`);
      throw new ApiError(502, explain(body) || `The payment gateway refused the order (${res.status}).`);
    }
    order = JSON.parse(body);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    logger.error('razorpay: order request failed', e.message);
    throw new ApiError(502, 'Could not reach the payment gateway. Please try again.');
  }

  await masterDb().execute(
    `INSERT INTO payment_attempts
       (tenant_id, plan_id, order_ref, amount_paise, gst_paise, currency, periods,
        status, actor_email, actor_name)
     VALUES (?,?,?,?,?,?,?, 'created', ?, ?)`,
    [tenant.id, plan.id || null, order.id, amount, b.gst_paise * n, 'INR', n,
      actor?.email || null, actor?.name || null]
  );

  logger.info(`razorpay: order ${order.id} raised for ${tenant.slug} (${amount} paise)`);
  return {
    success: true,
    order_id: order.id,
    amount,
    currency: 'INR',
    key_id: cfg.key_id,               // public by design; the secret never leaves
    business_name: cfg.business_name,
    mode: razorpayMode(cfg.key_id),
    plan: { name: plan.name, cycle_label: plan.cycle_label },
    periods: n,
  };
}

/**
 * Verify a completed checkout and, only then, extend the subscription.
 *
 * `timingSafeEqual` rather than `===`: comparing HMACs with a normal string
 * compare leaks how many leading bytes matched through timing, which is enough
 * to forge one byte at a time.
 */
export async function verifyPayment({ orderId, paymentId, signature, tenant, actor }) {
  const cfg = await razorpayConfig();
  if (!cfg.key_secret) throw new ApiError(503, 'Payment gateway is not configured.');
  if (!orderId || !paymentId || !signature) throw badRequest('Incomplete payment response.');

  const [[attempt]] = await masterDb().execute(
    'SELECT * FROM payment_attempts WHERE order_ref = ? LIMIT 1', [orderId]
  );
  if (!attempt) throw badRequest('That order is not one we raised.');
  // The order has to belong to the organisation claiming it, or one customer
  // could settle their bill by replaying another's payment.
  if (Number(attempt.tenant_id) !== Number(tenant.id)) {
    throw new ApiError(403, 'That order belongs to a different organisation.');
  }
  if (attempt.status === 'paid') {
    return { success: true, already: true, message: 'This payment was already recorded.' };
  }

  const expected = crypto.createHmac('sha256', cfg.key_secret)
    .update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    await masterDb().execute(
      "UPDATE payment_attempts SET status='failed', note=? WHERE id=?",
      ['Signature did not verify', attempt.id]
    );
    logger.error(`razorpay: signature mismatch on order ${orderId}`);
    throw new ApiError(400, 'That payment could not be verified. Nothing has been charged to your account by us — if money left your account, contact IFQM with the payment reference.');
  }

  await masterDb().execute(
    "UPDATE payment_attempts SET status='paid', payment_ref=?, paid_at=NOW() WHERE id=?",
    [paymentId, attempt.id]
  );

  // Extend the subscription by exactly what was paid for — read from OUR row,
  // never from the callback.
  const { markPaid } = await import('./subscriptionService.js');
  const result = await markPaid(tenant.id, {
    periods: attempt.periods,
    note: `Razorpay ${paymentId}`,
  }, actor);

  logger.info(`razorpay: payment ${paymentId} verified for ${tenant.slug}`);
  return { success: true, message: result.message, payment_ref: paymentId };
}

/** Recent attempts for one organisation, for its own billing page. */
export async function paymentHistory(tenantId, limit = 20) {
  try {
    const n = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const [rows] = await masterDb().execute(
      `SELECT id, order_ref, payment_ref, amount_paise, gst_paise, periods, status,
              actor_name, created_at, paid_at
         FROM payment_attempts WHERE tenant_id = ?
        ORDER BY id DESC LIMIT ${n}`, [Number(tenantId) || 0]
    );
    return rows || [];
  } catch {
    return [];
  }
}

/**
 * Prove the keys work, without taking money.
 *
 * Fetching the (empty) payments list is an authenticated read that costs
 * nothing and fails loudly on a wrong key — which is exactly what a
 * "Test connection" button should do.
 */
export async function testConnection() {
  const cfg = await razorpayConfig();
  const missing = razorpayMissing(cfg);
  if (missing.length) return { success: true, ok: false, detail: `Not configured: ${missing.join(', ')}` };

  let out;
  try {
    const res = await fetch(`${API}/payments?count=1`, {
      headers: { Authorization: auth(cfg) },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    out = res.ok
      ? { ok: true, detail: `Keys accepted — ${razorpayMode(cfg.key_id)} mode.` }
      : { ok: false, detail: explain(body) || `Razorpay answered ${res.status}.` };
  } catch (e) {
    const { networkReason } = await import('./smsService.js');
    out = { ok: false, detail: networkReason(e, API) };
  }

  const { localStamp } = await import('./smsService.js');
  for (const [k, v] of [
    ['razorpay_last_test_at', localStamp()],
    ['razorpay_last_test_ok', out.ok ? '1' : '0'],
    ['razorpay_last_test_note', out.detail.slice(0, 255)],
  ]) {
    await masterDb().execute(
      `INSERT INTO platform_settings (key_name, value) VALUES (?,?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)`, [k, v]
    ).catch(() => {});
  }
  return { success: true, ...out, mode: razorpayMode(cfg.key_id) };
}

function explain(body) {
  try {
    const j = JSON.parse(body);
    return String(j.error?.description || j.error?.reason || j.message || '').slice(0, 200) || null;
  } catch { return String(body || '').trim().slice(0, 200) || null; }
}

export default {
  razorpayConfig, razorpayMissing, razorpayMode,
  createOrder, verifyPayment, paymentHistory, testConnection,
};
