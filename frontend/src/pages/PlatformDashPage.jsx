import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi, saveBlob } from '../services/api';
import { Donut, Legend, colorAt, STATUS_COLORS } from '../components/Charts';
import InfoDot from '../components/InfoDot';

/*
 * Platform → Organizations (tenant management).
 *
 * Everything here is the outer shell of a tenant: counts, status, and the org's
 * own admin as a support contact. No employee, idea or file from inside a tenant
 * reaches this screen — the API will not serve them. See the privacy contract in
 * backend/src/services/platformService.js.
 */
const STATUS_STYLE = {
  active:    { background:'var(--success-light)', color:'var(--success)' },
  suspended: { background:'var(--danger-light)',  color:'var(--danger)' },
  pending:   { background:'var(--warning-light)', color:'var(--warning)' },
};

const KPI_ICONS = {
  orgs:      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,
  active:    <><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></>,
  suspended: <><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></>,
  users:     <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></>,
  ideas:     <path d="M9 21h6M12 3a6 6 0 016 6c0 2.2-1.1 3.8-2.5 5L15 16H9l-.5-2C7 12.8 6 11.2 6 9a6 6 0 016-6z"/>,
};

/**
 * How an organisation is behaving, as distinct from what an operator did to it.
 * `inactive` here means "no sign-in for N days" and carries no consequence —
 * the badge exists so a quiet account is noticed before renewal, not so the
 * platform can act on it.
 */
function ActivityBadge({ ten, t }) {
  const TONE = {
    active:          { bg:'var(--success-light)', fg:'var(--success)' },
    inactive:        { bg:'var(--warning-light)', fg:'var(--warning)' },
    on_hold:         { bg:'var(--danger-light)',  fg:'var(--danger)'  },
    pending:         { bg:'var(--info-light)',    fg:'var(--info)'    },
    never_logged_in: { bg:'var(--chip-bg)',       fg:'var(--text-muted)' },
  };
  const state = ten.activity_state || 'active';
  const tone = TONE[state] || TONE.never_logged_in;
  const label = {
    active: t('pa.act_active'), inactive: t('pa.act_inactive'), on_hold: t('pa.act_on_hold'),
    pending: t('pa.act_pending'), never_logged_in: t('pa.act_never'),
  }[state] || state;

  const days = ten.days_since_login;
  const sub = days == null ? null : days === 0 ? t('pa.act_today') : t('pa.act_days_ago').replace('{days}', days);

  return (
    <div>
      <span
        title={state === 'inactive' ? t('pa.act_inactive_hint').replace('{days}', days ?? '?') : undefined}
        style={{ background:tone.bg,color:tone.fg,fontSize:10,padding:'3px 10px',borderRadius:20,
                 fontWeight:700,textTransform:'uppercase',whiteSpace:'nowrap' }}>
        {label}
      </span>
      {sub && <div style={{ fontSize:10.5,color:'var(--subtle)',marginTop:3 }}>{sub}</div>}
    </div>
  );
}

export default function PlatformDashPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const navigate      = useNavigate();

  const [tenants, setTenants] = useState([]);
  const [totals,  setTotals]  = useState({ orgs:0, ideas:0, implemented:0, qcms_pushed:0 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('');
  const [activity, setActivity] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [busy,    setBusy]    = useState(false);

  useEffect(() => { load(); }, []);

  // Close the row action menu on any outside click.
  useEffect(() => {
    if (menuFor === null) return undefined;
    const close = (e) => { if (!e.target.closest('[data-row-menu]')) setMenuFor(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuFor]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await platformApi.tenants();
      if (res.data.success) {
        setTenants(res.data.tenants || []);
        setTotals(res.data.totals || { orgs:0, ideas:0, implemented:0, qcms_pushed:0 });
      }
      else setError(res.data.error || t('msg.fail_load'));
    } catch (err) { setError(err?.response?.data?.error || t('msg.fail_load')); }
    setLoading(false);
  }

  async function toggleStatus(ten) {
    setBusy(true); setMenuFor(null);
    const next = ten.status === 'active' ? 'suspended' : 'active';
    try {
      const res = await platformApi.updateTenant(ten.id, { status: next });
      if (res.data.success) {
        showToast(next === 'suspended' ? t('pa.suspended_ok') : t('pa.activated_ok'), 'success');
        await load();
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  const filtered = tenants.filter((ten) => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || [ten.name, ten.slug, ten.admin_email, ten.admin_name]
      .some((v) => String(v || '').toLowerCase().includes(q));
    const matchAct = !activity || (ten.activity_state || 'active') === activity;
    return matchQ && (!status || ten.status === status) && matchAct;
  });

  const counts = {
    total:     tenants.length,
    active:    tenants.filter((x) => x.status === 'active').length,
    suspended: tenants.filter((x) => x.status === 'suspended').length,
    pending:   tenants.filter((x) => x.status === 'pending').length,
    // Gone quiet: signed in at some point, but not in the last few days. Kept
    // apart from orgs that have never signed in at all, which is a different
    // problem (a handover that never happened).
    inactive:  tenants.filter((x) => x.activity_state === 'inactive').length,
    never:     tenants.filter((x) => x.activity_state === 'never_logged_in').length,
    users:     tenants.reduce((s, x) => s + (x.user_count || 0), 0),
    ideas:     tenants.reduce((s, x) => s + (x.idea_count || 0), 0),
  };

  // Chart data — a status donut and the busiest organisations by idea volume.
  const statusDonut = [
    { label: t('pa.status_active'),    value: counts.active,    color: STATUS_COLORS.active },
    { label: t('pa.status_suspended'), value: counts.suspended, color: STATUS_COLORS.suspended },
    { label: t('pa.status_pending'),   value: counts.pending,   color: STATUS_COLORS.pending },
  ].filter((d) => d.value > 0);
  const topByIdeas = [...tenants]
    .sort((a, b) => (b.idea_count || 0) - (a.idea_count || 0))
    .slice(0, 6)
    .filter((o) => (o.idea_count || 0) > 0);
  const maxIdeas = Math.max(...topByIdeas.map((o) => o.idea_count || 0), 1);

  /* Client-side CSV: this data is already in the browser, so exporting it needs
   * no endpoint. Values are quoted and internal quotes doubled — an org named
   * O"Brien, Inc. would otherwise split into extra columns. */
  function exportCsv() {
    const cols = ['name', 'slug', 'status', 'activity_state', 'days_since_login', 'admin_name', 'admin_email', 'user_count', 'idea_count', 'implemented_count', 'last_activity'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...filtered.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'ifqm-organisations.csv');
  }

  const kpis = [
    ['orgs',      t('pa.kpi_total_orgs'), counts.total,     'var(--primary)', 'var(--primary-light)'],
    ['active',    t('pa.active_orgs'),    counts.active,    'var(--success)', 'var(--success-light)'],
    ['suspended', t('pa.kpi_suspended'),  counts.suspended, 'var(--danger)',  'var(--danger-light)'],
    ['users',     t('pa.total_users'),    counts.users,     'var(--info)',    'var(--info-light)'],
    ['ideas',     t('pa.ideas_submitted'), counts.ideas,    'var(--warning)', 'var(--warning-light)'],
    // §12.8 — the drill-down the MOM named: Organisations → Ideas → Implemented,
    // then §12.5's QCMS figure as the business-value endpoint of that path.
    ['ideas',     t('pa.kpi_implemented'), totals.implemented, 'var(--primary)', 'var(--primary-light)'],
    ['ideas',     t('pa.qcms_pushed'),     totals.qcms_pushed, 'var(--info)',    'var(--info-light)'],
    // Inactivity is reported, never acted upon. Nothing is suspended because of
    // it; it is here so the platform team can pick up the phone.
    ['orgs',      t('pa.kpi_inactive'),    counts.inactive,    'var(--warning)', 'var(--warning-light)'],
    ['orgs',      t('pa.kpi_never_login'), counts.never,       'var(--danger)',  'var(--danger-light)'],
  ];

  return (
    <>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap',marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:26,fontWeight:800,color:'var(--heading)',margin:0,letterSpacing:'-.5px' }}>
            {t('pa.tenant_mgmt')}
          </h1>
          <div style={{ fontSize:13,color:'var(--subtle)',marginTop:4 }}>{t('pa.tenant_mgmt_sub')}</div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="kpi-grid" id="pa-kpi-strip">
        {kpis.map(([icon, label, val, color, bg]) => (
          <div key={label} className="card kpi-card" style={{ '--kpi-accent':color, borderTop: `3px solid ${color}`, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div className="kpi-icon" style={{ background:bg, color, borderRadius: 8, padding: 6 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  {KPI_ICONS[icon]}
                </svg>
              </div>
            </div>
            <div className="kpi-body">
              <div className="kpi-val" style={{ color, fontSize: 26, fontWeight: 800, letterSpacing: '-.5px' }}>{val}</div>
              <div className="kpi-label" style={{ fontWeight: 650, fontSize: 12.5 }}>{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Analytics charts */}
      {!loading && !error && tenants.length > 0 && (
        <div style={{ display:'grid',gridTemplateColumns:'minmax(280px,360px) 1fr',gap:18,marginTop:18 }}>
          <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
              <div style={{ fontWeight:750,fontSize:14,color:'var(--heading)' }}>{t('pa.chart_status')}</div>
              <span style={{ fontSize:11,color:'var(--subtle)',fontWeight:600 }}>{counts.total} Tenants</span>
            </div>
            <div style={{ display:'flex',alignItems:'center',gap:18,flexWrap:'wrap',padding:'10px 0' }}>
              <Donut size={150} thickness={24} data={statusDonut} centerValue={counts.total} centerLabel={t('pa.kpi_total_orgs')} />
              <div style={{ flex:1,minWidth:120 }}><Legend items={statusDonut} /></div>
            </div>
          </div>
          <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
              <div style={{ fontWeight:750,fontSize:14,color:'var(--heading)' }}>{t('pa.chart_ideas_by_org')}</div>
              <span style={{ fontSize:11,color:'var(--primary)',fontWeight:700 }}>Top Organizations by Volume</span>
            </div>
            <div className="bar-chart">
              {topByIdeas.length
                ? topByIdeas.map((o, i) => (
                  <div className="bar-row" key={o.id} style={{ marginBottom: 10 }}>
                    <span className="bar-label" title={o.name} style={{ fontWeight: 600 }}>{o.name}</span>
                    <div className="bar-track" style={{ height: 8, borderRadius: 999 }}>
                      <div className="bar-fill" style={{ width:`${Math.round((o.idea_count||0)/maxIdeas*100)}%`,height:'100%',borderRadius:999,background:`linear-gradient(90deg,${colorAt(i)}cc,${colorAt(i)})` }}></div>
                    </div>
                    <span className="bar-val" style={{ fontWeight: 700 }}>{o.idea_count||0}</span>
                  </div>
                ))
                : <div className="empty-state">{t('pa.no_activity')}</div>
              }
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="card" style={{ marginTop:18,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap' }}>
        <input
          className="form-control"
          style={{ flex:'1 1 240px',minWidth:200 }}
          placeholder={t('pa.search_ph')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="form-control" style={{ width:170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('pa.all_status')}</option>
          <option value="active">{t('pa.status_active')}</option>
          <option value="suspended">{t('pa.status_suspended')}</option>
          <option value="pending">{t('pa.status_pending')}</option>
        </select>
        <select className="form-control" style={{ width:190 }} value={activity} onChange={(e) => setActivity(e.target.value)}>
          <option value="">{t('pa.all_activity')}</option>
          <option value="active">{t('pa.act_active')}</option>
          <option value="inactive">{t('pa.act_inactive')}</option>
          <option value="never_logged_in">{t('pa.act_never')}</option>
          <option value="on_hold">{t('pa.act_on_hold')}</option>
        </select>
        <button className="btn btn-outline" onClick={exportCsv} disabled={!filtered.length}>{t('pa.export_csv')}</button>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>{t('pa.new_org')}</button>
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && (
        <div className="card" id="pa-tenant-list" style={{ marginTop:18,overflowX:'auto' }}>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
            <div className="card-title" style={{ margin:0 }}>{t('pa.registered_orgs')}</div>
            <div style={{ fontSize:12,color:'var(--subtle)' }}>
              {t('pa.org_count', { n: filtered.length })}
            </div>
          </div>

          {!filtered.length ? (
            <div className="empty-state">{tenants.length ? t('pa.no_match') : t('pa.no_tenants')}</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('pa.col_company')}</th>
                  <th>{t('pa.col_admin')}</th>
                  <th>{t('pa.col_users')}</th>
                  <th>{t('pa.col_ideas')}</th>
                  <th>{t('pa.qcms_pushed')}<InfoDot term="qcms_pushed" /></th>
                  <th>{t('table.status')}<InfoDot term="on_hold" /></th>
                  <th>{t('pa.activity')}<InfoDot term="activity_state" /></th>
                  <th>{t('platform.last_activity')}</th>
                  <th style={{ textAlign:'right' }}>{t('pa.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ten, rowIdx) => (
                  <tr key={ten.id}>
                    <td>
                      <div style={{ fontWeight:700,color:'var(--heading)' }}>{ten.name}</div>
                      <div style={{ fontSize:11,color:'var(--subtle)',textTransform:'uppercase',letterSpacing:.5 }}>
                        {ten.slug}{ten.is_default ? ` · ${t('pa.default_org')}` : ''}
                      </div>
                    </td>
                    <td>
                      {ten.admin_name
                        ? <>
                            <div style={{ fontSize:13 }}>{ten.admin_name}</div>
                            <div style={{ fontSize:11,color:'var(--subtle)' }}>{ten.admin_email}</div>
                          </>
                        : <span style={{ color:'var(--subtle)' }}>—</span>}
                    </td>
                    <td style={{ fontWeight:700 }}>{ten.user_count ?? 0}</td>
                    <td style={{ fontWeight:700 }}>{ten.idea_count ?? 0}</td>
                    <td style={{ fontWeight:700,color:'var(--info)' }}>{ten.qcms_pushed_count ?? 0}</td>
                    <td>
                      {/* Operator-set state. "suspended" in the database reads as
                          "On Hold" everywhere a human sees it. */}
                      <span style={{ ...(STATUS_STYLE[ten.status] || {}),fontSize:10,padding:'3px 10px',borderRadius:20,fontWeight:700,textTransform:'uppercase' }}>
                        {t(`pa.status_${ten.status}`) || ten.status}
                      </span>
                      {ten.db_error && (
                        <div style={{ fontSize:10,color:'var(--danger)',marginTop:3 }}>{t('platform.db_error')}</div>
                      )}
                    </td>
                    {/* Derived from sign-ins, separate from the status above.
                        Purely informational: nothing is switched off when an
                        organisation goes quiet. */}
                    <td><ActivityBadge ten={ten} t={t} /></td>
                    <td style={{ fontSize:12,color:'var(--subtext)' }}>
                      {ten.last_activity ? new Date(ten.last_activity).toLocaleDateString() : t('pa.no_activity')}
                    </td>
                    <td style={{ textAlign:'right',position:'relative' }} data-row-menu>
                      <button
                        className="btn btn-outline btn-sm"
                        disabled={busy}
                        onClick={() => setMenuFor(menuFor === ten.id ? null : ten.id)}
                        aria-label={t('pa.col_actions')}
                      >⋮</button>
                      {menuFor === ten.id && (
                        <div style={{
                          position:'absolute',right:0,zIndex:20,minWidth:190,textAlign:'left',
                          // The list card scrolls horizontally, and a box with
                          // overflow-x:auto cannot keep overflow-y:visible — the
                          // browser promotes it to auto, so a menu hanging below
                          // the last row was clipped away entirely. Flip it above
                          // the button for rows near the bottom.
                          ...(rowIdx >= filtered.length - 2 && filtered.length > 2
                            ? { bottom:'100%', marginBottom:4 }
                            : { top:'100%', marginTop:4 }),
                          // Was var(--card), which this design system does not
                          // define — the menu rendered with a transparent
                          // background over the table, so it looked like the
                          // button did nothing at all.
                          background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r)',
                          boxShadow:'var(--shadow-lg)',padding:6,
                        }}>
                          <MenuItem onClick={() => navigate(`/platform/tenants/${ten.id}?name=${encodeURIComponent(ten.name)}`)}>
                            {t('pa.action_view')}
                          </MenuItem>
                          <MenuItem onClick={() => toggleStatus(ten)} disabled={ten.is_default && ten.status === 'active'}>
                            {ten.status === 'active' ? t('pa.suspend') : t('pa.activate')}
                          </MenuItem>
                          {/* Reset and delete both need confirmation, so they live
                              on the detail page rather than one click deep here. */}
                          <MenuItem onClick={() => navigate(`/platform/tenants/${ten.id}?name=${encodeURIComponent(ten.name)}`)}>
                            {t('pa.action_manage')}
                          </MenuItem>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ fontSize:11,color:'var(--subtle)',marginTop:14,lineHeight:1.6 }}>{t('pa.privacy_note')}</div>

      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); showToast(t('pa.created'),'success'); }} t={t} />}
    </>
  );
}

function MenuItem({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display:'block',width:'100%',textAlign:'left',padding:'8px 10px',fontSize:13,
        background:'none',border:'none',borderRadius:6,cursor:disabled ? 'not-allowed' : 'pointer',
        color:disabled ? 'var(--subtle)' : 'var(--text)',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
    >
      {children}
    </button>
  );
}

function CreateOrgModal({ onClose, onCreated, t }) {
  const [orgName,    setOrgName]    = useState('');
  const [slug,       setSlug]       = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminName,  setAdminName]  = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPass,  setAdminPass]  = useState('');
  const [error,      setError]      = useState('');
  const [saving,     setSaving]     = useState(false);

  function handleOrgNameChange(v) {
    setOrgName(v);
    if (!slugEdited) setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''));
  }

  async function handleSubmit() {
    if (!orgName||!slug||!adminName||!adminEmail||!adminPass) { setError(t('pa.all_required')); return; }
    setSaving(true); setError('');
    try {
      const res = await platformApi.createTenant({ org_name: orgName, slug, admin_name: adminName, admin_email: adminEmail, admin_password: adminPass });
      if (res.data.success) {
        alert(`✅ ${t('pa.created')}\n\n${t('pa.org_slug')}: ${res.data.slug}\n${t('pa.admin_email')}: ${res.data.admin_email}`);
        onCreated();
      } else { setError(res.data.error || t('pa.create_failed')); }
    } catch (err) {
      /*
       * axios throws on every non-2xx, so this branch — not the one above — is
       * what runs for a rejected create. It used to discard `err` entirely and
       * show "Server error. Please try again." for all of them, which hid the
       * only messages that tell the admin what to fix: "Admin password must be
       * at least 12 characters.", "Organization code already in use.",
       * "Invalid admin email address.". A 12-character password rule is
       * impossible to satisfy when the error says "server error".
       */
      setError(err?.response?.data?.error || t('msg.server_error'));
    }
    setSaving(false);
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" id="modal-create-org" style={{ maxWidth:480 }}>
        <div className="modal-header">
          <span>{t('pa.create_title')}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger" id="create-org-error">{error}</div>}
          <div className="form-group"><label>{t('pa.org_name')} *</label>
            <input className="form-control" id="co-org-name" value={orgName} onChange={e => handleOrgNameChange(e.target.value)} /></div>
          <div className="form-group"><label>{t('pa.org_slug')} *<InfoDot term="org_code" /></label>
            <input className="form-control" id="co-slug" value={slug}
              onChange={e => { setSlug(e.target.value); setSlugEdited(true); }} style={{ textTransform:'lowercase' }} />
            <div style={{ fontSize:11,color:'var(--subtle)',marginTop:3 }}>{t('pa.slug_hint')}{slug||'your-code'}</div>
          </div>
          <div style={{ fontSize:13,fontWeight:600,color:'var(--heading)',margin:'14px 0 10px' }}>{t('pa.admin_account')}</div>
          <div className="form-group"><label>{t('pa.admin_name')} *</label>
            <input className="form-control" id="co-admin-name" value={adminName} onChange={e => setAdminName(e.target.value)} /></div>
          <div className="form-group"><label>{t('pa.admin_email')} *</label>
            <input className="form-control" type="email" id="co-admin-email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} /></div>
          <div className="form-group"><label>{t('pa.admin_password')} *</label>
            <input className="form-control" type="password" id="co-admin-pass" value={adminPass} onChange={e => setAdminPass(e.target.value)} /></div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" id="co-submit-btn" disabled={saving} onClick={handleSubmit}>
            {saving ? t('pa.creating') : t('pa.create_btn')}
          </button>
        </div>
      </div>
    </div>
  );
}
