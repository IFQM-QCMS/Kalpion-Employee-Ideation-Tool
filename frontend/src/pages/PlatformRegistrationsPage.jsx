import { useState, useEffect, useMemo } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import InfoDot from '../components/InfoDot';

/*
  Platform → Registrations.

  The review queue used to be a strip on the Organisations dashboard, which was
  the wrong home for it: approving one provisions a live tenant, and the operator
  making that call needs every field the applicant submitted in front of them —
  statutory identifiers, scale, location, who is asking — not a four-line
  summary next to a donut chart.

  So: its own screen, every field on show, grouped the way the applicant
  entered them, with the decision controls next to the evidence.
*/

const TABS = [
  ['pending', 'pa.reg_tab_pending'],
  ['approved', 'pa.reg_tab_approved'],
  ['rejected', 'pa.reg_tab_rejected'],
  ['', 'pa.reg_tab_all'],
];

const ENTITY_LABEL = {
  proprietorship: 'Sole proprietorship', partnership: 'Partnership firm', llp: 'LLP',
  private_limited: 'Private limited company', public_limited: 'Public limited company',
  cooperative: 'Co-operative society', trust: 'Trust', society: 'Society', other: 'Other',
};
const TURNOVER_LABEL = {
  under_50l: 'Under ₹50 lakh', '50l_2cr': '₹50 lakh – ₹2 crore', '2cr_10cr': '₹2 – 10 crore',
  '10cr_50cr': '₹10 – 50 crore', '50cr_250cr': '₹50 – 250 crore', above_250cr: 'Above ₹250 crore',
};
const STATUS_TONE = {
  pending: { bg: 'var(--warning-light)', fg: 'var(--warning)' },
  approved: { bg: 'var(--success-light)', fg: 'var(--success)' },
  rejected: { bg: 'var(--danger-light)', fg: 'var(--danger)' },
};

/** A labelled value. Renders an em dash rather than vanishing, so a reviewer can
    see what the applicant chose to leave blank — that is itself information. */
function Field({ label, value, mono = false, info = null }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.06em',
                    color: 'var(--subtle)', fontWeight: 700, marginBottom: 2 }}>{label}{info && <InfoDot term={info} />}</div>
      <div style={{ fontSize: 13, color: empty ? 'var(--subtle)' : 'var(--text)',
                    fontFamily: mono && !empty ? 'ui-monospace,SFMono-Regular,Menlo,monospace' : 'inherit',
                    wordBreak: 'break-word' }}>
        {empty ? '—' : value}
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase',
                    color: 'var(--primary)', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

export default function PlatformRegistrationsPage() {
  const { t } = useLang();
  const { showToast } = useToast();

  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [approving, setApproving] = useState(null);
  const [issued, setIssued] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const res = await platformApi.registrations(tab);
      if (res.data.success) {
        setRows(res.data.registrations || []);
        setCounts(res.data.counts || { pending: 0, approved: 0, rejected: 0 });
      }
    } catch {
      showToast(t('msg.network_error'), 'danger');
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.company_name, r.contact_name, r.contact_email, r.email_domain,
      r.proposed_slug, r.gstin, r.udyam_number, r.city, r.state]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [rows, search]);

  /*
   * Approving no longer means typing an org code into a browser prompt.
   *
   * The plan and the trial length are decided at exactly this moment - the
   * approver has the company's size, turnover and sector in front of them,
   * which is what decides both. Asking later means somebody has to remember,
   * and an organisation with no plan has no end date, so it would never lapse
   * and never be billed.
   */
  function openApproval(reg) {
    setApproving(reg);
  }

  async function submitApproval({ slug, planId, trialDays, note }) {
    setBusy(true);
    try {
      const res = await platformApi.approveRegistration(approving.id, {
        slug: String(slug).trim().toLowerCase(),
        plan_id: planId || null,
        trial_days: trialDays,
        billing_note: note || '',
      });
      if (res.data.success) {
        setIssued({ email: res.data.admin_email, password: res.data.temp_password, slug: res.data.slug });
        setApproving(null);
        await load();
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function reject(reg) {
    const note = window.prompt(t('pa.reg_reject_prompt'), '');
    if (note === null) return;
    setBusy(true);
    try {
      const res = await platformApi.rejectRegistration(reg.id, note);
      if (res.data.success) { showToast(t('pa.reg_rejected_ok'), 'success'); await load(); }
      else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (e) {
      showToast(e?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  const fmt = (d) => (d ? new Date(d).toLocaleString() : null);

  return (
    <>
      {/* One-time credential. Deliberately not a toast: it must stay on screen
          until the operator has copied it, because it cannot be shown again. */}
      {approving && (
        <ApprovalDialog reg={approving} busy={busy}
          onClose={() => setApproving(null)} onSubmit={submitApproval} />
      )}

      {issued && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {t('pa.reg_temp_pw').replace('{email}', issued.email)}
          </div>
          <code style={{ display: 'inline-block', background: 'var(--chip-bg)', border: '1px solid var(--border)',
                         borderRadius: 8, padding: '8px 12px', fontSize: 14, fontWeight: 700, userSelect: 'all' }}>
            {issued.password}
          </code>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            {t('pa.reg_temp_pw_note').replace('{slug}', issued.slug)}
          </div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }}
            onClick={() => setIssued(null)}>{t('btn.close') || 'Close'}</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ margin: '0 0 4px' }}>{t('pa.reg_title')}<InfoDot term="registration_queue" /></div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>{t('pa.reg_sub')}</p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="chip-filter" style={{ margin: 0 }}>
            {TABS.map(([val, key]) => (
              <div key={val || 'all'} className={`chip${tab === val ? ' active' : ''}`} onClick={() => setTab(val)}>
                {t(key)}
                {val === 'pending' && counts.pending > 0 && (
                  <span style={{ marginLeft: 6, background: 'var(--primary)', color: 'var(--on-primary)',
                                 borderRadius: 999, padding: '0 6px', fontSize: 10.5, fontWeight: 800 }}>
                    {counts.pending}
                  </span>
                )}
              </div>
            ))}
          </div>
          <input className="form-control" type="search" placeholder={t('pa.reg_search')}
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280, marginLeft: 'auto' }} />
        </div>
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div></div>}

      {!loading && !filtered.length && (
        <div className="card"><div className="empty-state">{t('pa.reg_none')}</div></div>
      )}

      {!loading && filtered.map((r) => {
        const tone = STATUS_TONE[r.status] || STATUS_TONE.pending;
        const open = openId === r.id;
        return (
          <div className="card" key={r.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap',
                          alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 750, fontSize: 15.5, color: 'var(--heading)' }}>{r.company_name}</span>
                  <span style={{ background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 750,
                                 padding: '3px 9px', borderRadius: 999, textTransform: 'uppercase' }}>
                    {r.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 3 }}>
                  REG-{r.id} · {r.contact_name} · {r.contact_email} · {t('pa.reg_applied')} {fmt(r.created_at)}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-outline btn-sm" onClick={() => setOpenId(open ? null : r.id)}>
                  {open ? t('pa.reg_hide') : t('pa.reg_details')}
                </button>
                {r.status === 'pending' && (
                  <>
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => reject(r)}>
                      {t('pa.reg_reject')}
                    </button>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => openApproval(r)}>
                      {t('pa.reg_approve')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Decision trail for anything already handled. */}
            {r.status !== 'pending' && (r.reviewed_at || r.review_note || r.tenant_slug) && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                {r.reviewed_at && <span>{t('pa.reg_reviewed')} {fmt(r.reviewed_at)}</span>}
                {r.tenant_slug && <span> · {t('pa.reg_became')} <b>{r.tenant_slug}</b></span>}
                {r.review_note && <div style={{ marginTop: 4 }}>{t('pa.reg_note')}: {r.review_note}</div>}
              </div>
            )}

            {open && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                <Group title={t('pa.reg_g_org')}>
                  <Field label={t('pa.reg_f_company')} value={r.company_name} />
                  <Field label={t('pa.reg_f_slug')} value={r.proposed_slug} mono />
                  <Field label={t('pa.reg_f_domain')} value={r.email_domain} mono />
                  <Field label={t('pa.reg_f_website')} value={r.website
                    ? <a href={r.website} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--primary)' }}>{r.website}</a>
                    : ''} />
                  <Field label={t('pa.reg_f_established')} value={r.year_established} />
                </Group>

                <Group title={t('pa.reg_g_statutory')}>
                  <Field label={t('pa.reg_f_udyam')} value={r.udyam_number} mono info="udyam" />
                  <Field label={t('pa.reg_f_gstin')} value={r.gstin} mono info="gstin" />
                  <Field label={t('pa.reg_f_pan')} value={r.pan} mono />
                  <Field label={t('pa.reg_f_cin')} value={r.cin} mono />
                  <Field label={t('pa.reg_f_entity')} value={ENTITY_LABEL[r.entity_type] || r.entity_type} />
                  <Field label={t('pa.reg_f_category')} value={r.enterprise_category
                    ? r.enterprise_category.charAt(0).toUpperCase() + r.enterprise_category.slice(1) : ''} />
                </Group>

                <Group title={t('pa.reg_g_profile')}>
                  <Field label={t('pa.reg_f_sector')} value={r.sector} />
                  <Field label={t('pa.reg_f_nic')} value={r.nic_code} mono info="nic_code" />
                  <Field label={t('pa.reg_f_employees')} value={r.employee_count} />
                  <Field label={t('pa.reg_f_turnover')}
                    value={TURNOVER_LABEL[r.annual_turnover_band] || r.annual_turnover_band} />
                </Group>

                <Group title={t('pa.reg_g_location')}>
                  <Field label={t('pa.reg_f_address')} value={r.address_line} />
                  <Field label={t('pa.reg_f_city')} value={r.city} />
                  <Field label={t('pa.reg_f_state')} value={r.state} />
                  <Field label={t('pa.reg_f_pincode')} value={r.pincode} mono />
                  <Field label={t('pa.reg_f_country')} value={r.country} />
                </Group>

                <Group title={t('pa.reg_g_contact')}>
                  <Field label={t('pa.reg_f_name')} value={r.contact_name} />
                  <Field label={t('pa.reg_f_designation')} value={r.contact_designation} />
                  <Field label={t('pa.reg_f_email')} value={r.contact_email} />
                  <Field label={t('pa.reg_f_phone')} value={r.contact_phone} />
                </Group>

                <Group title={t('pa.reg_g_meta')}>
                  <Field label={t('pa.reg_f_submitted')} value={fmt(r.created_at)} />
                  <Field label={t('pa.reg_f_ip')} value={r.submitted_ip} mono />
                  <Field label={t('pa.reg_f_consent')}
                    value={r.accepted_terms ? t('pa.reg_consent_yes') : t('pa.reg_consent_no')} />
                </Group>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/*
 * What happens when an application is approved: a workspace is provisioned, a
 * first administrator account is created, and the organisation goes onto a plan
 * with a trial. All three are decided here, together, because they are one
 * decision.
 */
function ApprovalDialog({ reg, busy, onClose, onSubmit }) {
  const { t } = useLang();
  const [slug, setSlug] = useState(reg.proposed_slug || '');
  const [planId, setPlanId] = useState('');
  const [trialDays, setTrialDays] = useState('');
  const [note, setNote] = useState('');
  const [plans, setPlans] = useState([]);
  const [defaultDays, setDefaultDays] = useState(14);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([platformApi.plans(), platformApi.getDefaults()]).then(([p, d]) => {
      if (cancelled) return;
      if (p.status === 'fulfilled' && p.value.data.success) {
        setPlans((p.value.data.plans || []).filter((x) => x.status === 'active'));
      }
      // The platform-wide default, so the common case needs no typing at all.
      if (d.status === 'fulfilled' && d.value.data.success) {
        const n = parseInt(d.value.data.defaults?.default_trial_days, 10);
        const days = Number.isFinite(n) ? n : 14;
        setDefaultDays(days);
        setTrialDays(String(days));
      } else setTrialDays('14');
    });
    return () => { cancelled = true; };
  }, []);

  function go() {
    if (!/^[a-z0-9][a-z0-9_-]{1,29}$/.test(String(slug).trim().toLowerCase())) {
      return setError('Organisation code must be 2-30 characters: lower-case letters, numbers, hyphen or underscore.');
    }
    const n = parseInt(trialDays, 10);
    if (!Number.isFinite(n) || n < 0 || n > 365) return setError('Trial days must be between 0 and 365.');
    setError('');
    onSubmit({ slug, planId, trialDays: n, note });
  }

  const chosen = plans.find((p) => String(p.id) === String(planId));

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Approve {reg.company_name}</h3>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}

          <div className="form-group">
            <label>Organisation code<InfoDot term="org_code" /></label>
            <input className="form-control" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>
              Their people will see this when they sign in. It cannot be changed casually afterwards.
            </div>
          </div>

          <div className="form-group">
            <label>Plan</label>
            <select className="form-control" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Decide later</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₹{Number(p.total_rupees).toLocaleString('en-IN')} {p.cycle_label.toLowerCase()}
                  {p.max_users_label !== 'Unlimited' ? ` · up to ${p.max_users_label} users` : ''}
                </option>
              ))}
            </select>
            {chosen?.description && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{chosen.description}</div>
            )}
          </div>

          <div className="form-group" style={{ maxWidth: 220 }}>
            <label>Free trial (days)<InfoDot term="trial_days" /></label>
            <input className="form-control" value={trialDays} inputMode="numeric"
              onChange={(e) => setTrialDays(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>
              Platform default is {defaultDays}. Enter 0 to start billing immediately.
            </div>
          </div>

          <div className="form-group">
            <label>Note (optional)</label>
            <input className="form-control" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="What was agreed on the call" />
          </div>

          <div style={{
            background: 'var(--panel-bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: 'var(--text-muted)',
          }}>
            Approving creates the workspace and a first administrator account for{' '}
            <strong>{reg.contact_name}</strong> ({reg.contact_email}). The temporary password is shown
            once, on the next screen — it is never retrievable afterwards.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" disabled={busy} onClick={go}>
            {busy ? 'Creating…' : 'Approve and create workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
