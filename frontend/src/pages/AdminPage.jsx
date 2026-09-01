import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { usersApi, ideasApi, settingsApi, scoreApi, brandingApi, categoriesApi, integrationApi } from '../services/api';
import { formatRole, statusBadge, translateStatus, fmtDate } from '../utils/helpers';
import { resetOrgSettings } from '../utils/orgSettings';
import ReportingLineLookup from '../components/ReportingLineLookup';
import IdeaDetailModal from '../components/IdeaDetailModal';
import BulkImportModal from '../components/BulkImportModal';
import InfoDot from '../components/InfoDot';
import Pager, { usePager } from '../components/Pager';
import QcBadge from '../components/QcBadge';

/*
 * React's `style` prop takes an object, not a CSS string. These were strings
 * ('background:#c8ccd1;color:#374151;...'), so rendering one threw
 * "The `style` prop expects a mapping from style properties to values, not a
 * string" — which crashed the whole component. That is why the Admin → User List
 * tab rendered as a blank page for any organisation that had users (i.e. always:
 * the org admin themselves matches `admin`).
 */
const ROLE_BADGE_STYLE = {
  admin:          { background:'var(--primary-light)', color:'var(--primary)', border:'1px solid var(--primary-dim)' },
  executive:      { background:'var(--info-light)',    color:'var(--info)',    border:'1px solid var(--info-dim)' },
  senior_manager: { background:'var(--info-light)',    color:'var(--info)',    border:'1px solid var(--info-dim)' },
  manager:        { background:'var(--warning-light)', color:'var(--warning)', border:'1px solid var(--warning-dim)' },
  project_lead:   { background:'var(--warning-light)', color:'var(--warning)', border:'1px solid var(--warning-dim)' },
  team_lead:      { background:'var(--warning-light)', color:'var(--warning)', border:'1px solid var(--warning-dim)' },
  employee:       { background:'var(--success-light)', color:'var(--success)', border:'1px solid var(--success-dim)' },
  trainee:        { background:'var(--success-light)', color:'var(--success)', border:'1px solid var(--success-dim)' },
};

/* Top to bottom, the way an organisation chart reads. Used for the User List
   filter; super_admin is left out because it is a single built-in account. */
/* Mirrors IDEA_SECTIONS in the backend's ideaSections.js. Order is the order
   they appear on an idea, so the tick boxes read top to bottom the way the
   screen does. */
const IDEA_SECTION_KEYS = ['situation', 'solution', 'benefits', 'business_case',
  'attachments', 'comments', 'co_suggesters', 'timeline'];

const HIERARCHY_ROLES = ['admin', 'plant_head', 'executive', 'senior_manager',
  'department_manager', 'manager', 'project_lead', 'team_lead', 'employee', 'trainee'];

const TAB_KEYS = ['admin.tab_overview','admin.tab_ideas','admin.tab_users','admin.tab_hierarchy','admin.tab_categories','admin.tab_system','admin.tab_approved','admin.tab_integration'];

export default function AdminPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();

  const [tab,         setTab]         = useState(0);
  const [dash,        setDash]        = useState(null);
  const [ideas,       setIdeas]       = useState([]);
  const [ideasSearch, setIdeasSearch] = useState('');
  const [ideasStatus, setIdeasStatus] = useState('');
  const [users,       setUsers]       = useState([]);
  const [usersSearch, setUsersSearch] = useState('');
  // Which sections of an idea an ordinary colleague may read. Held as an
  // array because the form is a set of tick boxes; stored comma-separated.
  const [empSections, setEmpSections] = useState(['solution']);
  const [usersRole,   setUsersRole]   = useState('');
  const [usersError,  setUsersError]  = useState('');
  const [usersStatus, setUsersStatus] = useState('');
  const [userPage,    setUserPage]    = useState(1);
  const [userMeta,    setUserMeta]    = useState({ total: 0, pages: 1 });
  const [managers,    setManagers]    = useState([]);
  // Which one-per-organisation roles are already held, and by whom. See
  // SINGLETON_ROLES in the backend userService for why plant_head is one.
  const [takenRoles,  setTakenRoles]  = useState({});
  const [settings,    setSettings]    = useState(null);
  // The platform-wide attachment ceiling, sent with the settings. Defaults to
  // the old hard-coded bound until the first response arrives.
  const [fileCeiling, setFileCeiling] = useState(50);
  const [loading,     setLoading]     = useState(false);
  const [openIdeaId,  setOpenIdeaId]  = useState(null);
  const [showUserForm,setShowUserForm]= useState(false);
  const [showImport,  setShowImport]  = useState(false);
  const [editUser,    setEditUser]    = useState(null);
  const [rescoreMsg,  setRescoreMsg]  = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');

  useEffect(() => {
    if (tab === 0) loadDash();
    if (tab === 1) loadIdeas();
    if (tab === 5) loadSettings();
  }, [tab]);

  // The user list is searched and paged on the SERVER — a tenant can hold
  // 10,000 employees after a bulk import, so it can no longer be filtered
  // client-side over a full in-memory copy. Debounced so typing doesn't fire a
  // request per keystroke.
  useEffect(() => {
    if (tab !== 2) return undefined;
    const id = setTimeout(() => { loadUsers(); }, usersSearch ? 300 : 0);
    return () => clearTimeout(id);
  }, [tab, usersSearch, usersRole, usersStatus, userPage]);

  async function loadDash() {
    try {
      const res = await ideasApi.dashboard();
      setDash(res.data);
    } catch {}
  }

  async function loadIdeas() {
    try {
      const res = await ideasApi.list({ search: ideasSearch, status: ideasStatus });
      setIdeas(res.data.ideas || []);
    } catch {}
  }

  async function loadUsers() {
    setLoading(true);
    setUsersError('');
    /*
     * These two used to be a single Promise.all inside an empty catch. One of
     * them failing meant NEITHER result was applied and nothing was reported,
     * so a server error rendered as "No users" - an organisation with four
     * employees looked empty, and there was nothing on screen to say why.
     *
     * allSettled so the list still loads when only the manager dropdown fails,
     * and the other way round.
     */
    const [uRes, mRes] = await Promise.allSettled([
      usersApi.adminList({ q: usersSearch, role: usersRole, status: usersStatus, page: userPage, limit: 25 }),
      usersApi.managers(),
    ]);

    if (uRes.status === 'fulfilled') {
      setUsers(uRes.value.data.users || []);
      setUserMeta({ total: uRes.value.data.total ?? 0, pages: uRes.value.data.pages ?? 1 });
    } else {
      setUsers([]);
      setUserMeta({ total: 0, pages: 1 });
      setUsersError(uRes.reason?.response?.data?.error || t('msg.fail_load'));
    }

    // The manager dropdown is a convenience on the edit form; losing it must
    // not take the list with it.
    if (mRes.status === 'fulfilled') {
      setManagers(mRes.value.data.managers || []);
      setTakenRoles(mRes.value.data.taken_roles || {});
    }

    setLoading(false);
  }

  async function loadSettings() {
    try {
      const res = await settingsApi.get();
      if (res.data.success) {
        const cfg = res.data.settings;
        setSettings(cfg);
        // The bound the server will actually clamp to, set by IFQM in the
        // platform console. Hard-coding max="50" here made the field promise a
        // number the server would quietly trim.
        if (res.data.platform_max_file_mb) setFileCeiling(res.data.platform_max_file_mb);
        // An absent key means the built-in default; a stored empty string means
        // the admin deliberately chose "title only". The two are not the same.
        const raw = cfg.employee_visible_sections;
        setEmpSections(raw === undefined || raw === null
          ? ['solution']
          : String(raw).split(',').map(x => x.trim()).filter(x => IDEA_SECTION_KEYS.includes(x)));
      }
    } catch {}
  }

  async function handleDeleteUser(id, name) {
    if (!confirm(t('admin.confirm_remove', { name }))) return;
    try {
      const res = await usersApi.deleteUser(id);
      if (res.data.success) {
        showToast(t(res.data.deactivated ? 'admin.deactivated' : 'admin.removed', { name }), 'info');
        loadUsers();
      } else showToast(`${t('msg.error')}: ` + (res.data.error || ''), 'danger');
    } catch { showToast(t('msg.server_error'), 'danger'); }
  }

  async function handleRescore() {
    setRescoreMsg(t('admin.rescoring'));
    try {
      const res = await scoreApi.batchRescore();
      if (res.data.success) setRescoreMsg(`✓ ${t('msg.rescore_ok', { n: res.data.updated })}`);
      else setRescoreMsg(`${t('msg.error')}: ` + (res.data.error || ''));
    } catch { setRescoreMsg(t('msg.server_error')); }
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {};
    // The approval_* keys are deliberately NOT collected here any more — they
    // are managed on the Hierarchy tab. Collecting them from a form that has
    // no such fields sent '' / 'default' and silently wiped a tenant's custom
    // approval chain every time SMTP or a flag was saved.
    // This is an explicit allowlist, not Object.fromEntries — a new field on the
    // form is invisible to the save until it is named here. solution_visibility
    // (MOM §13.1) is one of them.
    ['review_sla_days','escalation_days','solution_visibility','prediction_visibility','max_file_mb','situation_preview_chars'].forEach(k => { data[k] = fd.get(k)||''; });
    // Tick boxes, not a form field — and an empty list is a real answer meaning
    // "title only", so it is sent as an empty string rather than skipped.
    data.employee_visible_sections = empSections.join(',');
    ['anonymous_allowed','public_board_enabled','challenges_enabled','email_enabled','content_protection','idea_screen_protection'].forEach(k => { data[k] = fd.get(k)==='1'?'1':'0'; });
    setSettingsMsg('');
    try {
      const res = await settingsApi.update(data);
      if (res.data.success) {
        setSettingsMsg(t('admin.settings_saved'));
        showToast(t('admin.settings_saved'),'success');
        // Other screens cache these for the session; drop the cache so the
        // submit form's attachment limit and the guard reflect the new values
        // without anybody having to reload.
        resetOrgSettings();
      }
      else setSettingsMsg(res.data.error || t('admin.settings_failed'));
    } catch { setSettingsMsg(t('msg.network_error')); }
  }

  async function handleTestEmail() {
    showToast(t('admin.sending_test'),'info');
    try {
      const res = await settingsApi.testEmail();
      if (res.data.success) showToast(t('admin.test_sent'),'success');
      else showToast(res.data.error||t('msg.error'),'danger');
    } catch { showToast(t('msg.network_error'),'danger'); }
  }

  const filteredIdeas = ideas.filter(i => {
    const q = ideasSearch.toLowerCase();
    return (!q || i.title.toLowerCase().includes(q) || i.idea_code.toLowerCase().includes(q)) &&
           (!ideasStatus || i.status === ideasStatus);
  });

  // `users` already arrives searched and paged from the server — filtering it
  // again here would only hide rows from the current page.
  const counts = dash?.counts || {};

  return (
    <>
      <div style={{ display:'flex',alignItems:'center',gap:12,flexWrap:'wrap' }}>
        <div className="tab-bar" style={{ flex:1,minWidth:0 }}>
          {TAB_KEYS.map((key, i) => (
            <div key={key} className={`tab${tab===i?' active':''}`} onClick={() => setTab(i)}>{t(key)}</div>
          ))}
        </div>
        {/* The org-admin manual, for whoever runs this organisation. */}
      </div>

      {/* Overview */}
      {tab === 0 && dash && (
        <div>
          <div className="kpi-grid" style={{ marginTop:16 }}>
            {Object.entries(counts).map(([s,c]) => (
              <div key={s} className="kpi-card">
                <div className="kpi-body">
                  <div className="kpi-val">{c}</div>
                  <div className="kpi-label">{translateStatus(s, t)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop:16 }}>
            <div style={{ fontWeight:700,fontSize:13,marginBottom:14 }}>{t('admin.database')}</div>
            <div id="admin-db-name" style={{ fontSize:13,color:'var(--subtle)' }}>
              <strong>{t('admin.database')}:</strong> ifqm_{user?.org_slug}
            </div>
          </div>
        </div>
      )}

      {/* Idea Management */}
      {tab === 1 && (
        <div>
          <div className="filter-bar" style={{ marginTop:16 }}>
            <input className="form-control" type="search" placeholder={t('filter.search_ideas')}
              value={ideasSearch} onChange={e => { setIdeasSearch(e.target.value); loadIdeas(); }} style={{ maxWidth:260 }} />
            <select className="form-control" value={ideasStatus} onChange={e => { setIdeasStatus(e.target.value); loadIdeas(); }} style={{ width:160 }}>
              <option value="">{t('filter.all_statuses')}</option>
              {['Submitted','Under Review','Approved','Rejected','Implemented'].map(s => (
                <option key={s} value={s}>{translateStatus(s, t)}</option>
              ))}
            </select>
          </div>
          <div className="card" style={{ overflowX:'auto',marginTop:8 }}>
            <table className="table">
              <thead>
                <tr><th>{t('table.code')}</th><th>{t('table.title')}</th><th>{t('table.submitter')}</th><th>{t('table.status')}</th><th>{t('table.date')}</th><th></th></tr>
              </thead>
              <tbody>
                {!filteredIdeas.length && <tr><td colSpan="6" className="text-center">{t('msg.no_ideas')}</td></tr>}
                {filteredIdeas.map(i => (
                  <tr key={i.id}>
                    <td><strong>{i.idea_code}</strong></td>
                    <td>{i.title.length>50?i.title.substring(0,50)+'…':i.title}</td>
                    <td>{i.submitter_name}</td>
                    <td><span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status, t)}</span><QcBadge status={i.qcms_push_status} /></td>
                    <td>{i.submitted_at?fmtDate(i.submitted_at):'–'}</td>
                    <td><button className="btn btn-outline btn-sm" onClick={() => setOpenIdeaId(i.id)}>{t('btn.view')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User List */}
      {tab === 2 && (
        <div>
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:16,marginBottom:12,gap:10,flexWrap:'wrap' }}>
            <input className="form-control" type="search" placeholder={t('filter.search_users')}
              value={usersSearch}
              onChange={e => { setUsersSearch(e.target.value); setUserPage(1); }}
              style={{ maxWidth:280 }} id="admin-user-search" />
            {/* Narrowing by level is the question an admin actually asks: "who
                are my plant heads", "show me the trainees". Filtered in SQL, so
                the paging stays correct. */}
            <select className="form-control" style={{ width:190 }} value={usersRole}
              onChange={e => { setUsersRole(e.target.value); setUserPage(1); }} id="admin-user-role">
              <option value="">{t('filter.all_roles')}</option>
              {HIERARCHY_ROLES.map(r => <option key={r} value={r}>{formatRole(r, t)}</option>)}
            </select>
            <select className="form-control" style={{ width:150 }} value={usersStatus}
              onChange={e => { setUsersStatus(e.target.value); setUserPage(1); }}>
              <option value="">{t('filter.all_statuses')}</option>
              <option value="active">{t('admin.status_active')}</option>
              <option value="inactive">{t('admin.status_inactive')}</option>
            </select>
            <div style={{ display:'flex',gap:8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setShowImport(true)}>
                ⬆ {t('imp.button')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditUser(null); setShowUserForm(true); }}>{t('btn.add_user')}</button>
            </div>
          </div>
          {usersError && <div className="alert alert-danger">{usersError}</div>}

          <div className="card" style={{ overflowX:'auto' }}>
            <table className="table">
              <thead>
                <tr><th>{t('table.user')}</th><th>{t('table.role')}</th><th>{t('table.dept')}</th><th>{t('table.manager')}</th><th>{t('table.points')}</th><th>{t('table.status')}</th><th></th></tr>
              </thead>
              <tbody id="admin-users-tbody">
                {!users.length && <tr><td colSpan="7" className="text-center">{t('admin.no_users')}</td></tr>}
                {users.map(u => {
                  const isProtected = u.role === 'super_admin' || u.id === user?.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                          <div className="avatar" style={{ width:30,height:30,fontSize:11 }}>{u.avatar_initials||u.name?.[0]||'?'}</div>
                          <div>
                            <div style={{ fontWeight:600,fontSize:13 }}>{u.name}</div>
                            {/* Whichever sign-in identifier the account actually
                                has. An account created without an address shows
                                its username instead of a lonely bullet. */}
                            <div style={{ fontSize:11,color:'var(--subtle)' }}>
                              {[u.employee_id, u.username, u.email].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td><span className="badge" style={ROLE_BADGE_STYLE[u.role]}>{formatRole(u.role, t)}</span></td>
                      <td style={{ fontSize:12 }}>{u.department||'–'}</td>
                      <td style={{ fontSize:12,color:'var(--subtle)' }}>{u.manager_name||'–'}</td>
                      <td><strong>{u.points}</strong></td>
                      <td>
                        <span style={{ fontSize:10,padding:'1px 8px',borderRadius:99,border:'1px solid',
                          background:u.status==='inactive'?'var(--danger-light)':'var(--success-light)',
                          color:u.status==='inactive'?'var(--danger)':'var(--success)',
                          borderColor:u.status==='inactive'?'var(--danger-dim)':'var(--success-dim)' }}>
                          {t(u.status==='inactive' ? 'admin.inactive' : 'admin.active')}
                        </span>
                        {/* Imported and never signed in: their password is still
                            the derived one, i.e. guessable. Worth chasing. */}
                        {!!u.must_change_password && (
                          <div style={{ marginTop:3 }}>
                            <span title={t('imp.pending_hint')} style={{ fontSize:10,padding:'1px 8px',borderRadius:99,
                              background:'var(--warning-light)',color:'var(--warning)',border:'1px solid var(--warning-dim)' }}>
                              {t('imp.pending')}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        {isProtected
                          ? <span style={{ fontSize:11,color:'var(--subtle)' }}>—</span>
                          : (
                            <div style={{ display:'flex',gap:6 }}>
                              <button className="btn btn-outline btn-sm" onClick={() => { setEditUser(u); setShowUserForm(true); }}>{t('btn.edit')}</button>
                              <button className="btn btn-sm" style={{ background:'var(--danger-light)',color:'var(--danger)',border:'1px solid var(--danger-dim)' }}
                                onClick={() => handleDeleteUser(u.id, u.name)}>{t('btn.remove')}</button>
                            </div>
                          )
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pager. With 10,000 employees the list is no longer something the
              browser can hold all of, so paging is not cosmetic. */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:12,gap:10 }}>
            <span style={{ fontSize:12,color:'var(--subtle)' }}>
              {t('imp.showing', {
                from: userMeta.total ? (userPage - 1) * 25 + 1 : 0,
                to: Math.min(userPage * 25, userMeta.total),
                total: userMeta.total,
              })}
            </span>
            <div style={{ display:'flex',gap:6,alignItems:'center' }}>
              <button className="btn btn-outline btn-sm" disabled={userPage <= 1 || loading}
                onClick={() => setUserPage(p => Math.max(1, p - 1))}>← {t('btn.back')}</button>
              <span style={{ fontSize:12,color:'var(--subtle)',minWidth:70,textAlign:'center' }}>
                {userPage} / {userMeta.pages || 1}
              </span>
              <button className="btn btn-outline btn-sm" disabled={userPage >= (userMeta.pages || 1) || loading}
                onClick={() => setUserPage(p => p + 1)}>{t('btn.next')} →</button>
            </div>
          </div>
        </div>
      )}

      {/* Hierarchy — approval workflow + reporting structure */}
      {tab === 3 && <HierarchyTab t={t} showToast={showToast} currentUserId={user?.id} />}

      {/* Idea categories */}
      {tab === 4 && <CategoriesTab t={t} showToast={showToast} />}

      {/* Approved ideas (pushable to QCMS) */}
      {tab === 6 && <ApprovedIdeasTab t={t} showToast={showToast} />}

      {/* API & Integration (QCMS) */}
      {tab === 7 && <IntegrationTab t={t} showToast={showToast} />}

      {/* System */}
      {tab === 5 && <BrandingCard t={t} showToast={showToast} />}

      {/* Grouped into a card and given room.
          This was a bare 600px column on the page background: every field at the
          same weight, section titles indistinguishable from the labels beneath
          them, and two thirds of a wide screen left empty beside it. Nothing
          here changed except how it is grouped and how much room it gets. */}
      {tab === 5 && settings && (
        <div style={{ maxWidth:880,marginTop:16 }}>
          <form onSubmit={handleSaveSettings} className="card">
            <div style={SECTION_HEAD}>{t('admin.sla_heading')}</div>
            <div className="form-row">
              <div className="form-group">
                <label>{t('admin.sla_days')}<InfoDot term="sla_days" /></label>
                <input className="form-control" name="review_sla_days" type="number" min="1" max="90" defaultValue={settings.review_sla_days||7} />
              </div>
              <div className="form-group">
                <label>{t('admin.escalation_days')}<InfoDot term="escalation_days" /></label>
                <input className="form-control" name="escalation_days" type="number" min="1" max="180" defaultValue={settings.escalation_days||14} />
              </div>
            </div>

            {/* MOM §13.1 — who may read the full proposal. This used to be a
                constant in the backend; the organisation now owns it. Everyone
                still sees title, impact, score and status in every mode — only
                the proposal text is governed here. */}
            <div className="form-group" style={{ marginTop:8,maxWidth:420 }}>
              <label>{t('admin.solution_visibility')}<InfoDot term="solution_visibility" /></label>
              <select className="form-control" name="solution_visibility"
                defaultValue={settings.solution_visibility || 'authors_reviewers'}>
                <option value="authors_reviewers">{t('admin.sv_authors_reviewers')}</option>
                <option value="managers_only">{t('admin.sv_managers_only')}</option>
                <option value="everyone">{t('admin.sv_everyone')}</option>
              </select>
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('admin.sv_hint')}</div>
            </div>

            {/* MOM §14.10 — voting stays open to everyone; this is only the AI's
                written assessment. The minutes said "confirm scope", so it is a
                choice rather than a rule baked into the code. */}
            <div className="form-group" style={{ maxWidth:420 }}>
              <label>{t('admin.prediction_visibility')}<InfoDot term="prediction_visibility" /></label>
              <select className="form-control" name="prediction_visibility"
                defaultValue={settings.prediction_visibility || 'seniors'}>
                <option value="seniors">{t('admin.pv_seniors')}</option>
                <option value="everyone">{t('admin.pv_everyone')}</option>
              </select>
            </div>

            {/* What a colleague who is neither the author nor a reviewer may
                read on somebody else's idea. The title, code, status, impact
                and score are never hidden — they are what makes an idea
                findable and what the leaderboard counts. */}
            <div className="form-group" style={{ marginTop:8 }}>
              <label>{t('admin.employee_sections')}<InfoDot term="employee_sections" /></label>
              <div style={{ fontSize:11,color:'var(--subtle)',margin:'2px 0 8px' }}>{t('admin.employee_sections_hint')}</div>
              <div style={{ display:'flex',flexWrap:'wrap',gap:'8px 18px',maxWidth:620 }}>
                {IDEA_SECTION_KEYS.map(k => (
                  <label key={k} style={{ display:'flex',alignItems:'center',gap:7,cursor:'pointer',fontSize:13,minWidth:180 }}>
                    <input type="checkbox" checked={empSections.includes(k)}
                      style={{ accentColor:'var(--primary)' }}
                      onChange={e => setEmpSections(prev => (
                        e.target.checked ? [...prev, k] : prev.filter(x => x !== k)
                      ))} />
                    {t(`section.${k}`)}
                  </label>
                ))}
              </div>
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:8 }}>
                {empSections.length ? t('admin.sections_chosen', { n: empSections.length }) : t('admin.sections_none')}
              </div>
            </div>

            {/* Each organisation sets its own attachment ceiling. The platform
                keeps a hard maximum above this, so raising it here can never
                exceed what the server itself will accept. */}
            <div className="form-row">
              <div className="form-group">
                <label>{t('admin.max_file_mb')}<InfoDot term="max_file_mb" /></label>
                <input className="form-control" name="max_file_mb" type="number" min="1" max={fileCeiling}
                  defaultValue={settings.max_file_mb || 10} />
                <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>
                  {t('admin.max_file_ceiling', { n: fileCeiling })}
                </div>
              </div>
              <div className="form-group">
                <label>{t('admin.situation_preview')}<InfoDot term="situation_preview" /></label>
                <input className="form-control" name="situation_preview_chars" type="number" min="60" max="600"
                  defaultValue={settings.situation_preview_chars || 180} />
                <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('admin.situation_preview_hint')}</div>
              </div>
            </div>

            {/* On by default. Blanks idea text when the window loses focus, and
                stamps the reader's name across it. The hint is honest about the
                limits — no web page can truly stop a screenshot. */}
            <div className="form-group" style={{ maxWidth:520 }}>
              <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer' }}>
                <input type="checkbox" name="idea_screen_protection" value="1"
                  defaultChecked={settings.idea_screen_protection !== '0'}
                  style={{ accentColor:'var(--primary)' }} />
                {t('admin.screen_protection')}<InfoDot term="screen_protection" />
              </label>
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('admin.sp_hint')}</div>
            </div>

            {/* MOM §7.2 — a deterrent, not a control. The hint says so plainly
                rather than letting an admin believe it stops screenshots. */}
            <div className="form-group" style={{ maxWidth:520 }}>
              <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer' }}>
                <input type="checkbox" name="content_protection" value="1"
                  defaultChecked={settings.content_protection==='1'}
                  style={{ accentColor:'var(--primary)' }} />
                {t('admin.content_protection')}<InfoDot term="content_protection" />
              </label>
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('admin.cp_hint')}</div>
            </div>

            <div style={{ fontSize:13,fontWeight:600,color:'var(--heading)',margin:'16px 0 12px' }}>{t('admin.flags_heading')}<InfoDot term="feature_flags" /></div>
            <div className="form-row">
              {[['anonymous_allowed','admin.flag_anonymous','flag_anonymous'],['public_board_enabled','admin.flag_board','flag_board'],
                ['challenges_enabled','admin.flag_challenges','flag_challenges'],['email_enabled','admin.flag_email','flag_email']].map(([k,labelKey,infoTerm]) => (
                <div key={k} className="form-group">
                  <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer' }}>
                    <input type="checkbox" name={k} value="1" defaultChecked={settings[k]==='1'} style={{ accentColor:'var(--primary)' }} />
                    {t(labelKey)}<InfoDot term={infoTerm} />
                  </label>
                </div>
              ))}
            </div>

            <div style={{ display:'flex',gap:8,marginTop:16 }}>
              <button type="submit" className="btn btn-primary">{t('admin.save_settings')}</button>
            </div>
            {settingsMsg && <div style={{ marginTop:10,fontSize:13,color:settingsMsg===t('admin.settings_saved')?'#10b981':'#ef4444' }}>{settingsMsg}</div>}
          </form>

          <div className="card" style={{ marginTop:24 }}>
            <div style={{ fontWeight:700,fontSize:13,marginBottom:12 }}>{t('admin.ai_scoring')}</div>
            <button className="btn btn-warning btn-sm" onClick={handleRescore}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign:'middle',marginRight:4 }}>
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
              {t('btn.rescore_all')}
            </button>
            {rescoreMsg && <div id="rescore-result" style={{ marginTop:8,fontSize:13 }}>{rescoreMsg}</div>}
          </div>
        </div>
      )}

      {openIdeaId && <IdeaDetailModal ideaId={openIdeaId} onClose={() => { setOpenIdeaId(null); loadIdeas(); }} />}

      {showImport && (
        <BulkImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { setUserPage(1); loadUsers(); }}
        />
      )}

      {showUserForm && (
        <UserFormModal
          user={editUser}
          managers={managers}
          // Which one-per-organisation roles are already held. Loaded beside the
          // manager list, and passed down because the form is a separate
          // component — reaching for it from in there was a ReferenceError that
          // blanked the whole page the moment "Add user" was pressed.
          takenRoles={takenRoles}
          currentUserRole={user?.role}
          currentUserId={user?.id}
          onClose={() => setShowUserForm(false)}
          onSaved={() => { setShowUserForm(false); loadUsers(); }}
          // Refresh the list behind a modal that is staying open to show a
          // credential — the new employee should already be in it.
          onRefresh={loadUsers}
          showToast={showToast}
          t={t}
        />
      )}
    </>
  );
}

/*
 * ── Organization Branding ──────────────────────────────────────────
 * Lets a tenant admin set the name and PNG logo that everyone in their own
 * organisation sees in the app shell. Scope is implicit and cannot be widened
 * from here: the server resolves the tenant from the caller's token, so an admin
 * can only ever edit their own organisation.
 *
 * The name and the logo save independently. Uploading a logo is the slow,
 * failure-prone half (a multi-hundred-KB multipart request), and tying it to the
 * name field would mean a rejected file also discarded a rename the admin had
 * just typed.
 */
const MAX_LOGO_BYTES = 1024 * 1024; // keep in step with brandingService

function BrandingCard({ t, showToast }) {
  const { orgName, logo, hasCustomLogo, refresh } = useBranding();
  const [name, setName]         = useState('');
  const [savingName, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview]   = useState(null);
  const fileRef                  = useRef(null);

  // Seed the field once branding has loaded, but never clobber what the admin is
  // actively typing.
  useEffect(() => { setName((cur) => (cur ? cur : orgName || '')); }, [orgName]);

  async function saveName(e) {
    e.preventDefault();
    const next = name.trim();
    if (!next) { showToast(t('admin.org_name_required'), 'warning'); return; }
    setSaving(true);
    try {
      const res = await brandingApi.updateName(next);
      if (res.data?.success) {
        await refresh();
        showToast(t('admin.branding_saved'), 'success');
      } else {
        showToast(res.data?.error || t('msg.server_error'), 'danger');
      }
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setSaving(false);
  }

  function pickFile(e) {
    const file = e.target.files?.[0];
    if (!file) { setPreview(null); return; }
    // Checked again on the server against the file's actual magic bytes — this
    // is only here to fail fast before a pointless upload.
    if (file.type !== 'image/png' || !/\.png$/i.test(file.name)) {
      showToast(t('admin.logo_not_png'), 'warning');
      e.target.value = '';
      setPreview(null);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showToast(t('admin.logo_too_big'), 'warning');
      e.target.value = '';
      setPreview(null);
      return;
    }
    setPreview(URL.createObjectURL(file));
  }

  async function uploadLogo() {
    const file = fileRef.current?.files?.[0];
    if (!file) { showToast(t('admin.logo_pick_first'), 'warning'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await brandingApi.updateLogo(fd);
      if (res.data?.success) {
        await refresh();
        setPreview(null);
        if (fileRef.current) fileRef.current.value = '';
        showToast(t('admin.logo_saved'), 'success');
      } else {
        showToast(res.data?.error || t('msg.server_error'), 'danger');
      }
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setUploading(false);
  }

  async function removeLogo() {
    setUploading(true);
    try {
      const res = await brandingApi.removeLogo();
      if (res.data?.success) {
        await refresh();
        setPreview(null);
        if (fileRef.current) fileRef.current.value = '';
        showToast(t('admin.logo_removed'), 'success');
      } else {
        showToast(res.data?.error || t('msg.server_error'), 'danger');
      }
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setUploading(false);
  }

  return (
    <div className="card" style={{ maxWidth:600,marginTop:16 }}>
      <div className="card-title">{t('admin.branding_heading')}</div>
      <div style={{ fontSize:12,color:'var(--text-muted)',marginBottom:16,lineHeight:1.6 }}>
        {t('admin.branding_desc')}
      </div>

      <form onSubmit={saveName}>
        <div className="form-group">
          <label>{t('admin.org_name')}</label>
          <input
            className="form-control"
            value={name}
            maxLength={100}
            placeholder={t('admin.org_name_ph')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={savingName}>
          {savingName ? t('admin.saving') : t('admin.save_org_name')}
        </button>
      </form>

      <div style={{ height:1,background:'var(--border)',margin:'20px 0' }} />

      <div className="form-group">
        <label>{t('admin.org_logo')}</label>
        <div style={{ fontSize:12,color:'var(--text-muted)',marginBottom:10 }}>{t('admin.logo_hint')}</div>

        <div style={{ display:'flex',alignItems:'center',gap:14,marginBottom:12 }}>
          <div style={{
            width:120,height:56,display:'flex',alignItems:'center',justifyContent:'center',
            background:'#fff',border:'1px solid var(--border)',borderRadius:8,padding:6,
          }}>
            <img
              src={preview || logo}
              alt={orgName}
              style={{ maxWidth:'100%',maxHeight:'100%',objectFit:'contain' }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          </div>
          <div style={{ fontSize:12,color:'var(--text-muted)' }}>
            {preview
              ? t('admin.logo_preview')
              : hasCustomLogo ? t('admin.logo_current') : t('admin.logo_none')}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png"
          className="form-control"
          onChange={pickFile}
        />
      </div>

      <div style={{ display:'flex',gap:8 }}>
        <button type="button" className="btn btn-primary" onClick={uploadLogo} disabled={uploading || !preview}>
          {uploading ? t('admin.saving') : t('admin.logo_upload')}
        </button>
        {hasCustomLogo && (
          <button type="button" className="btn btn-outline" onClick={removeLogo} disabled={uploading}>
            {t('admin.logo_remove')}
          </button>
        )}
      </div>
    </div>
  );
}

/*
 * ── Idea categories tab ────────────────────────────────────────────
 * The list the submission wizard offers, owned by this organisation alone. The
 * server resolves the tenant from the caller's token, so an admin editing this
 * screen cannot reach another organisation's categories.
 *
 * Deleting is presented as "stop offering this", because that is all it does:
 * ideas already filed under a category keep it — the name is stored on the idea
 * as text, not as a reference to this row. The usage count is shown next to
 * every category so the decision is made with that in view.
 */
function CategoriesTab({ t, showToast }) {
  const [cats,    setCats]    = useState([]);
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(true);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await categoriesApi.list();
      setCats(res.data.categories || []);
      setError('');
    } catch { setError(t('msg.fail_load')); }
    setLoading(false);
  }

  async function add(e) {
    e.preventDefault();
    const next = name.trim();
    if (!next) return;
    setBusy(true);
    try {
      const res = await categoriesApi.create(next);
      if (res.data.success) {
        setName('');
        showToast(t('cat.added'), 'success');
        await load();
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (err) {
      showToast(err.response?.data?.error || t('msg.server_error'), 'danger');
    }
    setBusy(false);
  }

  async function remove(cat) {
    if (!confirm(t('cat.confirm_delete', { name: cat.name }))) return;
    setBusy(true);
    try {
      const res = await categoriesApi.delete(cat.id);
      if (res.data.success) {
        showToast(t('cat.deleted'), 'info');
        await load();
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (err) {
      showToast(err.response?.data?.error || t('msg.server_error'), 'danger');
    }
    setBusy(false);
  }

  if (loading) return <div className="empty-state"><div className="spinner"></div></div>;

  return (
    <div className="card" style={{ maxWidth:640,marginTop:16 }}>
      <div className="card-title">{t('cat.title')}</div>
      <div style={{ fontSize:12,color:'var(--text-muted)',marginBottom:16,lineHeight:1.6 }}>{t('cat.desc')}</div>

      {error && <div className="alert alert-danger" style={{ marginBottom:12 }}>{error}</div>}

      <form onSubmit={add} style={{ display:'flex',gap:8,marginBottom:16,flexWrap:'wrap' }}>
        <input className="form-control" style={{ flex:1,minWidth:200 }} value={name} maxLength={80}
          placeholder={t('cat.name_ph')} onChange={e => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          + {t('cat.add')}
        </button>
      </form>

      {!cats.length ? <div className="empty-state">{t('cat.empty')}</div> : (
        <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
          {cats.map(c => (
            <div key={c.id} style={{ display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
              background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r)' }}>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ fontWeight:600,fontSize:13,color:'var(--text)' }}>{c.name}</div>
                <div style={{ fontSize:11,color:'var(--subtle)',marginTop:2 }}>
                  {Number(c.idea_count) > 0 ? t('cat.used_in', { n: c.idea_count }) : t('cat.unused')}
                </div>
              </div>
              <button className="btn btn-sm" disabled={busy || cats.length <= 1}
                style={{ background:'var(--danger-light)',color:'var(--danger)',border:'1px solid var(--danger-dim)' }}
                onClick={() => remove(c)}>{t('btn.remove')}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * ── Hierarchy tab ──────────────────────────────────────────────────
 * The tenant admin's control panel for the hierarchical idea-submission
 * system. Two independently owned pieces:
 *
 *  1. Approval Workflow — which roles review (escalation chain), which roles
 *     give the final decision, and the committee threshold. Stored in the
 *     tenant's own org_settings, so every organisation configures its own
 *     chain without touching anyone else's. (This editor existed in the PHP
 *     Admin panel and was lost in the React migration.)
 *
 *  2. Reporting Structure — the manager tree ideas escalate through.
 *     Every card carries a "Reports to" selector that rewires that single
 *     edge; the server refuses assignments that would close a loop.
 */

// Seniority ladder, junior → senior. Used to sort the roots of the reporting
// tree; the approval chain no longer consults it.
const CHAIN_LADDER = ['team_lead','project_lead','manager','senior_manager','plant_head','executive','admin'];

/*
 * ── The approval chain ─────────────────────────────────────────────
 * One ordered list of steps, and the only description of the chain there is.
 *
 * It used to be one of three: a built-in chain, this list, and a pair of
 * reviewer/final role checkbox sets. Every job title appeared in two or three
 * of them, so "Senior Manager" was three separate controls on one screen and
 * only the ones belonging to the selected mode did anything. The two role sets
 * and the mode selector are gone.
 *
 * Mirrors STAGE_CATALOG and DEFAULT_STAGES in
 * backend/src/services/approvalStages.js — the server derives the reviewer and
 * final roles from this list and validates every key it is sent, so this array
 * is the menu rather than the authority.
 *
 * `originator` is the person who submits. It is pinned first and cannot be
 * removed: an approval step cannot precede the idea existing.
 */
const STAGE_OPTIONS = [
  'team_lead','immediate_manager','project_lead',
  'department_manager','senior_manager','plant_head','executive',
];
const DEFAULT_STAGES = ['originator','team_lead','immediate_manager','department_manager','plant_head'];

/*
 * Which users.role fills each stage. Mirrors STAGE_CATALOG in
 * backend/src/services/approvalStages.js.
 *
 * `immediate_manager` is filled by plain `manager`: it is a level in the
 * reporting tree rather than a job title of its own, and that mismatch between
 * the stage name and the role name is exactly the kind of thing an admin
 * cannot be expected to hold in their head — which is why the count below is
 * shown rather than left to be discovered.
 */
const STAGE_ROLE = {
  team_lead: 'team_lead',
  immediate_manager: 'manager',
  project_lead: 'project_lead',
  department_manager: 'department_manager',
  senior_manager: 'senior_manager',
  plant_head: 'plant_head',
  executive: 'executive',
};

/* Section headings inside the settings form: a rule and a weight change, so a
   heading is distinguishable from the field labels beneath it. */
const SECTION_HEAD = {
  fontSize: 12, fontWeight: 800, letterSpacing: .5, textTransform: 'uppercase',
  color: 'var(--heading)', margin: '4px 0 14px',
  paddingBottom: 8, borderBottom: '1px solid var(--border)',
};

const HIER_ROLE_COLORS = {
  admin:'#374151', executive:'#4b5563', plant_head:'#52525b', senior_manager:'#6b7280', department_manager:'#d97706',
  manager:'#f59e0b', project_lead:'#0891b2', team_lead:'#0284c7',
  employee:'#10b981', trainee:'#64748b',
};

function HierarchyTab({ t, showToast, currentUserId }) {
  const [users,     setUsers]     = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [hierSearch, setHierSearch] = useState('');
  const [limit,     setLimit]     = useState(0);
  const [total,     setTotal]     = useState(0);
  const [managers,  setManagers]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [savingId,  setSavingId]  = useState(null);

  // Approval workflow state
  const [stages,    setStages]    = useState(DEFAULT_STAGES);
  /*
   * What this organisation calls each stage.
   *
   * Keyed by stage key, and only the stages actually renamed are held here —
   * an empty box means "use the built-in name", which is also how a rename is
   * undone. The KEY never changes, so a rename cannot strand an idea that is
   * sitting at that stage when it happens.
   */
  const [labels,    setLabels]    = useState({});
  const [renaming,  setRenaming]  = useState(false);
  const [addStage,  setAddStage]  = useState('');
  const [wfSaving,  setWfSaving]  = useState(false);
  const [wfMsg,     setWfMsg]     = useState(null); // { ok, text }

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [hierRes, mgrRes, setRes] = await Promise.all([
        usersApi.hierarchy(),
        usersApi.managers(),
        settingsApi.get(),
      ]);
      if (hierRes.data.success) {
        setUsers(hierRes.data.users || []);
        setTruncated(!!hierRes.data.truncated);
        setLimit(hierRes.data.limit || 0);
        setTotal(hierRes.data.stats?.total ?? 0);
      }
      setManagers(mgrRes.data.managers || []);
      const s = setRes.data.settings || {};
      const parse = (v, fb) => {
        const list = String(v || '').split(',').map(x => x.trim()).filter(Boolean);
        return list.length ? list : fb;
      };
      // Whatever is stored, the originator leads and never repeats — the same
      // normalisation the server applies on read.
      const stored = parse(s.approval_stages, DEFAULT_STAGES)
        .filter(x => x === 'originator' || STAGE_OPTIONS.includes(x));

      // Bad JSON must not take the whole screen down — the built-in names are
      // always a correct answer, so fall back to them and let the admin retype.
      try {
        const raw = s.approval_stage_labels;
        const obj = raw && typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        setLabels(obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {});
      } catch { setLabels({}); }
      setStages(['originator', ...new Set(stored.filter(x => x !== 'originator'))]);
    } catch { setError(t('msg.fail_load')); }
    setLoading(false);
  }

  // ── stage list editing ──
  function removeStage(stage) {
    if (stage === 'originator') return;   // pinned; the UI offers no button either
    setStages(list => list.filter(s => s !== stage));
  }

  function appendStage(stage) {
    if (!stage || stages.includes(stage)) return;
    setStages(list => [...list, stage]);
    setAddStage('');
  }

  /** Move an approver stage one place up or down. The originator never moves. */
  function moveStage(index, delta) {
    const target = index + delta;
    if (index < 1 || target < 1 || target >= stages.length) return;
    setStages(list => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveWorkflow() {
    if (stages.filter(s => s !== 'originator').length === 0) {
      setWfMsg({ ok:false, text: t('hier.stages_required') });
      return;
    }
    setWfSaving(true);
    setWfMsg(null);
    try {
      // Blank entries are dropped here as well as on the server, so a cleared
      // box is stored as "no override" rather than as an empty name.
      const cleanLabels = {};
      for (const [k, v] of Object.entries(labels)) {
        const name = String(v ?? '').trim();
        if (name) cleanLabels[k] = name;
      }
      const res = await settingsApi.update({
        approval_stages: stages.join(','),
        approval_stage_labels: JSON.stringify(cleanLabels),
      });
      if (res.data.success) { setWfMsg({ ok:true, text: t('hier.saved') }); showToast(t('hier.saved'),'success'); }
      else setWfMsg({ ok:false, text: res.data.error || t('admin.settings_failed') });
    } catch { setWfMsg({ ok:false, text: t('msg.server_error') }); }
    setWfSaving(false);
  }

  function resetWorkflow() {
    if (!confirm(t('hier.confirm_reset'))) return;
    setStages(DEFAULT_STAGES);
    setWfMsg(null);
  }

  async function reassign(userId, managerId) {
    setSavingId(userId);
    try {
      const res = await usersApi.updateManager(userId, managerId || null);
      if (res.data.success) {
        showToast(t('hier.updated'), 'success');
        // Rewire locally so the tree redraws without a full reload.
        setUsers(us => us.map(u => u.id === userId
          ? { ...u, manager_id: managerId || null,
              manager_name: managers.find(m => m.id === Number(managerId))?.name || null }
          : u));
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (e) {
      showToast(e.response?.data?.error || t('msg.server_error'), 'danger');
    }
    setSavingId(null);
  }

  if (loading) return <div className="empty-state"><div className="spinner"></div></div>;
  if (error)   return <div className="alert alert-danger" style={{ marginTop:16 }}>{error}</div>;

  /*
   * The preview is the stage list read aloud. It is now a restatement of the
   * one thing on screen rather than a fourth description of the chain: it used
   * to branch three ways and two of those branches showed roles that were not
   * in force, which is how an admin could read a chain the engine never walked.
   */
  /*
   * How many active people hold each stage's role.
   *
   * A chain naming stages nobody occupies is the most consequential mistake
   * that can be made on this screen and the least visible: ideas reaching an
   * empty stage are stepped over, which is recorded but is not what the
   * organisation asked for. Six ideas in one tenant sat at a stage with no
   * holder before this was shown anywhere.
   */
  const holders = {};
  for (const u of users) {
    if (u.status === 'inactive') continue;
    holders[u.role] = (holders[u.role] || 0) + 1;
  }
  const holdersFor = (stage) => holders[STAGE_ROLE[stage]] || 0;
  const emptyStages = stages.filter(s => s !== 'originator' && holdersFor(s) === 0);

  const approverStages = stages.filter(s => s !== 'originator');
  // The Approval Path reads back what an idea will actually do, in this
  // organisation's own words — so a renamed stage must appear renamed here, or
  // the one line meant to confirm the chain describes a different one.
  const stageName = (k) => labels[k]?.trim() || t(`stage.${k}`);
  const chainPreview =
    [stageName('originator'), ...approverStages.map(stageName)].join('  →  ')
    + (approverStages.length
        ? `  (${t('hier.stage_final')}: ${stageName(approverStages[approverStages.length - 1])})`
        : '');

  // Build the reporting tree.
  const byId = {};
  users.forEach(u => { byId[u.id] = { ...u, children: [] }; });
  const roots = [];
  users.forEach(u => {
    if (u.manager_id && byId[u.manager_id]) byId[u.manager_id].children.push(byId[u.id]);
    else roots.push(byId[u.id]);
  });
  const rootOrder = Object.fromEntries([...CHAIN_LADDER].reverse().map((r, i) => [r, i]));
  roots.sort((a,b) => (rootOrder[a.role]??9)-(rootOrder[b.role]??9) || a.name.localeCompare(b.name));

  return (
    <div style={{ marginTop:16 }}>
      {/* ── Approval Workflow ── */}
      <div className="card" style={{ marginBottom:20 }}>
        <div className="card-title">{t('hier.approval_title')}</div>
        <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:14 }}>{t('hier.approval_sub')}</div>

        {/* The chain: add, remove and reorder the steps an idea travels
            through. The originator is pinned at the top with no remove button:
            it is the submission itself, not an approval. */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontWeight:500,marginBottom:6,display:'block' }}>{t('hier.stages_label')}<InfoDot term="approval_stages" /></label>
          <div style={{ fontSize:11,color:'var(--subtle)',marginBottom:10 }}>{t('hier.stages_hint')}</div>

          {/* Shown before the list, because the fix is usually to change the
              chain — and somebody who has scrolled past the warning to the
              save button has already decided. */}
          {emptyStages.length > 0 && (
            <div className="alert alert-warning" style={{ fontSize:12,marginBottom:12 }}>
              {t('hier.gap_warning', {
                stages: emptyStages.map(k => labels[k]?.trim() || t(`stage.${k}`)).join(', '),
              })}
            </div>
          )}

          <div style={{ display:'flex',flexDirection:'column',gap:6,marginBottom:12 }}>
            {stages.map((s, i) => {
              const isOriginator = s === 'originator';
              const isFinal = !isOriginator && i === stages.length - 1;
              return (
                <div key={s} style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 12px',
                  background:'var(--surface)',border:'1px solid var(--border)',borderRadius:'var(--r)',
                  borderLeft:`3px solid ${isOriginator ? '#10b981' : isFinal ? '#374151' : 'var(--primary)'}` }}>
                  <span style={{ fontSize:11,color:'var(--subtle)',minWidth:16,textAlign:'right' }}>{i+1}</span>
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:13,fontWeight:600,color:'var(--text)' }}>
                      {/* "only for large companies" used to be appended here.
                          MOM 24/08: removed. It was advice rather than fact —
                          a five-person firm with one manager uses this stage
                          perfectly well — and it read as a restriction on a
                          stage that has none. */}
                      {renaming && !isOriginator ? (
                        <input
                          className="form-control"
                          style={{ maxWidth:230, height:30, fontSize:12.5 }}
                          value={labels[s] ?? ''}
                          placeholder={t(`stage.${s}`)}
                          maxLength={60}
                          aria-label={`${t('hier.rename_stage')} — ${t(`stage.${s}`)}`}
                          onChange={e => setLabels(prev => ({ ...prev, [s]: e.target.value }))}
                        />
                      ) : (
                        <>
                          {labels[s]?.trim() || t(`stage.${s}`)}
                          {labels[s]?.trim() && (
                            <span style={{ fontWeight:400,fontSize:11,color:'var(--subtle)' }}>
                              {' '}({t(`stage.${s}`)})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div style={{ fontSize:11,color:'var(--subtle)',marginTop:2,display:'flex',gap:8,flexWrap:'wrap' }}>
                      <span>{isOriginator ? t('hier.stage_locked') : isFinal ? t('hier.stage_final') : ''}</span>
                      {!isOriginator && (
                        holdersFor(s) === 0
                          ? <span style={{ color:'var(--danger)',fontWeight:600 }}>
                              {t('hier.stage_nobody', { role: formatRole(STAGE_ROLE[s], t) })}
                            </span>
                          : <span>{t('hier.stage_holders', { n: holdersFor(s) })}</span>
                      )}
                    </div>
                  </div>
                  {!isOriginator && (
                    <div style={{ display:'flex',gap:4 }}>
                      <button type="button" className="btn btn-outline btn-sm" disabled={i <= 1}
                        onClick={() => moveStage(i, -1)} aria-label="Move up">↑</button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={i >= stages.length - 1}
                        onClick={() => moveStage(i, 1)} aria-label="Move down">↓</button>
                      <button type="button" className="btn btn-sm"
                        style={{ background:'var(--danger-light)',color:'var(--danger)',border:'1px solid var(--danger-dim)' }}
                        onClick={() => removeStage(s)}>{t('btn.remove')}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/*
            Renaming is a mode rather than always-on boxes. The common visit to
            this screen is to check or reorder the chain, and a column of text
            inputs invites an accidental edit to something an organisation
            depends on.
          */}
          <div style={{ display:'flex',gap:8,alignItems:'center',marginBottom:12,flexWrap:'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm"
              onClick={() => setRenaming(v => !v)}>
              {renaming ? t('hier.rename_done') : t('hier.rename_stage')}
            </button>
            {renaming && (
              <span style={{ fontSize:11,color:'var(--subtle)' }}>{t('hier.rename_hint')}</span>
            )}
          </div>

          {STAGE_OPTIONS.some(s => !stages.includes(s)) ? (
            <div style={{ display:'flex',gap:8,flexWrap:'wrap',alignItems:'center' }}>
              <select className="form-control" style={{ width:230 }} value={addStage}
                onChange={e => setAddStage(e.target.value)}>
                <option value="">{t('hier.stage_add')}…</option>
                {STAGE_OPTIONS.filter(s => !stages.includes(s)).map(s => (
                  <option key={s} value={s}>{t(`stage.${s}`)}</option>
                ))}
              </select>
              <button type="button" className="btn btn-outline btn-sm" disabled={!addStage}
                onClick={() => appendStage(addStage)}>+ {t('hier.stage_add')}</button>
            </div>
          ) : (
            <div style={{ fontSize:11,color:'var(--subtle)' }}>{t('hier.stage_all_used')}</div>
          )}
        </div>

        <div style={{ fontSize:12,background:'var(--bg)',border:'1px dashed var(--border)',borderRadius:'var(--r)',padding:'8px 12px',marginBottom:14 }}>
          <strong style={{ fontSize:11,textTransform:'uppercase',letterSpacing:.5,color:'var(--subtle)' }}>{t('hier.chain_preview')}<InfoDot term="chain_preview" /></strong>
          <div style={{ marginTop:4,color:'var(--text)' }}>{chainPreview}</div>
        </div>

        <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
          <button className="btn btn-primary btn-sm" disabled={wfSaving} onClick={saveWorkflow}>
            {wfSaving ? t('btn.saving') : t('hier.save_workflow')}
          </button>
          <button className="btn btn-outline btn-sm" onClick={resetWorkflow}>{t('hier.reset_defaults')}</button>
          {wfMsg && <span style={{ fontSize:13,color:wfMsg.ok?'var(--success)':'var(--danger)' }}>{wfMsg.text}</span>}
        </div>
      </div>

      {/* Looking one person up is a different question from reading the whole
          tree, and it is the one that gets asked. Kept above the chart. */}
      <ReportingLineLookup />

      {/* ── Reporting Structure ── */}
      <div className="card">
        <div className="card-title">{t('hier.org_structure')}<InfoDot term="reporting_structure" /></div>
        <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:14 }}>{t('hier.org_hint')}</div>
        {truncated && (
          <div className="alert alert-warning" style={{ marginBottom:12,fontSize:12 }}>
            {t('sa.too_many_tree', { shown: limit, total })}
          </div>
        )}
        {/* Find one person without reading the tree.
            Scrolling a thousand nested cards to reach somebody is not a way to
            find them, and it is the thing an admin actually came here to do.
            A search shows matches as a flat list with their manager on the row,
            because the branch above a person is not what you are looking for
            when you already know their name. */}
        <input
          className="form-control"
          style={{ marginBottom: 12, maxWidth: 340 }}
          placeholder={t('hier.search_ph')}
          value={hierSearch}
          onChange={(e) => setHierSearch(e.target.value)}
        />

        {hierSearch.trim() ? (
          (() => {
            const q = hierSearch.trim().toLowerCase();
            const hits = users.filter(u =>
              [u.name, u.employee_id, u.username, u.department, u.email]
                .some(v => String(v || '').toLowerCase().includes(q)));
            if (!hits.length) return <div className="empty-state">{t('sa.no_users')}</div>;
            return (
              <>
                <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:8 }}>
                  {t('hier.n_matches', { n: hits.length })}
                </div>
                {hits.slice(0, 50).map(u => (
                  <ReportingNode key={u.id} node={{ ...u, children: [] }} depth={0} t={t}
                    managers={managers} savingId={savingId} currentUserId={currentUserId}
                    onReassign={reassign} />
                ))}
              </>
            );
          })()
        ) : !roots.length
          ? <div className="empty-state">{t('sa.no_users')}</div>
          : roots.map(n => (
            <ReportingNode key={n.id} node={n} depth={0} t={t}
              managers={managers} savingId={savingId} currentUserId={currentUserId} onReassign={reassign} />
          ))
        }
      </div>
    </div>
  );
}

/*
 * One person in the reporting tree.
 *
 * Two things made this unusable once an organisation had real numbers in it.
 *
 * Every row mounted a <select> listing every possible manager. At a thousand
 * employees that is a thousand selects each holding a thousand options - a
 * million DOM nodes for a screen showing forty. The browser, not the server,
 * was what stopped responding. The selector is now mounted only for the row
 * being changed; every other row shows the manager's name as text.
 *
 * And the tree drew itself in full, indenting 36px per level, so a deep
 * organisation ran off the side of the screen with no way to fold a branch.
 * Branches now collapse, and anything below the second level starts collapsed -
 * an admin opens the part they are working on rather than scrolling past all
 * of it.
 */
function ReportingNode({ node, depth, t, managers, savingId, currentUserId, onReassign }) {
  const color = HIER_ROLE_COLORS[node.role] || '#888';
  const kids = [...(node.children || [])].sort((a, b) => {
    const o = Object.fromEntries([...CHAIN_LADDER].reverse().map((r, i) => [r, i]));
    return (o[a.role]??9) - (o[b.role]??9) || a.name.localeCompare(b.name);
  });
  const [open, setOpen] = useState(depth < 2);
  const [editing, setEditing] = useState(false);

  const manager = managers.find(m => m.id === node.manager_id);
  const options = managers.filter(m => m.id !== node.id);

  // How many people sit under this person in total, not just directly. It is
  // the number that decides whether a branch is worth opening.
  const countBelow = (n) => (n.children || []).reduce((a, c) => a + 1 + countBelow(c), 0);
  const below = countBelow(node);

  return (
    <div style={{ position:'relative',marginLeft:depth ? 22 : 0,marginBottom:6 }}>
      {depth > 0 && <div style={{ position:'absolute',left:-12,top:'50%',width:10,height:1,background:'var(--border)' }}></div>}
      <div style={{ borderLeft:`3px solid ${color}`,padding:'8px 12px',background:'var(--surface)',
                    borderRadius:'var(--r)',boxShadow:'var(--shadow-sm)',display:'flex',
                    alignItems:'center',gap:10,flexWrap:'wrap' }}>
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          disabled={!kids.length}
          title={kids.length ? (open ? t('hier.collapse') : t('hier.expand')) : ''}
          style={{
            width:20,height:20,flexShrink:0,borderRadius:5,cursor:kids.length?'pointer':'default',
            border:'1px solid var(--border)',background:'transparent',
            color:kids.length?'var(--text-muted)':'transparent',fontSize:11,lineHeight:1,fontFamily:'inherit',
          }}
        >{kids.length ? (open ? '−' : '+') : ''}</button>

        <div className="avatar" style={{ background:`linear-gradient(135deg,${color},${color}cc)`,flexShrink:0,fontWeight:800 }}>
          {node.avatar_initials || node.name?.[0] || '?'}
        </div>
        <div style={{ flex:1,minWidth:150 }}>
          <div style={{ fontWeight:700,fontSize:13,color:'var(--text)' }}>
            {node.name}
            {!!below && !open && (
              <span style={{ marginLeft:8,fontSize:11,fontWeight:600,color:'var(--subtle)' }}>
                {t('hier.n_below', { n: below })}
              </span>
            )}
          </div>
          <div style={{ fontSize:11,color:'var(--subtle)',marginTop:2 }}>{node.employee_id} · {node.department||'–'}</div>
        </div>
        <span className="badge" style={{ background:`${color}18`,color,border:`1px solid ${color}40`,fontWeight:700 }}>{formatRole(node.role, t)}</span>

        <div style={{ display:'flex',alignItems:'center',gap:6,minWidth:200,justifyContent:'flex-end' }}>
          <span style={{ fontSize:11,color:'var(--subtle)' }}>{t('hier.reports_to')}</span>
          {editing ? (
            <select className="form-control" style={{ width:190,fontSize:12,padding:'4px 8px' }}
              autoFocus
              value={node.manager_id || ''}
              disabled={savingId === node.id}
              onBlur={() => setEditing(false)}
              onChange={e => { onReassign(node.id, e.target.value ? Number(e.target.value) : null); setEditing(false); }}>
              <option value="">{t('admin.uf_none')}</option>
              {options.map(m => <option key={m.id} value={m.id}>{m.name} ({formatRole(m.role, t)})</option>)}
            </select>
          ) : (
            <button type="button" className="btn btn-sm btn-outline"
              style={{ fontSize:12,padding:'4px 10px',maxWidth:190,overflow:'hidden',
                       textOverflow:'ellipsis',whiteSpace:'nowrap' }}
              disabled={savingId === node.id}
              onClick={() => setEditing(true)}>
              {manager ? manager.name : t('admin.uf_none')}
            </button>
          )}
        </div>
      </div>
      {open && kids.map(c => (
        <ReportingNode key={c.id} node={c} depth={depth+1} t={t}
          managers={managers} savingId={savingId} currentUserId={currentUserId} onReassign={onReassign} />
      ))}
    </div>
  );
}

function UserFormModal({ user: editUser, managers, takenRoles = {}, currentUserRole, currentUserId, onClose, onSaved, onRefresh, showToast, t }) {
  const isEdit = !!editUser;
  const [name,    setName]    = useState(editUser?.name||'');
  const [empId,   setEmpId]   = useState(editUser?.employee_id||'');
  const [email,   setEmail]   = useState(editUser?.email||'');
  const [uname,   setUname]   = useState(editUser?.username||'');
  /*
   * What became of the first-login credential, held until acknowledged.
   *
   * This used to be a toast, which was wrong for the case that matters: a
   * derived password is something the administrator has to write down and pass
   * on, and a toast takes it away after a few seconds whether they read it or
   * not. There is no second chance — the password is hashed on the server and
   * cannot be shown again. So it stays on screen until they dismiss it.
   */
  const [issued,  setIssued]  = useState(null);
  const [phone,   setPhone]   = useState(editUser?.phone||'');
  const [role,    setRole]    = useState(editUser?.role||'employee');
  const [mgr,     setMgr]     = useState(editUser?.manager_id||'');
  const [dept,    setDept]    = useState(editUser?.department||'');
  const [bu,      setBu]      = useState(editUser?.business_unit||'');
  const [loc,     setLoc]     = useState(editUser?.location||'');
  const [status,  setStatus]  = useState(editUser?.status||'active');
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);

  /*
   * Mirrors ROLES_ADMIN_CAN_ASSIGN in backend/src/services/userService.js.
   *
   * department_manager and plant_head were missing from this list while the
   * server accepted both, so neither could be handed out from the one screen
   * that hands out roles. That was not a cosmetic gap: the DEFAULT approval
   * chain is originator → immediate manager → department manager → plant head,
   * so out of the box an organisation had two stages in its approval path that
   * no employee could ever occupy. Ideas reaching either stage had nobody to
   * escalate to.
   *
   * MOM 24/08 asked for Department Manager in the Approval Path; it was already
   * a selectable STAGE, and this is what was actually missing.
   */
  const roleOptions = [
    'trainee','employee','team_lead','project_lead','manager',
    'department_manager','senior_manager','plant_head','executive',
    ...(currentUserRole==='super_admin' ? ['admin'] : []),
  ];

  async function handleSubmit() {
    setError('');
    /*
     * A mobile number is required of every account, however it is created.
     * It is what a sign-in code, a password reset and any later confirmation
     * are sent to; an employee added without one is fine until the morning
     * they cannot get in. Checked on the server too — this is only so the
     * admin is told before a round trip.
     */
    // \D, not D. This stripped literal capital Ds and counted everything else,
    // so "abcdefghij" was accepted as a ten-digit mobile number. It matters more
    // now than it did: the first-login password is built from these digits.
    const digits = phone.replace(/\D/g, '');
    if (!phone.trim()) { setError(t('admin.uf_phone_required')); return; }
    if (digits.length < 10) { setError(t('admin.uf_phone_invalid')); return; }
    setSaving(true);
    const payload = { name, email, username: uname.trim().toLowerCase(), employee_id: empId,
      role, manager_id: mgr||null, department: dept, business_unit: bu, location: loc, phone };
    if (isEdit) { payload.id = editUser.id; payload.status = status; }
    try {
      const res = await usersApi[isEdit ? 'updateUser' : 'createUser'](payload);
      if (res.data.success) {
        /*
         * Three outcomes, and the admin has to be able to tell them apart —
         * the difference decides whether they now have a job to do.
         *
         *   emailed         nothing to pass on; the employee has it already.
         *   derived         they must read it out, so it is shown.
         *   send failed     the account exists with a password nobody knows,
         *                   so it is shown too, with the failure said plainly.
         *                   Silently hiding it here would strand the employee.
         *
         * The last one is a warning rather than a success: the account was
         * created, but something still needs doing about it.
         */
        const d = res.data;
        const panel = isEdit ? null
          : d.password_emailed ? { kind:'emailed', to: d.emailed_to }
            : d.email_failed ? { kind:'email_failed', to: email, password: d.temp_password }
              : d.temp_password ? { kind:'derived', password: d.temp_password }
                : null;

        if (panel) {
          // Stay open. The list behind refreshes so the new employee is
          // already there when the panel is dismissed.
          setIssued(panel);
          onRefresh?.();
        } else {
          showToast(t(isEdit ? 'admin.user_updated' : 'admin.user_created'), 'success');
          onSaved();
        }
      }
      else { setError(res.data.error||t('admin.user_save_failed')); }
    } catch (err) { setError(err.response?.data?.error || t('msg.server_error')); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:520 }}>
        <div className="modal-header">
          <span id="user-form-title">{t(isEdit ? 'admin.edit_user' : 'admin.add_user_title')}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {issued ? (
          <>
            <div className="modal-body" id="uf-issued">
              {issued.kind === 'emailed' && (
                <div className="alert alert-success" style={{ fontSize:13 }}>
                  {t('admin.uf_pw_emailed', { email: issued.to })}
                </div>
              )}
              {issued.kind === 'email_failed' && (
                <div className="alert alert-danger" style={{ fontSize:13 }}>
                  {t('admin.uf_pw_email_failed', { email: issued.to })}
                </div>
              )}
              {issued.password && (
                <>
                  <div style={{ fontSize:12,color:'var(--text-muted)',marginBottom:6 }}>
                    {t('admin.uf_temp_pw')}
                  </div>
                  <div style={{ display:'flex',alignItems:'center',gap:10,flexWrap:'wrap' }}>
                    <code style={{ fontSize:20,fontWeight:700,letterSpacing:'.06em',
                      background:'var(--surface-2)',border:'1px solid var(--border)',
                      borderRadius:8,padding:'10px 16px',userSelect:'all' }}>
                      {issued.password}
                    </code>
                    <button className="btn btn-outline btn-sm"
                      onClick={() => { navigator.clipboard?.writeText(issued.password); showToast(t('admin.uf_pw_copied'), 'success'); }}>
                      {t('btn.copy')}
                    </button>
                  </div>
                  {/* Said plainly, because it is the part people assume is not
                      true: there is no way to look this up again later. */}
                  <div className="alert alert-warning" style={{ fontSize:12,marginTop:14 }}>
                    {t('admin.uf_pw_once')}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={onSaved}>{t('btn.done')}</button>
            </div>
          </>
        ) : (
        <>
        <div className="modal-body">
          {error && <div className="alert alert-danger" id="user-form-error">{error}</div>}
          <div className="form-row">
            <div className="form-group"><label>{t('admin.uf_name')} *</label><input className="form-control" value={name} onChange={e=>setName(e.target.value)} id="uf-name" /></div>
            <div className="form-group"><label>{t('admin.uf_emp_id')} *<InfoDot term="employee_id" /></label><input className="form-control" value={empId} onChange={e=>setEmpId(e.target.value)} id="uf-emp-id" /></div>
          </div>
          {/* Username OR email — at least one, because one of them is how the
              person signs in. Neither is starred: starring both would say
              "both required", and starring neither says "your choice", which
              is what the hint underneath spells out. */}
          <div className="form-row">
            <div className="form-group">
              <label>{t('admin.uf_username')}</label>
              <input className="form-control" value={uname} id="uf-username" autoComplete="off"
                onChange={e=>setUname(e.target.value)} placeholder={t('admin.uf_username_ph')} />
            </div>
            <div className="form-group"><label>{t('admin.uf_email')}</label><input className="form-control" type="email" value={email} onChange={e=>setEmail(e.target.value)} id="uf-email" /></div>
          </div>
          <div style={{ fontSize:11,color:'var(--subtle)',marginTop:-4,marginBottom:10 }}>
            {t('admin.uf_login_hint')}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('admin.uf_phone')} <span style={{ color:'var(--danger)' }}>*</span></label>
              <input className="form-control" type="tel" value={phone} id="uf-phone" required
                onChange={e => setPhone(e.target.value)} placeholder={t('admin.uf_phone_ph')} />
              {/* The placeholder read "Optional" under a field marked required.
                  The server has refused a blank number since the temporary
                  password started being built from it, so the form was
                  contradicting both the asterisk beside it and the rule. */}
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('admin.uf_phone_hint')}</div>
            </div>
            <div className="form-group" />
          </div>
          {/*
            Date of birth used to be here, and it was required.
            It fed one thing — the first-login password — and nothing else in
            the product ever read it. That password is built from the phone
            number above now, so the field has no reason to exist and asking
            for it would be collecting a personal identifier for nothing.
            What happens to the credential is explained below instead, since
            it depends on whether an address was given.
          */}
          {!isEdit && (
            <div className="alert alert-info" style={{ fontSize:12,marginBottom:12 }}>
              {email.trim() ? t('admin.uf_pw_will_email') : t('admin.uf_pw_will_derive')}
            </div>
          )}
          <div className="form-row">
            <div className="form-group"><label>{t('admin.uf_role')}</label>
              <select className="form-control" id="uf-role" value={role} onChange={e=>setRole(e.target.value)}>
                {/* An organisation has one Plant Head. Saying so in the option
                    beats a 409 after the form is filled in — the server still
                    refuses, but the admin should not have to discover the rule
                    by breaking it. */}
                {roleOptions.map(r => {
                  const heldBy = takenRoles[r];
                  const mine = heldBy && editUser && heldBy.user_id === editUser.id;
                  return (
                    <option key={r} value={r} disabled={!!heldBy && !mine}>
                      {formatRole(r, t)}
                      {heldBy && !mine ? ` — ${t('admin.uf_role_taken', { name: heldBy.name })}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="form-group"><label>{t('admin.uf_manager')}</label>
              <select className="form-control" id="uf-manager" value={mgr} onChange={e=>setMgr(e.target.value)}>
                <option value="">{t('admin.uf_none')}</option>
                {managers.filter(m=>m.id!==editUser?.id).map(m => <option key={m.id} value={m.id}>{m.name} ({formatRole(m.role, t)})</option>)}
              </select>
              {/* This field used to be documentation. It is now what decides
                  which approver an idea goes to — Jitesh's idea reaches Elisa
                  because Elisa is on this line, and reaches no other manager.
                  Left blank, the idea falls back to being offered to every
                  holder of the stage's role. */}
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>
                {t('admin.uf_manager_hint')}
              </div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>{t('admin.uf_dept')}</label><input className="form-control" value={dept} onChange={e=>setDept(e.target.value)} id="uf-dept" /></div>
            <div className="form-group"><label>{t('admin.uf_bu')}</label><input className="form-control" value={bu} onChange={e=>setBu(e.target.value)} id="uf-bu" /></div>
          </div>
          <div className="form-group"><label>{t('admin.uf_location')}</label><input className="form-control" value={loc} onChange={e=>setLoc(e.target.value)} id="uf-location" /></div>
          {isEdit && (
            <div className="form-group" id="uf-status-group"><label>{t('admin.uf_status')}</label>
              <select className="form-control" id="uf-status" value={status} onChange={e=>setStatus(e.target.value)}>
                <option value="active">{t('admin.active')}</option>
                <option value="inactive">{t('admin.inactive')}</option>
              </select>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" id="uf-submit-btn" disabled={saving} onClick={handleSubmit}>
            {saving ? t('btn.saving') : t(isEdit ? 'admin.uf_save_changes' : 'admin.uf_save_user')}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

// ── Approved Ideas tab — this tenant's approved ideas, pushable to QCMS ──────
const QCMS_BADGE = {
  imported:  ['#16a34a', '#dcfce7'],
  duplicate: ['#2563eb', '#dbeafe'],
  failed:    ['#dc2626', '#fee2e2'],
};
function qcmsBadge(status, t) {
  const [c, bg] = QCMS_BADGE[status] || ['#64748b', '#f1f5f9'];
  const label = status ? t('admin.qcms_status_' + status) : t('admin.qcms_status_none');
  return <span style={{ fontSize:11,fontWeight:700,padding:'2px 9px',borderRadius:20,color:c,background:bg,whiteSpace:'nowrap' }}>{label}</span>;
}

function ApprovedIdeasTab({ t, showToast }) {
  const [ideas,   setIdeas]   = useState([]);
  const [config,  setConfig]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [viewId,  setViewId]  = useState(null);

  /* Twenty to a page, like the other lists. An organisation with years of
     approved ideas otherwise renders every one of them at once. */
  const pager = usePager(ideas);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const [ir, cr] = await Promise.all([integrationApi.approvedIdeas(), integrationApi.getConfig()]);
      setIdeas(ir.data.ideas || []);
      setConfig(cr.data.config || null);
    } catch { showToast(t('msg.network_error'), 'danger'); }
    setLoading(false);
  }
  async function push(ideaIds) {
    setPushing(true);
    try {
      const res = await integrationApi.push(ideaIds ? { idea_ids: ideaIds } : { only_pending: true });
      if (res.data.success) {
        showToast(t('admin.qcms_push_result', { i: res.data.imported, d: res.data.duplicate, f: res.data.failed }),
          res.data.failed ? 'warning' : 'success');
        load();
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (err) { showToast(err.response?.data?.error || t('msg.server_error'), 'danger'); }
    setPushing(false);
  }

  if (loading) return <div className="empty-state"><div className="spinner"></div></div>;
  const notReady = !config?.enabled || !config?.api_key_set;

  return (
    <div style={{ marginTop:16 }}>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:12 }}>
        <div>
          <div style={{ fontWeight:700,fontSize:14 }}>{t('admin.approved_heading')}</div>
          <div style={{ fontSize:12,color:'var(--subtle)' }}>{t('admin.approved_sub')}</div>
        </div>
        <button className="btn btn-primary btn-sm" disabled={pushing || !ideas.length || notReady} onClick={() => push(null)}>
          {pushing ? t('msg.loading') : t('admin.qcms_push_all')}
        </button>
      </div>

      {notReady && <div className="alert alert-warning" style={{ fontSize:12 }}>{t('admin.qcms_not_configured')}</div>}

      {!ideas.length
        ? <div className="empty-state">{t('admin.approved_none')}</div>
        : (
          <div style={{ overflowX:'auto',border:'1px solid var(--border)',borderRadius:'var(--r)' }}>
            <table style={{ width:'100%',borderCollapse:'collapse',fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--panel-bg)',textAlign:'left' }}>
                  <th style={{ padding:'9px 12px' }}>{t('admin.col_code')}</th>
                  <th style={{ padding:'9px 12px' }}>{t('admin.col_title')}</th>
                  <th style={{ padding:'9px 12px' }}>{t('detail.submitted_by')}</th>
                  <th style={{ padding:'9px 12px' }}>{t('admin.uf_dept')}</th>
                  <th style={{ padding:'9px 12px' }}>QCMS</th>
                  <th style={{ padding:'9px 12px' }}></th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.map(i => (
                  <tr key={i.id} style={{ borderTop:'1px solid var(--border)' }}>
                    <td style={{ padding:'9px 12px',fontWeight:600 }}>{i.idea_code}</td>
                    <td style={{ padding:'9px 12px' }}>{i.title}</td>
                    <td style={{ padding:'9px 12px' }}>{i.is_anonymous ? t('form.anonymous') : i.submitter_name}</td>
                    <td style={{ padding:'9px 12px' }}>{i.department || '–'}</td>
                    <td style={{ padding:'9px 12px' }}>{qcmsBadge(i.qcms_push_status, t)}</td>
                    <td style={{ padding:'9px 12px',whiteSpace:'nowrap' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => setViewId(i.id)}>{t('admin.view')}</button>{' '}
                      <button className="btn btn-primary btn-sm" disabled={pushing || notReady} onClick={() => push([i.id])}>{t('admin.qcms_push')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager {...pager} noun="approved ideas" />
          </div>
        )
      }
      {viewId && <IdeaDetailModal ideaId={viewId} onClose={() => setViewId(null)} />}
    </div>
  );
}

// ── API & Integration tab — paste the QCMS key; push approved ideas ─────────
function IntegrationTab({ t, showToast }) {
  const [config,  setConfig]  = useState(null);
  const [apiKey,  setApiKey]  = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [pushing, setPushing] = useState(false);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const res = await integrationApi.getConfig();
      const c = res.data.config || {};
      setConfig(c); setEnabled(!!c.enabled); setApiKey('');
      // Show the override only; a blank field means "use the server default".
      setBaseUrl(c.base_url_custom ? c.base_url : '');
    } catch { showToast(t('msg.network_error'), 'danger'); }
    setLoading(false);
  }
  async function save() {
    setSaving(true);
    try {
      const body = { enabled, base_url: baseUrl.trim() };
      if (apiKey.trim()) body.api_key = apiKey.trim(); // sent only when actually typed
      const res = await integrationApi.saveConfig(body);
      if (res.data.success) {
        showToast(t('admin.qcms_saved'), 'success'); setApiKey('');
        const c = res.data.config; setConfig(c); setBaseUrl(c.base_url_custom ? c.base_url : '');
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (err) { showToast(err.response?.data?.error || t('msg.server_error'), 'danger'); }
    setSaving(false);
  }
  async function pushAll() {
    setPushing(true);
    try {
      const res = await integrationApi.push({ only_pending: true });
      if (res.data.success) showToast(t('admin.qcms_push_result', { i: res.data.imported, d: res.data.duplicate, f: res.data.failed }),
        res.data.failed ? 'warning' : 'success');
      else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (err) { showToast(err.response?.data?.error || t('msg.server_error'), 'danger'); }
    setPushing(false);
  }

  if (loading) return <div className="empty-state"><div className="spinner"></div></div>;
  // Preview the endpoint from what is typed (falling back to the server default),
  // so the admin sees where ideas will go before saving. Tolerate a base that
  // already ends in /ideas so we never show /ideas/ideas.
  const rawBase = (baseUrl.trim() || config?.default_base_url || '').replace(/\/+$/, '');
  const ideasUrl = /\/ideas$/i.test(rawBase) ? rawBase : `${rawBase}/ideas`;
  const endpoint = `POST ${ideasUrl}\nAuthorization: Bearer qcms_live_...\nContent-Type: application/json`;

  return (
    <div style={{ maxWidth:720,marginTop:16 }}>
      <div style={{ fontWeight:700,fontSize:14 }}>{t('admin.qcms_heading')}</div>
      <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:16 }}>{t('admin.qcms_sub')}</div>

      <div className="form-group">
        <label style={{ display:'flex',alignItems:'center',gap:8,cursor:'pointer' }}>
          <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} style={{ accentColor:'var(--primary)' }} />
          {t('admin.qcms_enabled')}
        </label>
      </div>

      <div className="form-group">
        <label>{t('admin.qcms_api_key')}<InfoDot term="qcms_api_key" /></label>
        <input className="form-control" type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)}
          autoComplete="off"
          placeholder={config?.api_key_set ? `•••••••• (${t('admin.qcms_key_set')})` : t('admin.qcms_key_ph')} />
        <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('admin.qcms_key_hint')}</div>
      </div>

      <div className="form-group">
        <label>{t('admin.qcms_base_url')}</label>
        <input className="form-control" type="url" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)}
          autoComplete="off" spellCheck={false} placeholder={config?.default_base_url} />
        <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>
          {t('admin.qcms_base_hint', { url: config?.default_base_url || '' })}
        </div>
      </div>

      <div style={{ display:'flex',gap:10,marginTop:8 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? t('btn.saving') : t('btn.save')}</button>
        <button className="btn btn-outline" disabled={pushing || !enabled || !config?.api_key_set} onClick={pushAll}>
          {pushing ? t('msg.loading') : t('admin.qcms_push_all')}
        </button>
      </div>

      <div className="card" style={{ marginTop:22,background:'var(--panel-bg)' }}>
        <div style={{ fontWeight:700,fontSize:12.5,marginBottom:4 }}>{t('admin.qcms_endpoint_title')}</div>
        <div style={{ fontSize:11.5,color:'var(--subtle)',marginBottom:10 }}>{t('admin.qcms_endpoint_sub')}</div>
        <pre style={{ fontSize:11,background:'#0f172a',color:'#e2e8f0',padding:'12px 14px',borderRadius:8,overflowX:'auto',margin:0,whiteSpace:'pre' }}>{endpoint}</pre>
        <div style={{ fontSize:11,color:'var(--subtle)',marginTop:10,lineHeight:1.7 }}>
          <strong>201</strong> {t('admin.qcms_code_201')} &nbsp;·&nbsp; <strong>409</strong> {t('admin.qcms_code_409')} &nbsp;·&nbsp;
          <strong>401</strong> {t('admin.qcms_code_401')} &nbsp;·&nbsp; <strong>429</strong> {t('admin.qcms_code_429')}
        </div>
      </div>
    </div>
  );
}
