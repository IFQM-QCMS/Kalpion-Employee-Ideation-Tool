import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import { fmtDate } from '../utils/helpers';
import InfoDot from '../components/InfoDot';

/*
 * Platform → Payments.
 *
 * ── Why this page exists ───────────────────────────────────────────────────
 *
 * Every control here already existed, one drill-down deep inside a single
 * organisation's profile panel. That is the right place to change one
 * customer's terms and the wrong place to answer the questions the platform
 * team actually asks — who is about to lapse, who has never been given a plan,
 * what are we owed — because answering those meant opening every customer in
 * turn and remembering what you saw.
 *
 * The per-organisation panel is unchanged and still there. This is the view
 * across all of them, with the same actions available inline.
 *
 * ── One thing this page is careful not to claim ────────────────────────────
 *
 * The money figures are labelled as the recurring value of plans, not as
 * revenue. Nothing here takes payment or reconciles a bank statement — a
 * platform admin records that somebody paid. Reporting that as income would be
 * how a finance conversation goes wrong.
 */

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const FILTERS = [
  ['all', 'msgb.f_all'],
  ['no_plan', 'msgb.f_no_plan'],
  ['expiring', 'msgb.f_expiring'],
  ['lapsed', 'msgb.f_lapsed'],
  ['trial', 'msgb.f_trial'],
  ['paying', 'msgb.f_paying'],
];

/** How a billing state should read at a glance, and in what colour. */
function stateBadge(o, t) {
  const b = o.billing;
  if (o.status === 'suspended') return { label: t('msgb.s_on_hold'), cls: 'badge-rejected' };
  if (b.state === 'exempt') return { label: t('msgb.s_exempt'), cls: 'badge-draft' };
  if (b.blocked) return { label: t('msgb.s_lapsed'), cls: 'badge-rejected' };
  if (b.expiring_soon) return { label: t('msgb.s_expiring', { n: b.days_left }), cls: 'badge-review' };
  if (b.state === 'trial') return { label: t('msgb.s_trial', { n: b.days_left }), cls: 'badge-submitted' };
  if (b.state === 'active') return { label: t('msgb.s_paying', { n: b.days_left }), cls: 'badge-approved' };
  return { label: b.label, cls: 'badge-draft' };
}

function Stat({ label, value, tone, hint, accent = 'var(--primary)' }) {
  const colour = tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : 'var(--heading)';
  return (
    <div style={{
      flex: '1 1 130px', minWidth: 125, padding: '12px 14px', borderRadius: 10,
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderLeft: `4px solid ${tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warning)' : accent}`
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: colour, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, letterSpacing: '-.4px' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text)', marginTop: 4 }}>{label}</div>
      {hint ? <div style={{ fontSize: 10.5, color: 'var(--subtle)', marginTop: 3 }}>{hint}</div> : null}
    </div>
  );
}

export default function PlatformBillingPage() {
  const { t } = useLang();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);   // the org whose terms are open
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ov, pl] = await Promise.allSettled([
      platformApi.billingOverview(),
      platformApi.plans({ include_inactive: 0 }),
    ]);
    // allSettled, not all: a failure loading the plan catalogue must not leave
    // the whole page blank. An earlier screen in this console rendered "no
    // users" when its request 500'd, which read as an empty database.
    if (ov.status === 'fulfilled') setData(ov.value.data);
    else showToast(ov.reason?.response?.data?.error || t('msg.fail_load'), 'danger');
    if (pl.status === 'fulfilled') setPlans(pl.value.data.plans || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.organisations.filter((o) => {
      if (q && !(`${o.name} ${o.slug}`.toLowerCase().includes(q))) return false;
      const b = o.billing;
      if (filter === 'no_plan') return !o.plan;
      if (filter === 'expiring') return b.expiring_soon;
      if (filter === 'lapsed') return b.blocked || o.status === 'suspended';
      if (filter === 'trial') return b.state === 'trial';
      if (filter === 'paying') return b.state === 'active';
      return true;
    });
  }, [data, filter, search]);

  async function sweep(dryRun) {
    setBusy(true);
    try {
      const r = await platformApi.sweepBilling(dryRun);
      const d = r.data;
      showToast(dryRun
        ? t('msgb.sweep_dry', { checked: d.checked, lapsed: d.lapsed, held: d.held })
        : t('msgb.sweep_done', { lapsed: d.lapsed, held: d.held }), 'success');
      if (!dryRun) await load();
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function triggerMonthlyInvoices() {
    setBusy(true);
    try {
      const r = await platformApi.sendMonthlyInvoices();
      showToast(r.data.message || 'Monthly invoices sent.', 'success');
      await load();
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  if (!data) return <div className="empty-state"><div className="spinner"></div></div>;
  const s = data.summary;

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--heading)', margin: 0, letterSpacing: '-.5px' }}>
          {t('msgb.title')}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--subtle)', marginTop: 4 }}>{t('msgb.sub')}</div>
      </div>

      {/* ── Summary ───────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginBottom: 4 }}>
          <Stat label={t('msgb.st_orgs')} value={s.organisations} />
          <Stat label={t('msgb.st_paying')} value={s.paying} />
          <Stat label={t('msgb.st_trial')} value={s.on_trial} />
          <Stat label={t('msgb.st_expiring')} value={s.expiring_soon}
            tone={s.expiring_soon ? 'warn' : undefined} hint={t('msgb.st_expiring_hint', { n: s.warn_days })} />
          <Stat label={t('msgb.st_lapsed')} value={s.lapsed} tone={s.lapsed ? 'bad' : undefined} />
          <Stat label={t('msgb.st_no_plan')} value={s.no_plan} tone={s.no_plan ? 'bad' : undefined} />
          <Stat label={t('msgb.st_recurring')} value={money(s.recurring_paise / 100)}
            hint={t('msgb.st_recurring_hint')} />
          <Stat label={t('msgb.st_pipeline')} value={money(s.trial_pipeline_paise / 100)}
            hint={t('msgb.st_pipeline_hint')} />
        </div>
      </div>

      {s.no_plan > 0 && (
        <div style={{
          background: 'var(--warning-light)', color: 'var(--warning)', border: '1px solid var(--warning)',
          borderRadius: 8, padding: '11px 13px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 16,
        }}>
          <b>{t('msgb.warn_no_plan', { n: s.no_plan })}</b> {t('msgb.warn_no_plan_hint')}
        </div>
      )}

      {!s.enforce && (
        <div style={{
          background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '11px 13px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 16, color: 'var(--text-muted)',
        }}>
          {t('msgb.enforce_off')}
        </div>
      )}

      <GatewayPanel />

      {/* ── Controls ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div className="tab-bar" style={{ marginBottom: 0, flex: '1 1 auto' }}>
          {FILTERS.map(([key, label]) => (
            <div key={key} className={`tab${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
              {t(label)}
            </div>
          ))}
        </div>
        <input className="form-control" style={{ maxWidth: 220 }} value={search}
          placeholder={t('msgb.search')} onChange={(e) => setSearch(e.target.value)} />
        <button className="btn btn-primary" disabled={busy} onClick={triggerMonthlyInvoices}>
          Send Monthly Invoices
        </button>
        <button className="btn" disabled={busy} onClick={() => sweep(true)} title={t('msgb.sweep_dry_hint')}>
          {t('msgb.sweep_preview')}
        </button>
        <button className="btn" disabled={busy} onClick={() => sweep(false)}>{t('msgb.sweep_run')}</button>
      </div>

      {/* ── The organisations ─────────────────────────────────────── */}
      <div className="card">
        {rows.length === 0 ? (
          <div className="empty-state">{t('msgb.none')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>{t('msgb.c_org')}</th>
                  <th>{t('msgb.c_plan')}</th>
                  <th style={{ textAlign: 'right' }}>{t('msgb.c_amount')}</th>
                  <th>{t('msgb.c_state')}</th>
                  <th>{t('msgb.c_until')}</th>
                  <th>{t('msgb.c_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const badge = stateBadge(o, t);
                  const until = o.billing.ends_at || o.billing.trial_ends_at || o.billing.period_end;
                  return (
                    <tr key={o.id}>
                      <td>
                        <button className="btn-link" onClick={() => navigate(`/platform/tenants/${o.id}`)}
                          style={{
                            background: 'none', border: 0, padding: 0, cursor: 'pointer',
                            color: 'var(--primary)', fontWeight: 600, textAlign: 'left',
                          }}>
                          {o.name}
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--subtle)' }}>{o.slug}</div>
                      </td>
                      <td>
                        {o.plan ? (
                          <>
                            {o.plan.name}
                            <div style={{ fontSize: 11, color: 'var(--subtle)' }}>{o.plan.cycle_label}</div>
                          </>
                        ) : (
                          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('msgb.no_plan')}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {o.plan ? money(o.plan.total_rupees) : '—'}
                      </td>
                      <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{until ? fmtDate(until) : '—'}</td>
                      <td>
                        <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => setEditing(o)}>
                          {t('msgb.manage')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <TermsModal
          org={editing}
          plans={plans}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </>
  );
}

/**
 * The Razorpay merchant account.
 *
 * Platform-wide, not per organisation: IFQM holds one account and every
 * customer pays into it. Turning it on is what puts a Pay button on every org
 * admin's billing page, which is why enabling it is refused while the keys are
 * incomplete — a Pay button that opens a checkout and fails is worse than none,
 * because the customer has then tried to pay and believes the fault is theirs.
 *
 * The key SECRET is never sent to this browser. The Key ID is, deliberately:
 * Razorpay's checkout script needs it, and it is public by design.
 */
function GatewayPanel() {
  const { t } = useLang();
  const { showToast } = useToast();
  const [g, setG] = useState(null);
  const [open, setOpen] = useState(false);
  const [keyId, setKeyId] = useState('');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await platformApi.gateway();
      setG(r.data);
      setKeyId(r.data.key_id || '');
      setName(r.data.business_name || '');
      setSecret('');
    } catch { /* the page still works without it */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!g) return null;

  const status = !g.enabled ? { label: t('msgb.g_off'), cls: 'badge-draft' }
    : g.missing.length ? { label: t('msgb.st_incomplete'), cls: 'badge-rejected' }
      : { label: t('msgb.g_live', { mode: g.mode }), cls: g.mode === 'live' ? 'badge-approved' : 'badge-review' };

  async function save(enabled) {
    setBusy(true);
    try {
      const body = { key_id: keyId.trim(), business_name: name.trim(), enabled };
      if (secret.trim()) body.key_secret = secret.trim();
      const r = await platformApi.updateGateway(body);
      setG(r.data); setSecret('');
      showToast(t('msgb.g_saved'), 'success');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    try {
      const r = await platformApi.testGateway();
      showToast(r.data.detail, r.data.ok ? 'success' : 'danger');
      await load();
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--heading)' }}>{t('msgb.g_title')}</span>
        <span className={`badge ${status.cls}`}>{status.label}</span>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? t('msgb.g_hide') : t('msgb.g_configure')}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 6, lineHeight: 1.6 }}>
        {g.enabled && !g.missing.length ? t('msgb.g_on_hint') : t('msgb.g_off_hint')}
      </div>

      {open && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="form-row">
            <div className="form-group">
              <label>{t('msgb.g_key_id')}</label>
              <input className="form-control" value={keyId} placeholder="rzp_test_xxxxxxxxxxxx"
                onChange={(e) => setKeyId(e.target.value)} />
              <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 5, lineHeight: 1.5 }}>
                {t('msgb.g_key_id_hint')}
              </div>
            </div>
            <div className="form-group">
              <label>{t('msgb.g_secret')}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="form-control" type={showSecret ? 'text' : 'password'}
                  value={secret} autoComplete="new-password"
                  placeholder={g.key_secret_set ? '••••••••••••' : t('msgb.g_secret_ph')}
                  onChange={(e) => setSecret(e.target.value)} />
                <button type="button" className="btn" style={{ flex: '0 0 auto' }}
                  onClick={() => setShowSecret((v) => !v)}>{showSecret ? '🙈' : '👁'}</button>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 5, lineHeight: 1.5 }}>
                {g.key_secret_set ? t('msgb.g_secret_stored') : t('msgb.g_secret_none')}
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>{t('msgb.g_business')}</label>
            <input className="form-control" style={{ maxWidth: 320 }} value={name}
              onChange={(e) => setName(e.target.value)} />
            <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 5 }}>
              {t('msgb.g_business_hint')}
            </div>
          </div>

          {g.missing.length > 0 && (
            <div style={{
              background: 'var(--warning-light)', color: 'var(--warning)', border: '1px solid var(--warning)',
              borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 14, lineHeight: 1.6,
            }}>
              <b>{t('msgb.incomplete')}</b> {g.missing.join(' · ')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => save(g.enabled)}>
              {t('msgb.g_save')}
            </button>
            <button className="btn" disabled={busy} onClick={test}>{t('msgb.g_test')}</button>
            <button className="btn" disabled={busy} onClick={() => save(!g.enabled)}>
              {g.enabled ? t('msgb.g_disable') : t('msgb.g_enable')}
            </button>
          </div>

          {g.last_test?.at && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--subtle)' }}>
              {t('msgg.last_tested')}: {fmtDate(g.last_test.at)} — {g.last_test.ok ? t('msgg.passed') : t('msgg.failed')}
              {g.last_test.note ? ` (${g.last_test.note})` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Set one organisation's terms without leaving the list.
 *
 * The three actions are kept as three buttons rather than one Save, because
 * they are genuinely three decisions with three different consequences —
 * changing the plan, changing how long the free evaluation runs, and recording
 * that money arrived. Collapsing them into one form would make it possible to
 * record a payment as a side effect of correcting a typo in a plan.
 */
function TermsModal({ org, plans, onClose, onSaved }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [planId, setPlanId] = useState(org.plan?.id ? String(org.plan.id) : '');
  const [trialDays, setTrialDays] = useState(String(org.billing.trial_days ?? ''));
  const [periods, setPeriods] = useState('1');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn, okMsg) {
    setBusy(true);
    try {
      const r = await fn();
      if (r.data.success) { showToast(okMsg, 'success'); await onSaved(); }
      else showToast(r.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  const chosen = plans.find((p) => String(p.id) === planId);

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 200,
        display: 'grid', placeItems: 'center', padding: 16,
      }}>
      <div className="card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 540, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--heading)' }}>{org.name}</div>
            <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 2 }}>
              {org.slug} · {org.billing.label}
            </div>
          </div>
          <button className="btn" onClick={onClose} style={{ padding: '4px 10px' }}>✕</button>
        </div>

        <div className="form-group">
          <label>{t('msgb.m_plan')}<InfoDot term="billing_status" /></label>
          <select className="form-control" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">{t('msgb.m_plan_none')}</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {money(p.total_rupees)} {p.cycle_label}
              </option>
            ))}
          </select>
          {chosen && (
            <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 6, lineHeight: 1.5 }}>
              {t('msgb.m_plan_hint', {
                base: money(chosen.base_rupees), gst: money(chosen.gst_rupees),
                total: money(chosen.total_rupees), users: chosen.max_users || '—',
              })}
            </div>
          )}
        </div>

        <button className="btn btn-primary" disabled={busy || !planId} style={{ marginBottom: 20 }}
          onClick={() => run(
            () => platformApi.assignPlan(org.id, { plan_id: Number(planId), note }),
            t('msgb.m_plan_saved'))}>
          {t('msgb.m_plan_btn')}
        </button>

        <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <label>{t('msgb.m_trial')}<InfoDot term="trial_days" /></label>
          <input className="form-control" type="number" min="0" max="365" value={trialDays}
            style={{ maxWidth: 160 }} onChange={(e) => setTrialDays(e.target.value)} />
        </div>
        <button className="btn" disabled={busy} style={{ marginBottom: 20 }}
          onClick={() => run(
            () => platformApi.setTrial(org.id, { trial_days: Number(trialDays), note }),
            t('msgb.m_trial_saved'))}>
          {t('msgb.m_trial_btn')}
        </button>

        <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <label>{t('msgb.m_paid')}</label>
          <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginBottom: 8, lineHeight: 1.5 }}>
            {t('msgb.m_paid_hint')}
          </div>
          <input className="form-control" type="number" min="1" max="24" value={periods}
            style={{ maxWidth: 160 }} onChange={(e) => setPeriods(e.target.value)} />
        </div>

        <div className="form-group">
          <label>{t('msgb.m_note')}</label>
          <input className="form-control" value={note} placeholder={t('msgb.m_note_ph')}
            onChange={(e) => setNote(e.target.value)} />
        </div>

        <button className="btn btn-primary" disabled={busy || !org.plan}
          onClick={() => run(
            () => platformApi.markPaid(org.id, { periods: Number(periods), note }),
            t('msgb.m_paid_saved'))}>
          {t('msgb.m_paid_btn')}
        </button>
        {!org.plan && (
          <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 8 }}>
            {t('msgb.m_paid_needs_plan')}
          </div>
        )}
      </div>
    </div>
  );
}
