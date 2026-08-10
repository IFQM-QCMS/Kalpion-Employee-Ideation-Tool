import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import { fmtDate, fmtDateTime } from '../utils/helpers';
import InfoDot from './InfoDot';

/*
 * Everything about one organisation, in one place.
 *
 * Two halves that were previously nowhere:
 *
 *   The company. Udyam number, GSTIN, PAN, CIN, entity type, sector, size,
 *   turnover, registered address, who applied — all collected once at
 *   registration and then never shown again. It sat in a table nobody looked
 *   at, which meant answering "is this a real company?" involved a database
 *   client.
 *
 *   The money. Which plan they are on, whether they are in a trial, how many
 *   days are left, and the controls to change any of it.
 */

const ENTITY_LABEL = {
  proprietorship: 'Sole proprietorship', partnership: 'Partnership firm', llp: 'LLP',
  private_limited: 'Private limited company', public_limited: 'Public limited company',
  cooperative: 'Co-operative society', trust: 'Trust', society: 'Society', other: 'Other',
};
const CATEGORY_LABEL = { micro: 'Micro', small: 'Small', medium: 'Medium' };
const TURNOVER_LABEL = {
  under_50l: 'Under ₹50 lakh', '50l_2cr': '₹50 lakh – ₹2 crore', '2cr_10cr': '₹2 – 10 crore',
  '10cr_50cr': '₹10 – 50 crore', '50cr_250cr': '₹50 – 250 crore', above_250cr: 'Above ₹250 crore',
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/* A label/value pair. Renders an em dash rather than nothing when a field was
   never supplied, so a gap reads as "not given" and not as a broken screen. */
function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: '0 0 42%', fontSize: 12.5, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{
        flex: 1, fontSize: 13, color: 'var(--text)', fontWeight: 500,
        fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        overflowWrap: 'anywhere',
      }}>{value || <span style={{ color: 'var(--subtle)' }}>—</span>}</div>
    </div>
  );
}

function Card({ title, info, children, action }) {
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>{title}{info && <InfoDot term={info} />}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

const STATE_STYLE = {
  trial:    { bg: 'var(--info-light)',    fg: 'var(--info)' },
  active:   { bg: 'var(--success-light)', fg: 'var(--success)' },
  past_due: { bg: 'var(--warning-light)', fg: 'var(--warning)' },
  expired:  { bg: 'var(--danger-light)',  fg: 'var(--danger)' },
  exempt:   { bg: 'var(--chip-bg)',       fg: 'var(--text-muted)' },
};

export default function OrgProfilePanel({ tenantId, registration, usage, roiTotal, lastIdeaAt, activity }) {
  const { t } = useLang();
  const { showToast } = useToast();

  const [sub, setSub] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [planId, setPlanId] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenantId]);

  async function load() {
    setLoading(true);
    try {
      const [subRes, planRes] = await Promise.allSettled([
        platformApi.subscription(tenantId),
        platformApi.plans(),
      ]);
      if (subRes.status === 'fulfilled' && subRes.value.data.success) {
        setSub(subRes.value.data);
        setPlanId(String(subRes.value.data.plan?.id || ''));
        setTrialDays(String(subRes.value.data.subscription?.trial_days ?? ''));
      }
      // Losing the plan list must not blank the subscription panel with it.
      if (planRes.status === 'fulfilled' && planRes.value.data.success) {
        setPlans((planRes.value.data.plans || []).filter((p) => p.status === 'active'));
      }
    } catch { /* the panel simply shows what it has */ }
    setLoading(false);
  }

  async function run(fn, okMsg) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.data.success) { showToast(res.data.message || okMsg, 'success'); await load(); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  const s = sub?.subscription;
  const plan = sub?.plan;
  const style = STATE_STYLE[s?.state] || STATE_STYLE.exempt;
  const r = registration;

  return (
    <>
      {/* ── Subscription ────────────────────────────────────────────── */}
      <Card title="Subscription and billing" info="billing_status">
        {loading ? <div className="empty-state"><div className="spinner"></div></div> : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <span style={{
                background: style.bg, color: style.fg, fontSize: 12, fontWeight: 700,
                padding: '5px 12px', borderRadius: 999,
              }}>{s?.label || 'Not billed'}</span>
              {plan && (
                <span style={{ fontSize: 13 }}>
                  <strong>{plan.name}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}· {money(plan.total_rupees)} {plan.cycle_label.toLowerCase()}
                  </span>
                </span>
              )}
              {!plan && <span style={{ fontSize: 13, color: 'var(--subtle)' }}>No plan assigned yet.</span>}
            </div>

            <div className="form-row" style={{ gap: 20 }}>
              <div>
                <Row label="Trial length" value={s?.trial_days != null ? `${s.trial_days} day(s)` : null} />
                <Row label="Trial ends" value={s?.trial_ends_at ? fmtDate(s.trial_ends_at) : null} />
                <Row label="Paid period" value={s?.period_start
                  ? `${fmtDate(s.period_start)} → ${fmtDate(s.period_end)}` : null} />
              </div>
              <div>
                <Row label="Days remaining" value={s?.days_left != null
                  ? (s.days_left > 0 ? `${s.days_left} day(s)` : `Ended ${Math.abs(s.days_left)} day(s) ago`)
                  : null} />
                <Row label="Support level" value={plan?.support_level} />
                <Row label="Internal note" value={s?.billing_note} />
              </div>
            </div>

            {/* Controls. Deliberately plain: this is a decision a person makes on
                a phone call, not a workflow. */}
            <div style={{
              marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)',
              display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
            }}>
              <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
                <label style={{ fontSize: 12 }}>Plan</label>
                <select className="form-control" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Choose a plan…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {money(p.total_rupees)} {p.cycle_label.toLowerCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0, width: 130 }}>
                <label style={{ fontSize: 12 }}>Trial days<InfoDot term="trial_days" /></label>
                <input className="form-control" value={trialDays} inputMode="numeric"
                  onChange={(e) => setTrialDays(e.target.value)} placeholder="14" />
              </div>
              <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
                <label style={{ fontSize: 12 }}>Note (optional)</label>
                <input className="form-control" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="What was agreed" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn btn-primary btn-sm" disabled={busy || !planId}
                onClick={() => run(() => platformApi.assignPlan(tenantId, {
                  plan_id: planId, trial_days: trialDays, note,
                }), 'Plan applied.')}>
                {plan ? 'Change plan' : 'Assign plan'}
              </button>
              <button className="btn btn-outline btn-sm" disabled={busy}
                onClick={() => run(() => platformApi.setTrial(tenantId, {
                  trial_days: trialDays, note,
                }), 'Trial updated.')}>
                Set trial to {trialDays || 0} day(s)
              </button>
              <button className="btn btn-outline btn-sm" disabled={busy || !plan}
                onClick={() => run(() => platformApi.markPaid(tenantId, { periods: 1, note }),
                  'Payment recorded.')}>
                Record payment
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 8 }}>
              Trial days are counted from today, not added to what is left — “30 days” means thirty
              days from now. Recording a payment extends the period and reinstates an organisation
              that was held for non-payment.
            </div>

            {/* Usage against the plan's allowance. Shown so the platform team
                sees somebody approaching a limit before their staff do — the
                failure mode last time was a customer finding out when their
                screens stopped working. */}
            {sub?.quota?.monthly != null && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between',
                              alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    Requests this month<InfoDot term="request_allowance" />
                  </span>
                  <span style={{ fontSize: 13 }}>
                    <strong>{Number(sub.quota.used_month).toLocaleString('en-IN')}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' '}of {Number(sub.quota.monthly).toLocaleString('en-IN')} ({sub.quota.percent}%)
                    </span>
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--chip-bg)', marginTop: 6 }}>
                  <div style={{
                    width: `${Math.min(100, sub.quota.percent || 0)}%`, height: '100%', borderRadius: 3,
                    background: sub.quota.percent >= 100 ? 'var(--danger)'
                      : sub.quota.percent >= 80 ? 'var(--warning)' : 'var(--success)',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 5 }}>
                  From the {sub.quota.source}. Resets at the start of next month.
                  {sub.quota.enforced
                    ? ` Requests are refused past ${sub.quota.grace_percent}% over.`
                    : ' Enforcement is off, so nothing is refused.'}
                </div>
              </div>
            )}

            {!!(sub?.history || []).length && (
              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--text-muted)' }}>
                  Billing history ({sub.history.length})
                </summary>
                <div style={{ marginTop: 8 }}>
                  {sub.history.map((h) => (
                    <div key={h.id} style={{ fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                      <strong>{h.event.replace(/_/g, ' ')}</strong>
                      {h.from_plan_name && h.to_plan_name && <> — {h.from_plan_name} → {h.to_plan_name}</>}
                      {!h.from_plan_name && h.to_value && <> — {h.to_value}</>}
                      {h.note && <span style={{ color: 'var(--text-muted)' }}> · {h.note}</span>}
                      <div style={{ color: 'var(--subtle)', fontSize: 11 }}>
                        {fmtDateTime(h.created_at)}{h.actor_name ? ` · ${h.actor_name}` : ' · automatic'}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </Card>

      {/* ── Usage ───────────────────────────────────────────────────── */}
      <Card title="What they are actually using">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
          {[
            ['Employees', usage?.active_users],
            ['Departments', usage?.departments],
            ['Ideas submitted', usage?.ideas_total],
            ['Approved', usage?.ideas_approved],
            ['Implemented', usage?.ideas_implemented],
            ['Pushed to QCMS', usage?.qcms_pushed],
            ['Flagged patentable', usage?.patentable_flagged],
            ['Attachments', usage?.attachments],
          ].map(([label, value]) => (
            <div key={label} style={{
              background: 'var(--panel-bg)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 12px',
            }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--heading)' }}>{value ?? 0}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{label}</div>
            </div>
          ))}
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div>
            <Row label="Recorded savings" value={roiTotal ? money(roiTotal) : null} />
            <Row label="Last idea submitted" value={lastIdeaAt ? fmtDateTime(lastIdeaAt) : null} />
          </div>
          <div>
            <Row label="Sign-in activity" value={activity
              ? (activity.days_since_login == null
                  ? 'Never signed in'
                  : `${activity.days_since_login} day(s) ago`)
              : null} />
            <Row label="Failed QCMS pushes" value={usage?.qcms_failed ? String(usage.qcms_failed) : '0'} />
          </div>
        </div>
      </Card>

      {/* ── The company ─────────────────────────────────────────────── */}
      <Card title="Company details" info="registration_queue">
        {!r ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            This organisation was created directly by IFQM rather than from an application, so there
            are no registration details on file.
          </div>
        ) : (
          <div className="form-row" style={{ gap: 24 }}>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                            color: 'var(--subtle)', fontWeight: 700, margin: '4px 0 6px' }}>
                Statutory identity
              </div>
              <Row label="Registered name" value={r.company_name} />
              <Row label="Udyam number" value={r.udyam_number} mono />
              <Row label="GSTIN" value={r.gstin} mono />
              <Row label="Business PAN" value={r.pan} mono />
              <Row label="CIN" value={r.cin} mono />
              <Row label="Entity type" value={ENTITY_LABEL[r.entity_type] || r.entity_type} />
              <Row label="MSME category" value={CATEGORY_LABEL[r.enterprise_category] || r.enterprise_category} />

              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                            color: 'var(--subtle)', fontWeight: 700, margin: '16px 0 6px' }}>
                Business profile
              </div>
              <Row label="Sector" value={r.sector} />
              <Row label="NIC activity code" value={r.nic_code} mono />
              <Row label="Employees (declared)" value={r.employee_count} />
              <Row label="Annual turnover" value={TURNOVER_LABEL[r.annual_turnover_band] || r.annual_turnover_band} />
              <Row label="Year established" value={r.year_established} />
              <Row label="Website" value={r.website} />
            </div>

            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                            color: 'var(--subtle)', fontWeight: 700, margin: '4px 0 6px' }}>
                Registered address
              </div>
              <Row label="Address" value={r.address_line} />
              <Row label="City" value={r.city} />
              <Row label="State" value={r.state} />
              <Row label="PIN code" value={r.pincode} mono />
              <Row label="Country" value={r.country} />

              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                            color: 'var(--subtle)', fontWeight: 700, margin: '16px 0 6px' }}>
                Who applied
              </div>
              <Row label="Name" value={r.contact_name} />
              <Row label="Designation" value={r.contact_designation} />
              <Row label="Work email" value={r.contact_email} />
              <Row label="Phone" value={r.contact_phone} />
              <Row label="Email domain" value={r.email_domain} mono />

              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                            color: 'var(--subtle)', fontWeight: 700, margin: '16px 0 6px' }}>
                Application
              </div>
              <Row label="Applied on" value={fmtDateTime(r.created_at)} />
              <Row label="Reviewed on" value={r.reviewed_at ? fmtDateTime(r.reviewed_at) : null} />
              <Row label="Trial granted" value={r.assigned_trial_days != null
                ? `${r.assigned_trial_days} day(s)` : null} />
              <Row label="Applied from" value={r.submitted_ip} mono />
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
