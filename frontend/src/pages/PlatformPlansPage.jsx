import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi, saveBlob } from '../services/api';
import { fmtDate } from '../utils/helpers';
import InfoDot from '../components/InfoDot';

/*
 * The plan catalogue — what IFQM sells.
 *
 * Prices are typed and shown in rupees; the server keeps them in paise. That is
 * not pedantry: ₹2,500.10 has no exact form as a decimal number, and the error
 * compounds the moment 18% tax is applied to it. The conversion happens once,
 * at the boundary, so nothing in between can drift.
 */

const CYCLES = [
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['half_yearly', 'Half-yearly'],
  ['yearly', 'Yearly (1 year)'],
  ['one_time', 'One-time'],
];
const TIERS = [
  ['trial', 'Trial'],
  ['starter', 'Starter'],
  ['professional', 'Professional'],
  ['enterprise', 'Enterprise'],
  ['custom', 'Custom'],
];
const SUPPORT = [
  ['basic', 'Basic'],
  ['standard', 'Standard'],
  ['priority', 'Priority'],
  ['dedicated', 'Dedicated'],
];

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const BLANK = {
  code: '', name: '', description: '', long_description: '', tier: 'starter',
  amount_rupees: '', billing_cycle: 'yearly', gst_percent: '18', gst_mode: 'included',
  is_custom: false, max_users: '', max_departments: '', storage_gb: '',
  support_level: 'standard', status: 'active',
};

/* A four-step configurator, because a plan has four unrelated kinds of decision
   in it and one long form makes people miss the ones that matter. */
const STEPS = ['Info', 'Pricing', 'Limits', 'Review'];

function PlanConfigurator({ plan, onClose, onSaved }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const editing = !!plan;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState(BLANK);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!plan) { setForm(BLANK); return; }
    setForm({
      code: plan.code || '', name: plan.name || '', description: plan.description || '',
      long_description: plan.long_description || '', tier: plan.tier || 'starter',
      amount_rupees: String(plan.amount_rupees ?? ''), billing_cycle: plan.billing_cycle || 'yearly',
      gst_percent: String(plan.gst_percent ?? '18'), gst_mode: plan.gst_mode || 'included',
      is_custom: !!plan.is_custom,
      max_users: plan.max_users == null ? '' : String(plan.max_users),
      max_departments: plan.max_departments == null ? '' : String(plan.max_departments),
      storage_gb: plan.storage_gb == null ? '' : String(plan.storage_gb),
      support_level: plan.support_level || 'standard', status: plan.status || 'active',
    });
  }, [plan?.id]);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    setError('');
  };

  /* Shown live on the pricing step, because "GST included or excluded" is an
     18% difference and nobody should have to work it out in their head. */
  const preview = (() => {
    const amount = Number(String(form.amount_rupees).replace(/[^0-9.]/g, '')) || 0;
    const rate = Number(form.gst_percent) || 0;
    if (!amount || !rate) return { base: amount, gst: 0, total: amount };
    if (form.gst_mode === 'included') {
      const base = amount / (1 + rate / 100);
      return { base, gst: amount - base, total: amount };
    }
    return { base: amount, gst: amount * (rate / 100), total: amount + amount * (rate / 100) };
  })();

  function next() {
    if (step === 0) {
      if (!form.name.trim()) return setError('Give the plan a name.');
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(form.code.trim())) {
        return setError('Plan code must be 2-40 characters: letters, numbers, hyphen or underscore.');
      }
      if (!form.description.trim()) return setError('Write one line describing who this plan is for.');
    }
    if (step === 1) {
      const amount = Number(String(form.amount_rupees).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(amount) || amount < 0) return setError('Enter the plan amount in rupees.');
      const gst = Number(form.gst_percent);
      if (!Number.isFinite(gst) || gst < 0 || gst > 100) return setError('GST must be between 0 and 100.');
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function save() {
    if (!confirm) return setError('Tick the confirmation before saving.');
    setBusy(true); setError('');
    try {
      const payload = { ...form, is_custom: form.is_custom ? 1 : 0 };
      const res = editing
        ? await platformApi.updatePlan(plan.id, payload)
        : await platformApi.createPlan(payload);
      if (res.data.success) {
        showToast(res.data.message || 'Plan saved.', 'success');
        onSaved();
      } else setError(res.data.error || t('msg.server_error'));
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.network_error'));
    }
    setBusy(false);
  }

  const Field = ({ label, children, hint, required }) => (
    <div className="form-group">
      <label>{label}{required && <span style={{ color: 'var(--danger)', marginLeft: 3 }}>*</span>}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>{hint}</div>}
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>{editing ? `Edit ${plan.name}` : 'New Plan'}</h3>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          {/* Step rail */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
            {STEPS.map((label, i) => (
              <div key={label} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', margin: '0 auto 5px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: i <= step ? 'var(--primary)' : 'var(--chip-bg)',
                  color: i <= step ? '#fff' : 'var(--text-muted)',
                }}>{i + 1}</div>
                <div style={{
                  fontSize: 12, fontWeight: i === step ? 700 : 500,
                  color: i === step ? 'var(--primary)' : 'var(--text-muted)',
                }}>{label}</div>
                <div style={{
                  height: 2, marginTop: 6,
                  background: i <= step ? 'var(--primary)' : 'var(--border)',
                }} />
              </div>
            ))}
          </div>

          {error && <div className="alert alert-danger">{error}</div>}

          {step === 0 && (
            <>
              <div className="form-row">
                <Field label="Plan name" required>
                  <input className="form-control" value={form.name} onChange={set('name')}
                    placeholder="e.g. Starter, Growth" />
                </Field>
                <Field label="Plan code" required hint="Short, unique. Used in exports and conversation.">
                  <input className="form-control" value={form.code} onChange={set('code')}
                    placeholder="e.g. STARTER" style={{ textTransform: 'uppercase' }}
                    disabled={editing} />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Plan tier">
                  <select className="form-control" value={form.tier} onChange={set('tier')}>
                    {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select className="form-control" value={form.status} onChange={set('status')}>
                    <option value="active">Active</option>
                    <option value="inactive">Retired</option>
                  </select>
                </Field>
              </div>
              <Field label="Short description" required hint="One line an approver reads when choosing a plan.">
                <input className="form-control" value={form.description} onChange={set('description')}
                  placeholder="e.g. For a single plant getting started" />
              </Field>
              <Field label="Long description">
                <textarea className="form-control" rows="3" value={form.long_description}
                  onChange={set('long_description')} placeholder="Anything the sales conversation needs." />
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <div className="form-row">
                <Field label="Plan amount (₹)" required>
                  <input className="form-control" value={form.amount_rupees} onChange={set('amount_rupees')}
                    placeholder="0" inputMode="decimal" />
                </Field>
                <Field label="Billing cycle" required>
                  <select className="form-control" value={form.billing_cycle} onChange={set('billing_cycle')}>
                    {CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="GST percentage (%)"><InfoDot term="gst_mode" />
                <input className="form-control" value={form.gst_percent} onChange={set('gst_percent')}
                  style={{ maxWidth: 160 }} inputMode="decimal" />
              </Field>

              <div className="form-group">
                <label>GST treatment<InfoDot term="gst_mode" /></label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, cursor: 'pointer' }}>
                  <input type="radio" checked={form.gst_mode === 'included'}
                    onChange={() => setForm((f) => ({ ...f, gst_mode: 'included' }))} />
                  GST is already in the amount above
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, cursor: 'pointer' }}>
                  <input type="radio" checked={form.gst_mode === 'excluded'}
                    onChange={() => setForm((f) => ({ ...f, gst_mode: 'excluded' }))} />
                  GST is added on top of the amount above
                </label>
              </div>

              {/* An 18% mistake is easy to make and hard to spot, so the split is
                  shown live rather than left to be worked out. */}
              <div style={{
                background: 'var(--panel-bg)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '10px 14px', fontSize: 13, marginTop: 4,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Base</span><strong>{money(preview.base)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>GST @ {form.gst_percent || 0}%</span>
                  <strong>{money(preview.gst)}</strong>
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6,
                  borderTop: '1px solid var(--border)',
                }}>
                  <span style={{ fontWeight: 700 }}>The organisation pays</span>
                  <strong style={{ color: 'var(--primary)' }}>{money(preview.total)}</strong>
                </div>
              </div>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_custom} onChange={set('is_custom')} />
                <span>Custom plan — quoted privately, hidden from any public price list</span>
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
                Leave a box empty for no limit. Zero is a real limit meaning nobody may join, which is
                almost never what is meant.
              </div>
              <div className="form-row">
                <Field label="Maximum users" hint="Empty = unlimited">
                  <input className="form-control" value={form.max_users} onChange={set('max_users')}
                    placeholder="Unlimited" inputMode="numeric" />
                </Field>
                <Field label="Storage limit (GB)" hint="Empty = unlimited">
                  <input className="form-control" value={form.storage_gb} onChange={set('storage_gb')}
                    placeholder="Unlimited" inputMode="numeric" />
                </Field>
              </div>
              <div className="form-row">
                <Field label="Maximum departments" hint="Empty = unlimited">
                  <input className="form-control" value={form.max_departments} onChange={set('max_departments')}
                    placeholder="Unlimited" inputMode="numeric" />
                </Field>
                <Field label="Support level">
                  <select className="form-control" value={form.support_level} onChange={set('support_level')}>
                    {SUPPORT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div style={{
                background: 'var(--panel-bg)', border: '1px solid var(--border)',
                borderRadius: 10, padding: 16,
              }}>
                {[
                  ['Plan name', `${form.name} (${form.code.toUpperCase()})`],
                  ['Tier', TIERS.find(([v]) => v === form.tier)?.[1]],
                  ['Amount', money(preview.total)],
                  ['GST', `${form.gst_percent}% ${form.gst_mode === 'included' ? 'included' : 'added on top'}`],
                  ['Billing cycle', CYCLES.find(([v]) => v === form.billing_cycle)?.[1]],
                  ['Maximum users', form.max_users === '' ? 'Unlimited' : form.max_users],
                  ['Storage', form.storage_gb === '' ? 'Unlimited' : `${form.storage_gb} GB`],
                  ['Support', SUPPORT.find(([v]) => v === form.support_level)?.[1]],
                  ['Status', form.status === 'active' ? 'Active' : 'Retired'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
                    <strong style={{ fontSize: 13 }}>{value}</strong>
                  </div>
                ))}
              </div>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 14, cursor: 'pointer' }}>
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)}
                  style={{ marginTop: 3 }} />
                <span style={{ fontSize: 13 }}>
                  I confirm this plan configuration. Organisations put on this plan will be charged
                  {' '}<strong>{money(preview.total)}</strong> per {CYCLES.find(([v]) => v === form.billing_cycle)?.[1].toLowerCase()}.
                </span>
              </label>
            </>
          )}
        </div>

        <div className="modal-footer">
          {step > 0
            ? <button className="btn btn-outline" onClick={() => setStep((s) => s - 1)}>← Prev</button>
            : <button className="btn btn-outline" onClick={onClose}>Cancel</button>}
          {step < STEPS.length - 1
            ? <button className="btn btn-primary" onClick={next}>Next →</button>
            : <button className="btn btn-primary" disabled={busy || !confirm} onClick={save}>
                {busy ? 'Saving…' : 'Save plan configuration'}
              </button>}
        </div>
      </div>
    </div>
  );
}

export default function PlatformPlansPage() {
  const { t } = useLang();
  const { showToast } = useToast();

  const [plans, setPlans] = useState([]);
  const [counts, setCounts] = useState({ total: 0, active: 0, inactive: 0, custom: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cycle, setCycle] = useState('');
  const [editing, setEditing] = useState(undefined);   // undefined = closed, null = new

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await platformApi.plans();
      if (res.data.success) {
        setPlans(res.data.plans || []);
        setCounts(res.data.counts || {});
      } else setError(res.data.error || t('msg.fail_load'));
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.fail_load'));
    }
    setLoading(false);
  }

  async function retire(plan) {
    if (!window.confirm(
      `Retire "${plan.name}"?\n\nIt disappears from the list an approver picks from. `
      + `Organisations already on it stay on it, and nothing about their billing changes.`
    )) return;
    try {
      const res = await platformApi.retirePlan(plan.id);
      if (res.data.success) { showToast(res.data.message, 'success'); load(); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
  }

  function exportCsv() {
    const cols = ['code', 'name', 'tier', 'amount_rupees', 'gst_percent', 'gst_mode',
      'billing_cycle', 'max_users', 'storage_gb', 'support_level', 'subscriber_count', 'status'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...filtered.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'ifqm-plans.csv');
  }

  const filtered = plans.filter((p) => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || [p.name, p.code, p.description].some((v) => String(v || '').toLowerCase().includes(q));
    return matchQ && (!status || p.status === status) && (!cycle || p.billing_cycle === cycle);
  });

  const kpis = [
    ['Total plans', counts.total, 'var(--primary)', 'var(--primary-light)'],
    ['Active', counts.active, 'var(--success)', 'var(--success-light)'],
    ['Retired', counts.inactive, 'var(--warning)', 'var(--warning-light)'],
    ['Custom', counts.custom, 'var(--info)', 'var(--info-light)'],
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--heading)', margin: 0, letterSpacing: '-.5px' }}>
            Plan Definitions
          </h1>
          <div style={{ fontSize: 13, color: 'var(--subtle)', marginTop: 4 }}>
            What IFQM charges, and what each plan includes.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={load}>{t('btn.refresh')}</button>
          <button className="btn btn-outline" onClick={exportCsv} disabled={!filtered.length}>
            Export catalogue
          </button>
          <button className="btn btn-primary" onClick={() => setEditing(null)}>+ New plan</button>
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map(([label, val, color, bg]) => (
          <div className="card kpi-card" key={label}>
            <div className="kpi-icon" style={{ background: bg, color }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
            <div>
              <div className="kpi-value" style={{ color }}>{val ?? 0}</div>
              <div className="kpi-label">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="form-control" style={{ flex: '1 1 240px', minWidth: 200 }}
          placeholder="Search name, code or description…" value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <select className="form-control" style={{ width: 150 }} value={status}
          onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Retired</option>
        </select>
        <select className="form-control" style={{ width: 170 }} value={cycle}
          onChange={(e) => setCycle(e.target.value)}>
          <option value="">All cycles</option>
          {CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {(search || status || cycle) && (
          <button className="btn btn-outline btn-sm"
            onClick={() => { setSearch(''); setStatus(''); setCycle(''); }}>× Reset</button>
        )}
      </div>

      {error && <div className="alert alert-danger" style={{ marginTop: 14 }}>{error}</div>}

      <div className="card" style={{ marginTop: 18, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Code</th>
              <th>Price</th>
              <th>Billing cycle</th>
              <th>Max users</th>
              <th>Storage</th>
              <th>Organisations</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="9" className="text-center"><div className="spinner"></div></td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan="9" className="text-center">
                {plans.length ? 'No plan matches that.' : 'No plans yet. Create the first one.'}
              </td></tr>
            )}
            {!loading && filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <div style={{ fontWeight: 700, color: 'var(--heading)' }}>{p.name}</div>
                  <div className="cell-clamp" style={{ maxWidth: 240, fontSize: 11.5, color: 'var(--subtle)' }}
                    title={p.description || ''}>{p.description || '—'}</div>
                </td>
                <td><code style={{ fontSize: 12 }}>{p.code}</code></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <strong>{money(p.total_rupees)}</strong>
                  <div style={{ fontSize: 11, color: 'var(--subtle)' }}>
                    {p.gst_percent}% GST {p.gst_mode === 'included' ? 'incl.' : 'extra'}
                  </div>
                </td>
                <td style={{ fontSize: 12.5 }}>{p.cycle_label}</td>
                <td style={{ fontSize: 12.5 }}>{p.max_users_label}</td>
                <td style={{ fontSize: 12.5 }}>{p.storage_label}</td>
                <td>
                  <span className="badge badge-info">{p.subscriber_count || 0} org(s)</span>
                </td>
                <td>
                  <span className={`badge ${p.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                    {p.status === 'active' ? 'Active' : 'Retired'}
                  </span>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditing(p)}>Edit</button>
                  {p.status === 'active' && (
                    <button className="btn btn-outline btn-sm" style={{ marginLeft: 6 }}
                      onClick={() => retire(p)}>Retire</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 10 }}>
        Retiring a plan never deletes it. Organisations point at plans and their billing history refers
        to them, so a deleted plan would leave both without an answer.
      </div>

      {editing !== undefined && (
        <PlanConfigurator plan={editing} onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); load(); }} />
      )}
    </>
  );
}
