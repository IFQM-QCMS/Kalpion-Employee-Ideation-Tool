import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import { formatRole } from '../utils/helpers';
import OrgProfilePanel from '../components/OrgProfilePanel';

/*
 * Platform → Organisation detail.
 *
 * This page used to render the tenant's entire staff directory: every employee's
 * name, department, who they report to, and how many ideas they had submitted —
 * to IFQM, the vendor. It now shows the outer layer only, because that is all
 * the API will hand over (see the privacy contract in platformService.js):
 * how big the org is, the spread of roles, aggregate idea counts, and the org's
 * own admin contacts. Individual employees, idea content and uploads stay inside
 * the tenant.
 *
 * What is here instead is the vendor's actual job: keeping the account running —
 * rename, suspend, recover a locked-out admin, close the account.
 */
const ROLE_COLORS = {
  admin:'#374151', executive:'#4b5563', plant_head:'#52525b', senior_manager:'#6b7280', department_manager:'#d97706',
  manager:'#f59e0b', project_lead:'#0891b2', team_lead:'#0284c7',
  employee:'#10b981', trainee:'#64748b',
};

const STATUS_STYLE = {
  active:    { background:'var(--success-light)', color:'var(--success)' },
  suspended: { background:'var(--danger-light)',  color:'var(--danger)' },
  pending:   { background:'var(--warning-light)', color:'var(--warning)' },
};

export default function PlatformTenantsPage() {
  const { id }   = useParams();
  const [params] = useSearchParams();
  const { t }        = useLang();
  const { showToast } = useToast();
  const navigate     = useNavigate();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [busy,    setBusy]    = useState(false);

  const [name,       setName]       = useState('');
  const [slug,       setSlug]       = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  const [dropDb,     setDropDb]     = useState(false);
  const [tempPw,     setTempPw]     = useState(null);

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await platformApi.tenantDetail(id);
      if (res.data.success) {
        setData(res.data);
        setName(res.data.tenant?.name || '');
        setSlug(res.data.tenant?.slug || '');
      } else setError(res.data.error || t('msg.fail_load'));
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.fail_load'));
    }
    setLoading(false);
  }

  async function save(patch, okMsg) {
    setBusy(true);
    try {
      const res = await platformApi.updateTenant(id, patch);
      if (res.data.success) { showToast(okMsg, 'success'); await load(); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function resetAdminPw(email) {
    setBusy(true); setTempPw(null);
    try {
      const res = await platformApi.resetTenantAdminPassword(id, email);
      if (res.data.success) {
        // Shown once and never retrievable again — the operator has to hand it
        // over out of band, so it stays on screen until they navigate away.
        setTempPw({ email: res.data.admin_email, password: res.data.temp_password });
        showToast(t('pa.temp_pw_issued'), 'success');
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function doDelete() {
    setBusy(true);
    try {
      const res = await platformApi.deleteTenant(id, { confirm_slug: confirmSlug, drop_database: dropDb });
      if (res.data.success) {
        showToast(res.data.warning || t('pa.deleted'), res.data.warning ? 'warning' : 'success');
        navigate('/platform');
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  const tenant   = data?.tenant;
  const roles    = data?.role_distribution || [];
  const admins   = data?.admins || [];
  const ideaStats = data?.idea_stats || [];
  const tenantName = tenant?.name || params.get('name') || 'Organisation';
  const totalIdeas = ideaStats.reduce((n, s) => n + Number(s.cnt), 0);
  const implemented = Number(ideaStats.find((s) => s.status === 'Implemented')?.cnt || 0);
  const dirty = tenant && (name !== tenant.name || slug !== tenant.slug);

  return (
    <>
      <div style={{ display:'flex',alignItems:'flex-start',gap:10,marginBottom:20,justifyContent:'space-between',flexWrap:'wrap' }}>
        <div>
          <h2 id="pt-tenant-name" style={{ fontSize:16,fontWeight:700,color:'var(--heading)',margin:0 }}>
            {tenantName}
            {tenant && (
              <span style={{ ...STATUS_STYLE[tenant.status], marginLeft:10,fontSize:11,padding:'2px 10px',borderRadius:20,fontWeight:700,textTransform:'uppercase' }}>
                {tenant.status}
              </span>
            )}
          </h2>
          <div style={{ fontSize:12,color:'var(--subtle)',marginTop:4 }}>{t('pa.overview_sub')}</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => navigate('/platform')}>← {t('btn.back')}</button>
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && data && (
        <>
          <div className="kpi-grid">
            {[
              [t('pa.kpi_users'), data.user_count, '#4f46e5'],
              [t('pa.kpi_ideas'), totalIdeas, '#0891b2'],
              [t('pa.kpi_implemented'), implemented, '#10b981'],
              [t('pa.kpi_roles'), roles.length, '#f59e0b'],
            ].map(([label, val, color]) => (
              <div key={label} className="kpi-card" style={{ borderLeftColor:color }}>
                <div className="kpi-body">
                  <div className="kpi-val" style={{ color }}>{val}</div>
                  <div className="kpi-label">{label}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize:11,color:'var(--subtle)',margin:'14px 0 18px',lineHeight:1.6 }}>
            {t('pa.privacy_note')}
          </div>

          {/* Who this company is, what they are using, and what they pay. All
              three were previously either invisible or in a database client. */}
          <OrgProfilePanel
            tenantId={id}
            registration={data.registration}
            usage={data.usage}
            roiTotal={data.roi_total}
            lastIdeaAt={data.last_idea_at}
            activity={data.activity} />

          {/* Role spread — counts only, no people */}
          <div className="card" style={{ marginTop:20 }}>
            <div className="card-title">{t('pa.role_spread')}</div>
            {!roles.length ? <div className="empty-state">{t('sa.no_users')}</div> : (
              <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10 }}>
                {roles.map((r) => {
                  const color = ROLE_COLORS[r.role] || '#888';
                  return (
                    <div key={r.role} style={{ padding:'12px 14px',background:'var(--bg)',borderRadius:'var(--r)',border:'1px solid var(--border)',borderLeft:`3px solid ${color}` }}>
                      <div style={{ fontSize:20,fontWeight:800,color }}>{r.count}</div>
                      <div style={{ fontSize:12,fontWeight:600,color:'var(--heading)',marginTop:2 }}>{formatRole(r.role, t)}</div>
                      <div style={{ fontSize:11,color:'var(--subtle)',marginTop:2 }}>
                        {r.active_count} {t('pa.active_suffix')}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Admin contacts — the one place individual users appear, and only admins */}
          <div className="card" style={{ marginTop:20 }}>
            <div className="card-title">{t('pa.admin_contacts')}</div>
            <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:12 }}>{t('pa.admin_contacts_sub')}</div>
            {!admins.length ? <div className="empty-state">{t('pa.no_admins')}</div> : (
              <table className="table">
                <thead><tr><th>{t('table.user')}</th><th>{t('table.role')}</th><th>{t('table.status')}</th><th></th></tr></thead>
                <tbody>
                  {admins.map((a) => (
                    <tr key={a.email}>
                      <td>
                        <div style={{ fontWeight:600 }}>{a.name}</div>
                        <div style={{ fontSize:11,color:'var(--subtle)' }}>{a.email}</div>
                      </td>
                      <td>{formatRole(a.role, t)}</td>
                      <td>{a.status}</td>
                      <td style={{ textAlign:'right' }}>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => resetAdminPw(a.email)}>
                          {t('pa.reset_admin_pw')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tempPw && (
              <div className="alert" style={{ marginTop:12,background:'var(--warning-light)',color:'var(--warning)' }}>
                <div style={{ fontWeight:700,marginBottom:4 }}>{t('pa.temp_pw_for')} {tempPw.email}</div>
                <code style={{ fontSize:15,fontWeight:700,letterSpacing:1 }}>{tempPw.password}</code>
                <div style={{ fontSize:11,marginTop:6 }}>{t('pa.temp_pw_note')}</div>
              </div>
            )}
          </div>

          {/* Management */}
          <div className="card" style={{ marginTop:20 }}>
            <div className="card-title">{t('pa.manage_org')}</div>

            <div className="form-row">
              <div className="form-group">
                <label>{t('pa.org_name')}</label>
                <input className="form-control" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t('pa.org_slug')}</label>
                <input className="form-control" value={slug} style={{ textTransform:'lowercase' }}
                  onChange={(e) => setSlug(e.target.value)} />
                <div style={{ fontSize:11,color:'var(--subtle)',marginTop:3 }}>{t('pa.slug_change_warn')}</div>
              </div>
            </div>
            <button className="btn btn-primary" disabled={busy || !dirty}
              onClick={() => save({ name: name.trim(), slug: slug.trim().toLowerCase() }, t('pa.saved'))}>
              {t('admin.save_settings')}
            </button>

            <div style={{ height:1,background:'var(--border)',margin:'20px 0' }} />

            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap' }}>
              <div>
                <div style={{ fontWeight:600,fontSize:13 }}>
                  {tenant.status === 'active' ? t('pa.suspend_title') : t('pa.activate_title')}
                </div>
                <div style={{ fontSize:11,color:'var(--subtle)',marginTop:2,maxWidth:460 }}>
                  {tenant.status === 'active' ? t('pa.suspend_hint') : t('pa.activate_hint')}
                </div>
              </div>
              <button
                className={tenant.status === 'active' ? 'btn btn-outline' : 'btn btn-primary'}
                disabled={busy}
                onClick={() => save(
                  { status: tenant.status === 'active' ? 'suspended' : 'active' },
                  tenant.status === 'active' ? t('pa.suspended_ok') : t('pa.activated_ok')
                )}
              >
                {tenant.status === 'active' ? t('pa.suspend') : t('pa.activate')}
              </button>
            </div>
          </div>

          {/* Danger zone */}
          <div className="card" style={{ marginTop:20,borderColor:'var(--danger-dim)' }}>
            <div className="card-title" style={{ color:'var(--danger)' }}>{t('pa.danger_zone')}</div>
            <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:12,lineHeight:1.6 }}>
              {t('pa.delete_hint', { slug: tenant.slug })}
            </div>
            <div className="form-group" style={{ maxWidth:320 }}>
              <label>{t('pa.delete_confirm_label')}</label>
              <input className="form-control" value={confirmSlug} placeholder={tenant.slug}
                onChange={(e) => setConfirmSlug(e.target.value)} />
            </div>
            <label style={{ display:'flex',alignItems:'center',gap:8,fontSize:12,margin:'10px 0 14px',cursor:'pointer' }}>
              <input type="checkbox" checked={dropDb} onChange={(e) => setDropDb(e.target.checked)}
                style={{ accentColor:'var(--danger)' }} />
              {t('pa.drop_db')}
            </label>
            <button className="btn" style={{ background:'var(--danger)',color:'#fff' }}
              disabled={busy || confirmSlug !== tenant.slug} onClick={doDelete}>
              {t('pa.delete_org')}
            </button>
          </div>
        </>
      )}
    </>
  );
}
