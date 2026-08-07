import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import { fmtDate } from '../utils/helpers';
import InfoDot from '../components/InfoDot';

/*
 * Platform → Settings. Four tabs:
 *
 *   Defaults      what a newly provisioned organisation starts with
 *   Organisation  read/write one existing tenant's own org_settings
 *   Admins        IFQM staff accounts (there was no UI for these at all — the
 *                 only platform admin was the one seeded by master.sql)
 *   Health        read-only: DB reachability, row counts, upload footprint
 *
 * The SMTP password field is intentionally always empty. The server never sends
 * it back, so there is nothing to prefill; leaving it blank means "keep the
 * stored one". See platformSettingsService for why this is not a mask.
 */
const TABS = ['ps.tab_defaults', 'ps.tab_org', 'ps.tab_admins', 'ps.tab_health'];
const FLAGS = ['anonymous_allowed', 'public_board_enabled', 'challenges_enabled'];

const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};



export default function PlatformSettingsPage() {
  const { t } = useLang();
  const [tab, setTab] = useState(0);

  return (
    <>
      <div style={{ marginBottom:18 }}>
        <h1 style={{ fontSize:26,fontWeight:800,color:'var(--heading)',margin:0,letterSpacing:'-.5px' }}>{t('ps.title')}</h1>
        <div style={{ fontSize:13,color:'var(--subtle)',marginTop:4 }}>{t('ps.sub')}</div>
      </div>

      <div className="tab-bar">
        {TABS.map((key, i) => (
          <div key={key} className={`tab${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>{t(key)}</div>
        ))}
      </div>

      {tab === 0 && <DefaultsTab />}
      {tab === 1 && <OrgSettingsTab />}
      {tab === 2 && <AdminsTab />}
      {tab === 3 && <HealthTab />}
    </>
  );
}

// ── Defaults for new tenants ───────────────────────────────────────
function DefaultsTab() {
  const { t } = useLang();
  const { showToast } = useToast();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platformApi.getDefaults().then((r) => setD(r.data.defaults)).catch(() => showToast(t('msg.fail_load'), 'danger'));
  }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await platformApi.updateDefaults(d);
      if (res.data.success) showToast(t('ps.defaults_saved'), 'success');
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  if (!d) return <div className="empty-state"><div className="spinner"></div></div>;
  const set = (k, v) => setD({ ...d, [k]: v });

  return (
    <div className="card" style={{ maxWidth:620,marginTop:16 }}>
      <div className="card-title">{t('ps.defaults_title')}</div>
      <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:16,lineHeight:1.6 }}>{t('ps.defaults_hint')}</div>

      <div className="form-row">
        <div className="form-group">
          <label>{t('admin.sla_days')}<InfoDot term="sla_days" /></label>
          <input className="form-control" type="number" min="1" max="365" value={d.review_sla_days || ''}
            onChange={(e) => set('review_sla_days', e.target.value)} />
        </div>
        <div className="form-group">
          <label>{t('admin.escalation_days')}<InfoDot term="escalation_days" /></label>
          <input className="form-control" type="number" min="1" max="365" value={d.escalation_days || ''}
            onChange={(e) => set('escalation_days', e.target.value)} />
        </div>
      </div>

      <div className="form-row">
        {FLAGS.map((k) => (
          <div key={k} className="form-group">
            <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer' }}>
              <input type="checkbox" checked={d[k] === '1'} onChange={(e) => set(k, e.target.checked ? '1' : '0')}
                style={{ accentColor:'var(--primary)' }} />
              {t('admin.flag_' + (k === 'anonymous_allowed' ? 'anonymous' : k === 'public_board_enabled' ? 'board' : 'challenges'))}
            </label>
          </div>
        ))}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>{t('ps.approval_mode')}</label>
          <select className="form-control" value={d.approval_mode || 'default'} onChange={(e) => set('approval_mode', e.target.value)}>
            <option value="default">{t('ps.mode_default')}</option>
            <option value="custom">{t('ps.mode_custom')}</option>
          </select>
        </div>
        <div className="form-group">
          <label>{t('ps.threshold')}</label>
          <input className="form-control" type="number" min="1" max="100" value={d.approval_threshold || ''}
            onChange={(e) => set('approval_threshold', e.target.value)} />
        </div>
      </div>

      <button className="btn btn-primary" disabled={busy} onClick={save}>{t('admin.save_settings')}</button>
    </div>
  );
}

// ── One tenant's own settings ──────────────────────────────────────
function OrgSettingsTab() {
  const { t } = useLang();
  const { showToast } = useToast();
  const [tenants, setTenants] = useState([]);
  const [id, setId] = useState('');
  const [s, setS]   = useState(null);
  const [smtpPass, setSmtpPass] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { platformApi.tenants().then((r) => setTenants(r.data.tenants || [])).catch(() => {}); }, []);
  useEffect(() => {
    if (!id) { setS(null); return; }
    setSmtpPass('');
    platformApi.tenantSettings(id).then((r) => setS(r.data.settings))
      .catch((err) => showToast(err?.response?.data?.error || t('msg.fail_load'), 'danger'));
  }, [id]);

  async function save() {
    setBusy(true);
    try {
      // smtp_pass goes only when typed — an empty field must never overwrite the
      // tenant's stored password.
      const payload = { ...s };
      delete payload.smtp_pass_set;
      if (smtpPass.trim()) payload.smtp_pass = smtpPass;
      const res = await platformApi.updateTenantSettings(id, payload);
      if (res.data.success) {
        showToast(t('ps.org_saved'), 'success');
        setSmtpPass('');
        const r = await platformApi.tenantSettings(id);
        setS(r.data.settings);
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  const set = (k, v) => setS({ ...s, [k]: v });

  return (
    <div className="card" style={{ maxWidth:620,marginTop:16 }}>
      <div className="card-title">{t('ps.org_title')}</div>
      <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:16,lineHeight:1.6 }}>{t('ps.org_hint')}</div>

      <div className="form-group">
        <label>{t('pt.to_org')}</label>
        <select className="form-control" value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">—</option>
          {tenants.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.slug})</option>)}
        </select>
      </div>

      {s && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label>{t('admin.sla_days')}<InfoDot term="sla_days" /></label>
              <input className="form-control" type="number" min="1" max="365" value={s.review_sla_days || ''}
                onChange={(e) => set('review_sla_days', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('admin.escalation_days')}<InfoDot term="escalation_days" /></label>
              <input className="form-control" type="number" min="1" max="365" value={s.escalation_days || ''}
                onChange={(e) => set('escalation_days', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            {[...FLAGS, 'email_enabled'].map((k) => (
              <div key={k} className="form-group">
                <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer' }}>
                  <input type="checkbox" checked={s[k] === '1'} onChange={(e) => set(k, e.target.checked ? '1' : '0')}
                    style={{ accentColor:'var(--primary)' }} />
                  {t('admin.flag_' + (k === 'anonymous_allowed' ? 'anonymous' : k === 'public_board_enabled' ? 'board' : k === 'challenges_enabled' ? 'challenges' : 'email'))}
                </label>
              </div>
            ))}
          </div>

          <div style={{ fontSize:13,fontWeight:600,color:'var(--heading)',margin:'16px 0 12px' }}>{t('admin.smtp_heading')}</div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('admin.smtp_host')}<InfoDot term="smtp_host" /></label>
              <input className="form-control" value={s.smtp_host || ''} onChange={(e) => set('smtp_host', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('admin.smtp_port')}<InfoDot term="smtp_port" /></label>
              <input className="form-control" type="number" value={s.smtp_port || ''} onChange={(e) => set('smtp_port', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('admin.smtp_user')}<InfoDot term="smtp_user" /></label>
              <input className="form-control" value={s.smtp_user || ''} onChange={(e) => set('smtp_user', e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('admin.smtp_pass')}<InfoDot term="smtp_pass" /></label>
              <input className="form-control" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={s.smtp_pass_set ? t('ps.smtp_pass_set') : t('ps.smtp_pass_unset')} />
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:3 }}>{t('ps.smtp_pass_hint')}</div>
            </div>
          </div>

          <button className="btn btn-primary" disabled={busy} onClick={save}>{t('admin.save_settings')}</button>
        </>
      )}
    </div>
  );
}

// ── Platform admin accounts ────────────────────────────────────────
function AdminsTab() {
  const { user } = useAuth();
  const { t } = useLang();
  const { showToast } = useToast();
  const [admins, setAdmins] = useState([]);
  const [form, setForm] = useState({ name:'', email:'', password:'' });
  const [pw, setPw] = useState({ current_password:'', new_password:'' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    try { const r = await platformApi.admins(); setAdmins(r.data.admins || []); }
    catch { showToast(t('msg.fail_load'), 'danger'); }
  }

  async function add() {
    setBusy(true);
    try {
      const res = await platformApi.createAdmin(form);
      if (res.data.success) { setForm({ name:'', email:'', password:'' }); showToast(t('ps.admin_added'), 'success'); await load(); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  async function del(a) {
    setBusy(true);
    try {
      const res = await platformApi.deleteAdmin(a.id);
      if (res.data.success) { showToast(t('ps.admin_deleted'), 'success'); await load(); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  async function changePw() {
    setBusy(true);
    try {
      const res = await platformApi.changeOwnPassword(pw);
      if (res.data.success) { setPw({ current_password:'', new_password:'' }); showToast(t('ps.pw_changed'), 'success'); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  const meId = Number(String(user?.id || '').replace(/^pa_/, ''));

  return (
    <>
      <div className="card" style={{ marginTop:16 }}>
        <div className="card-title">{t('ps.admins_title')}</div>
        <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:12,lineHeight:1.6 }}>{t('ps.admins_hint')}</div>
        <table className="table">
          <thead><tr><th>{t('table.user')}</th><th>{t('table.email')}</th><th>{t('sup.col_updated')}</th><th></th></tr></thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td style={{ fontWeight:600 }}>{a.name}{a.id === meId && <span style={{ marginLeft:8,fontSize:10,color:'var(--subtle)' }}>{t('ps.you')}</span>}</td>
                <td style={{ fontSize:12 }}>{a.email}</td>
                <td style={{ fontSize:12,color:'var(--subtext)' }}>{fmtDate(a.created_at)}</td>
                <td style={{ textAlign:'right' }}>
                  <button className="btn btn-outline btn-sm" disabled={busy || a.id === meId} onClick={() => del(a)}>
                    {t('btn.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop:16,maxWidth:620 }}>
        <div className="card-title">{t('ps.add_admin')}</div>
        <div className="form-row">
          <div className="form-group"><label>{t('pa.admin_name')} *</label>
            <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name:e.target.value })} /></div>
          <div className="form-group"><label>{t('pa.admin_email')} *</label>
            <input className="form-control" type="email" value={form.email} onChange={(e) => setForm({ ...form, email:e.target.value })} /></div>
        </div>
        <div className="form-group"><label>{t('pa.admin_password')} *</label>
          <input className="form-control" type="password" value={form.password} onChange={(e) => setForm({ ...form, password:e.target.value })} />
          <div style={{ fontSize:11,color:'var(--subtle)',marginTop:3 }}>{t('ps.pw_policy')}</div>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={add}>{t('ps.add_admin')}</button>
      </div>

      <div className="card" style={{ marginTop:16,maxWidth:620 }}>
        <div className="card-title">{t('ps.change_own_pw')}</div>
        <div className="form-row">
          <div className="form-group"><label>{t('ps.current_pw')}</label>
            <input className="form-control" type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password:e.target.value })} /></div>
          <div className="form-group"><label>{t('ps.new_pw')}</label>
            <input className="form-control" type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password:e.target.value })} /></div>
        </div>
        <button className="btn btn-primary" disabled={busy || !pw.current_password || !pw.new_password} onClick={changePw}>
          {t('ps.change_own_pw')}
        </button>
      </div>
    </>
  );
}

// ── Health ─────────────────────────────────────────────────────────
function HealthTab() {
  const { t } = useLang();
  const [h, setH] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    platformApi.health().then((r) => setH(r.data)).catch((e) => setErr(e?.response?.data?.error || t('msg.fail_load')));
  }, []);

  if (err) return <div className="alert alert-danger">{err}</div>;
  if (!h) return <div className="empty-state"><div className="spinner"></div></div>;

  const ok = h.master_db === 'ok';
  return (
    <>
      <div className="kpi-grid" style={{ marginTop:16 }}>
        <div className="kpi-card" style={{ borderLeftColor: ok ? 'var(--success)' : 'var(--danger)' }}>
          <div className="kpi-body">
            <div className="kpi-val" style={{ fontSize:18,color: ok ? 'var(--success)' : 'var(--danger)' }}>
              {ok ? t('ps.db_ok') : t('ps.db_down')}
            </div>
            <div className="kpi-label">{t('ps.master_db')}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderLeftColor:'var(--info)' }}>
          <div className="kpi-body">
            <div className="kpi-val" style={{ color:'var(--info)' }}>{h.tenants.length}</div>
            <div className="kpi-label">{t('pa.kpi_total_orgs')}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderLeftColor:'var(--warning)' }}>
          <div className="kpi-body">
            <div className="kpi-val" style={{ fontSize:20,color:'var(--warning)' }}>{fmtBytes(h.uploads.bytes)}</div>
            <div className="kpi-label">{t('ps.uploads_total', { n: h.uploads.files })}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop:18,overflowX:'auto' }}>
        <div className="card-title">{t('ps.per_tenant')}</div>
        <table className="table">
          <thead>
            <tr>
              <th>{t('pa.col_company')}</th><th>{t('ps.db')}</th>
              <th>{t('pa.col_users')}</th><th>{t('pa.col_ideas')}</th>
              <th>{t('ps.uploads')}</th><th>{t('table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {h.tenants.map((x) => (
              <tr key={x.id}>
                <td><div style={{ fontWeight:600 }}>{x.name}</div><div style={{ fontSize:11,color:'var(--subtle)' }}>{x.slug}</div></td>
                <td style={{ color: x.db === 'ok' ? 'var(--success)' : 'var(--danger)',fontWeight:600,fontSize:12 }}>{x.db}</td>
                <td style={{ fontWeight:700 }}>{x.users}</td>
                <td style={{ fontWeight:700 }}>{x.ideas}</td>
                <td style={{ fontSize:12 }}>{fmtBytes(x.uploads_bytes)}<span style={{ color:'var(--subtle)' }}> · {x.uploads_files || 0}</span></td>
                <td style={{ fontSize:12 }}>{x.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
