import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { settingsApi } from '../services/api';
import { fmtDate, fmtDateTime } from '../utils/helpers';

/*
 * The organisation's own billing page.
 *
 * ── Who sees what ──────────────────────────────────────────────────────────
 *
 * Anybody signed in can read it. "This company is two days from being cut off"
 * is not confidential from the people it will cut off, and the person who
 * notices is often not the person who pays.
 *
 * Only an administrator can pay. An employee should not be able to spend the
 * company's money, so the button simply is not rendered for them — and the
 * server refuses it regardless, because a hidden button is not a permission.
 *
 * ── Loading Razorpay ───────────────────────────────────────────────────────
 *
 * The checkout script is fetched from Razorpay's own domain, on demand, only
 * when somebody actually presses Pay. Loading it on every page view would put a
 * third-party script into every screen of the product for a button most people
 * will never press.
 */

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const RZP_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = RZP_SRC;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function BillingPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [periods, setPeriods] = useState(1);
  const [busy, setBusy] = useState(false);

  const canPay = ['admin', 'super_admin'].includes(user?.role);

  const load = useCallback(async () => {
    try {
      const r = await settingsApi.billing();
      setData(r.data);
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.fail_load'), 'danger');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function pay() {
    setBusy(true);
    try {
      const ok = await loadRazorpay();
      if (!ok) {
        showToast(t('bill.rzp_blocked'), 'danger');
        setBusy(false);
        return;
      }
      const order = (await settingsApi.payStart({ periods })).data;

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: order.business_name,
        description: `${order.plan?.name || ''} × ${order.periods}`,
        order_id: order.order_id,
        prefill: { name: user?.name, email: user?.email },
        theme: { color: '#4f46e5' },
        // Verified server-side against the signature. Nothing is extended on
        // the strength of the browser saying it went through.
        handler: async (resp) => {
          try {
            const v = await settingsApi.payVerify(resp);
            showToast(v.data.message || t('bill.paid'), 'success');
            await load();
          } catch (err) {
            showToast(err?.response?.data?.error || t('bill.verify_failed'), 'danger');
          }
        },
        modal: { ondismiss: () => showToast(t('bill.cancelled'), 'info') },
      });
      rzp.on('payment.failed', (e) => {
        showToast(e?.error?.description || t('bill.failed'), 'danger');
      });
      rzp.open();
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  if (!data) return <div className="empty-state"><div className="spinner"></div></div>;

  const sub = data.subscription;
  const plan = data.plan;
  const gw = data.gateway || {};

  if (!sub) {
    return <div className="card"><div className="empty-state">{t('bill.none')}</div></div>;
  }

  // Three different messages, because they call for three different actions.
  const banner = sub.blocked
    ? { tone: 'danger', title: t('bill.b_held'), body: t('bill.b_held_body') }
    : sub.in_grace
      ? { tone: 'danger', title: t('bill.b_overdue', { n: sub.grace_days_left }),
        body: t('bill.b_overdue_body', { n: sub.grace_days_left }) }
      : sub.days_left !== null && sub.days_left <= 7
        ? { tone: 'warning', title: t('bill.b_soon', { n: sub.days_left }),
          body: t('bill.b_soon_body') }
        : null;

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--heading)', margin: 0, letterSpacing: '-.5px' }}>
          {t('bill.title')}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--subtle)', marginTop: 4 }}>{t('bill.sub')}</div>
      </div>

      {banner && (
        <div style={{
          background: `var(--${banner.tone}-light)`, color: `var(--${banner.tone})`,
          border: `1px solid var(--${banner.tone})`, borderRadius: 8,
          padding: '13px 15px', marginBottom: 16, lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{banner.title}</div>
          <div style={{ fontSize: 12.5, marginTop: 3 }}>{banner.body}</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">{t('bill.current')}</div>
        {!plan ? (
          <div style={{ fontSize: 13, color: 'var(--subtle)', lineHeight: 1.6 }}>{t('bill.no_plan')}</div>
        ) : (
          <>
            {/* A table, not four figures floating in a row.
                As free-standing numbers nothing lined up: the price sat beside a
                day count beside a date, all at the same weight, so there was no
                telling which was the amount due and which was a countdown. Rows
                with named labels answer that by construction. */}
            <table className="table" style={{ marginBottom: 18 }}>
              <tbody>
                <tr>
                  <td style={{ color: 'var(--subtle)', width: '42%' }}>{t('bill.plan_lbl')}</td>
                  <td style={{ fontWeight: 700, color: 'var(--heading)' }}>
                    {plan.name}
                    <span style={{ fontWeight: 500, color: 'var(--subtle)', marginLeft: 8, fontSize: 12.5 }}>
                      {plan.cycle_label}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--subtle)' }}>{t('bill.amount_lbl')}</td>
                  <td>
                    {/* The figure shown is the one the Pay button charges. It
                        used to be the stored price captioned "including X% GST",
                        which is only true for a GST-inclusive plan — on an
                        exclusive one the page understated the bill and checkout
                        opened on a larger number than the customer had read. */}
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {money(plan.total_rupees * 100)}
                    </span>
                    <span style={{ color: 'var(--subtle)', marginLeft: 8, fontSize: 12.5 }}>
                      {Number(plan.gst_percent) > 0
                        ? t('bill.incl_gst', { gst: plan.gst_percent })
                        : t('bill.no_gst')}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--subtle)' }}>{t('bill.days_left')}</td>
                  <td style={{ fontWeight: 700 }}>{sub.days_left ?? '—'}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--subtle)' }}>{t('bill.due')}</td>
                  <td style={{ fontWeight: 600 }}>{sub.ends_at ? fmtDate(sub.ends_at) : '—'}</td>
                </tr>
              </tbody>
            </table>

            {canPay && gw.enabled && (
              <div style={{
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                borderTop: '1px solid var(--border)', paddingTop: 16,
              }}>
                <label style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{t('bill.periods')}</label>
                <input className="form-control" type="number" min="1" max="24" value={periods}
                  style={{ maxWidth: 90 }} onChange={(e) => setPeriods(Number(e.target.value) || 1)} />
                <button className="btn btn-primary" disabled={busy} onClick={pay}>
                  {busy ? t('bill.opening') : t('bill.pay', { amount: money((plan.total_rupees * 100) * periods) })}
                </button>
                {gw.mode === 'test' && (
                  <span className="badge badge-review">{t('bill.test_mode')}</span>
                )}
              </div>
            )}
            {canPay && !gw.enabled && (
              <div style={{
                borderTop: '1px solid var(--border)', paddingTop: 16,
                fontSize: 12.5, color: 'var(--subtle)', lineHeight: 1.6,
              }}>
                {t('bill.no_gateway')}
              </div>
            )}
            {!canPay && (
              <div style={{
                borderTop: '1px solid var(--border)', paddingTop: 16,
                fontSize: 12.5, color: 'var(--subtle)',
              }}>
                {t('bill.admin_only')}
              </div>
            )}
          </>
        )}
      </div>

      {data.payments?.length > 0 && (
        <div className="card">
          <div className="card-title">{t('bill.history')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>{t('bill.h_when')}</th><th>{t('bill.h_amount')}</th>
                  <th>{t('bill.h_periods')}</th><th>{t('bill.h_status')}</th>
                  <th>{t('bill.h_ref')}</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(p.paid_at || p.created_at)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.amount_paise)}</td>
                    <td>{p.periods}</td>
                    <td>
                      <span className={`badge ${p.status === 'paid' ? 'badge-approved'
                        : p.status === 'failed' ? 'badge-rejected' : 'badge-draft'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}><code>{p.payment_ref || p.order_ref || '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.events?.length > 0 && (
        <div className="card">
          <div className="card-title">{t('bill.changes')}</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.events.slice(0, 10).map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--subtle)', whiteSpace: 'nowrap', minWidth: 130 }}>
                  {fmtDateTime(e.created_at)}
                </span>
                <span style={{ fontWeight: 600 }}>{String(e.event).replace(/_/g, ' ')}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {e.to_plan_name || e.note || ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
