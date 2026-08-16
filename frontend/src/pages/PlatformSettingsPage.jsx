import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import { fmtDate } from '../utils/helpers';
import InfoDot from '../components/InfoDot';
import MessagingConnector from '../components/MessagingConnector';
import { GatewayPanel } from './PlatformBillingPage';

/*
 * Platform → Settings. Five tabs:
 *
 *   Defaults      what a newly provisioned organisation starts with
 *   Organisation  read/write one existing tenant's own org_settings
 *   Messaging     the SMS/DLT gateway, one-time-code policy, email queue health
 *   Admins        IFQM staff accounts (there was no UI for these at all — the
 *                 only platform admin was the one seeded by master.sql)
 *   Health        read-only: DB reachability, row counts, upload footprint
 *
 * Messaging is separate from Defaults rather than folded into it. Defaults are
 * copied into every new organisation; delivery credentials belong to IFQM and
 * are copied to nobody, and one of them is a live secret.
 *
 * The SMTP password field is intentionally always empty. The server never sends
 * it back, so there is nothing to prefill; leaving it blank means "keep the
 * stored one". See platformSettingsService for why this is not a mask.
 */
const TABS = ['ps.tab_defaults', 'ps.tab_org', 'ps.tab_messaging',
  'ps.tab_maintenance', 'ps.tab_payments', 'ps.tab_admins'];
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
      {tab === 2 && <MessagingConnector />}
      {tab === 3 && <MaintenanceTab />}
      {/* The payment gateway is configuration, not a billing action, so it
          belongs with the other settings rather than on the screen used to
          chase money. */}
      {tab === 4 && <GatewayPanel />}
      {tab === 5 && <AdminsTab />}
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
/*
 * Maintenance mode — the whole platform on hold.
 *
 * Turning it ON locks every organisation out: nobody can sign in, and sessions
 * already open stop working on their next request. IFQM staff are unaffected,
 * which is what makes it safe to switch on from here — this screen keeps
 * working, so the switch can always be reached to turn it back off.
 *
 * Switching ON asks for confirmation and switching OFF does not. The two are
 * not symmetrical: one interrupts every customer at once, the other restores
 * service, and only the first is worth a speed bump.
 */
function MaintenanceTab() {
  const { t } = useLang();
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [since, setSince] = useState(null);
  const [placeholder, setPlaceholder] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    try {
      const r = await platformApi.getMaintenance();
      setEnabled(!!r.data.enabled);
      setSince(r.data.since || null);
      setPlaceholder(r.data.default_message || '');
      // Only prefill when the operator actually wrote something. Echoing the
      // default back into the box would turn it into text they now own and
      // have to maintain.
      setMessage(r.data.message && r.data.message !== r.data.default_message ? r.data.message : '');
    } catch { showToast(t('msg.fail_load'), 'danger'); }
    setLoaded(true);
  }

  async function save(next) {
    if (next && !window.confirm(t('ps.maint_confirm'))) return;
    setBusy(true);
    try {
      const res = await platformApi.setMaintenance({ enabled: next, message });
      if (res.data.success) {
        setEnabled(!!res.data.enabled);
        setSince(res.data.since || null);
        showToast(next ? t('ps.maint_on_ok') : t('ps.maint_off_ok'), next ? 'warning' : 'success');
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  if (!loaded) return null;

  return (
    <div className="card" style={{ marginTop:16,maxWidth:720 }}>
      <div className="card-title">{t('ps.maint_title')}</div>
      <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:14,lineHeight:1.6 }}>
        {t('ps.maint_hint')}
      </div>

      <div style={{
        display:'flex',alignItems:'center',gap:12,padding:'13px 15px',borderRadius:10,marginBottom:16,
        background: enabled ? 'var(--warning-light,#fef3c7)' : 'var(--surface)',
        border:`1px solid ${enabled ? 'var(--warning,#f59e0b)' : 'var(--border)'}`,
      }}>
        <span style={{
          width:9,height:9,borderRadius:'50%',flex:'none',
          background: enabled ? 'var(--warning,#f59e0b)' : 'var(--success,#16a34a)',
        }} />
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700,fontSize:13.5 }}>
            {enabled ? t('ps.maint_state_on') : t('ps.maint_state_off')}
          </div>
          {enabled && since && (
            <div style={{ fontSize:11.5,color:'var(--subtext)',marginTop:2 }}>
              {t('ps.maint_since').replace('{when}', fmtDate(since))}
            </div>
          )}
        </div>
        <button
          className={`btn btn-sm ${enabled ? 'btn-primary' : 'btn-outline'}`}
          disabled={busy}
          onClick={() => save(!enabled)}
        >
          {enabled ? t('ps.maint_turn_off') : t('ps.maint_turn_on')}
        </button>
      </div>

      <div className="form-group">
        <label>{t('ps.maint_message')}</label>
        <textarea
          className="form-control" rows={3} maxLength={500} value={message}
          placeholder={placeholder}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div style={{ fontSize:11,color:'var(--subtle)',marginTop:3 }}>{t('ps.maint_message_hint')}</div>
      </div>

      {/* Saving the wording without changing the switch, so the notice can be
          corrected mid-window without a stop/start. */}
      <button className="btn btn-outline" disabled={busy} onClick={() => save(enabled)}>
        {t('ps.maint_save_message')}
      </button>
    </div>
  );
}

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
        {/* Whose password this is. The panel sits directly beneath the table of
            every platform admin, so "Change my password" read as though it might
            act on whichever row was last looked at. It only ever changes the
            signed-in account, and now says so with the name and address on it. */}
        <div style={{
          display:'flex',alignItems:'center',gap:10,margin:'2px 0 14px',
          padding:'10px 13px',borderRadius:10,
          background:'var(--surface-2,var(--chip-bg))',border:'1px solid var(--border)',
        }}>
          <div style={{
            width:30,height:30,borderRadius:'50%',flex:'none',display:'flex',
            alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,
            background:'var(--primary)',color:'var(--on-primary,#fff)',
          }}>{(user?.name || '?').charAt(0).toUpperCase()}</div>
          <div style={{ lineHeight:1.45 }}>
            <div style={{ fontSize:13,fontWeight:700,color:'var(--heading)' }}>
              {t('ps.changing_for').replace('{name}', user?.name || '')}
            </div>
            <div style={{ fontSize:11.5,color:'var(--subtle)' }}>{user?.email || ''}</div>
          </div>
        </div>
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
