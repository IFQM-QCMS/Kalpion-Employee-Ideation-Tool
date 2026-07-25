import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { usersApi, ideasApi, scoreApi } from '../services/api';
import { formatRole, timeAgo, translateStatus, fmtDate } from '../utils/helpers';

const ROLE_COLORS = {
  admin:'#374151', executive:'#4b5563', plant_head:'#52525b', senior_manager:'#6b7280', department_manager:'#d97706',
  manager:'#f59e0b', project_lead:'#0891b2', team_lead:'#0284c7',
  employee:'#10b981', trainee:'#64748b',
};

function renderHierarchyNode(node, depth, t) {
  const color = ROLE_COLORS[node.role] || '#888';
  const ml = depth * 36;
  const children = node.children || [];
  const sorted = [...children].sort((a, b) => {
    const o = { manager:0, employee:1 };
    return (o[a.role]??2) - (o[b.role]??2) || a.name.localeCompare(b.name);
  });
  return (
    <div key={node.id} style={{ position:'relative',marginLeft:ml,marginBottom:8 }}>
      {depth > 0 && <div style={{ position:'absolute',left:-18,top:'50%',width:14,height:1,background:'var(--border)' }}></div>}
      <div style={{ borderLeft:`3px solid ${color}`,padding:'11px 16px',background:'var(--surface)',borderRadius:'var(--r)',boxShadow:'var(--shadow-sm)',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap' }}>
        <div className="avatar" style={{ background:`linear-gradient(135deg,${color},${color}cc)`,flexShrink:0,fontWeight:800 }}>
          {node.avatar_initials || node.name?.[0] || '?'}
        </div>
        <div style={{ flex:1,minWidth:180 }}>
          <div style={{ fontWeight:700,fontSize:13,color:'var(--text)' }}>{node.name}</div>
          <div style={{ fontSize:11,color:'var(--subtle)',marginTop:2 }}>{node.employee_id} · {node.department||'–'} · {node.location||'–'}</div>
        </div>
        <span className="badge" style={{ background:`${color}18`,color,border:`1px solid ${color}40`,fontWeight:700 }}>{formatRole(node.role, t)}</span>
        <div style={{ display:'flex',gap:16,fontSize:12,color:'var(--subtle)' }}>
          <span title={t('table.points')}><strong style={{ color:'var(--text)' }}>{node.points}</strong> {t('unit.pts')}</span>
          <span title={t('table.ideas')}><strong style={{ color:'var(--text)' }}>{node.idea_count}</strong> {t('unit.ideas')}</span>
        </div>
      </div>
      {sorted.map(c => renderHierarchyNode(c, depth + 1, t))}
    </div>
  );
}

const TAB_KEYS = ['sa.tab_overview','sa.tab_hierarchy','sa.tab_users','sa.tab_system'];

export default function SuperAdminPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const [tab,         setTab]         = useState(0);
  const [data,        setData]        = useState(null);
  const [dash,        setDash]        = useState(null);
  const [userSearch,  setUserSearch]  = useState('');
  const [rescoreMsg,  setRescoreMsg]  = useState('');
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [hierRes, dashRes] = await Promise.all([
        usersApi.hierarchy(),
        ideasApi.dashboard(),
      ]);
      setData(hierRes.data);
      setDash(dashRes.data);
      setLastUpdated(t('sa.last_refreshed') + ' ' + new Date().toLocaleTimeString());
    } catch {}
    setLoading(false);
  }

  async function handleRescore() {
    setRescoreMsg('');
    try {
      const res = await scoreApi.batchRescore();
      if (res.data.success) setRescoreMsg(`✓ ${t('msg.rescore_ok', { n: res.data.updated })}`);
      else setRescoreMsg(`${t('msg.error')}: ` + (res.data.error||''));
    } catch { setRescoreMsg(t('msg.server_error')); }
  }

  if (loading) return <div className="empty-state"><div className="spinner"></div></div>;
  if (!data)   return <div className="alert alert-danger">{t('msg.fail_load')}</div>;

  const s        = data.stats || {};
  const counts   = dash?.counts || {};
  const pending  = (counts['Submitted']||0) + (counts['Under Review']||0);
  const users    = data.users || [];

  // Build hierarchy tree
  const byId = {};
  users.forEach(u => { byId[u.id] = { ...u, children:[] }; });
  const roots = [];
  users.forEach(u => {
    if (u.manager_id && byId[u.manager_id]) byId[u.manager_id].children.push(byId[u.id]);
    else roots.push(byId[u.id]);
  });
  const rootOrder = { admin:0,executive:1,manager:2,employee:3 };
  roots.sort((a,b) => (rootOrder[a.role]??9)-(rootOrder[b.role]??9) || a.name.localeCompare(b.name));

  const filteredUsers = users.filter(u => {
    const q = userSearch.toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.employee_id||'').toLowerCase().includes(q);
  });

  const kpiStrip = [
    [t('dash.total'),       dash?.total||0,          'var(--heading)', t('sa.sub_excl_drafts')],
    [t('status.review'),    pending,                 'var(--warning)', t('sa.sub_pending')],
    [t('dash.approved'),    counts['Approved']||0,   'var(--success)', t('sa.sub_awaiting')],
    [t('dash.implemented'), counts['Implemented']||0,'var(--primary)', t('sa.sub_completed')],
    [t('pa.total_users'),   s.total||0,              'var(--heading)', t('sa.sub_breakdown', { a: s.admins||0, m: s.managers||0, e: s.employees||0 })],
    [t('sa.executives'),    s.executives||0,         'var(--info)',    t('sa.sub_exec_accounts')],
  ];

  const statusColors = { 'Submitted':'#2563eb','Under Review':'#d97706','Approved':'#16a34a','Rejected':'#dc2626','Implemented':'#4f46e5' };

  return (
    <>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
        <span style={{ fontSize:11,color:'var(--subtle)' }} id="sa-last-updated">{lastUpdated}</span>
        <button className="btn btn-outline btn-sm" onClick={load}>↺ {t('btn.refresh')}</button>
      </div>

      {/* KPI Strip */}
      <div className="kpi-grid" id="sa-kpi-strip">
        {kpiStrip.map(([label, val, color, sub]) => (
          <div key={label} className="kpi-card">
            <div className="kpi-val" style={{ color }}>{val}</div>
            <div className="kpi-label">{label}</div>
            <div style={{ fontSize:10,color:'var(--subtle)',marginTop:3 }}>{sub}</div>
          </div>
        ))}
      </div>

      <div className="tab-bar" style={{ marginTop:20 }}>
        {TAB_KEYS.map((key, i) => (
          <div key={key} className={`tab${tab===i?' active':''}`} onClick={() => setTab(i)}>{t(key)}</div>
        ))}
      </div>

      {/* Overview */}
      {tab === 0 && (
        <>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:20,marginTop:16 }}>
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:12 }}>{t('dash.status_dist')}</div>
            <div className="bar-chart" id="sa-status-dist">
              {Object.entries(statusColors).map(([s,color]) => (
                <div className="bar-row" key={s}>
                  <span className="bar-label">{translateStatus(s,t)}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width:`${Math.round((counts[s]||0)/Math.max(Object.values(counts).reduce((a,b)=>a+b,0),1)*100)}%`,background:color }}></div>
                  </div>
                  <span className="bar-val">{counts[s]||0}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:12 }}>{t('dash.recent_activity')}</div>
            <div id="sa-recent-activity">
              {!(dash?.recent?.length)
                ? <div style={{ color:'var(--subtle)',fontSize:13,padding:'10px 0' }}>{t('msg.no_ideas')}</div>
                : dash.recent.map((r, i) => (
                  <div key={i} className="tl-item">
                    <div className="tl-dot tl-dot-blue" style={{ fontSize:9,fontWeight:800 }}>{(r.action||'').substring(0,3).toUpperCase()}</div>
                    <div>
                      <div className="tl-title">{r.idea_code} — {r.title||''}</div>
                      <div style={{ fontSize:11,color:'var(--subtle)',marginTop:2 }}>{translateStatus(r.action, t)} · <strong>{r.actor_name}</strong> · {timeAgo(r.created_at,t)}</div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>

        {/* Monthly submission activity (last 12 months) */}
        <div className="card" style={{ marginTop:20 }}>
          <div style={{ fontWeight:700,fontSize:13,marginBottom:12 }}>{t('sa.monthly_activity')}</div>
          {!(dash?.monthly?.length)
            ? <div style={{ color:'var(--subtle)',fontSize:13,padding:'10px 0' }}>{t('msg.no_ideas')}</div>
            : (
              <div className="bar-chart" id="sa-monthly-activity">
                {dash.monthly.map((m) => {
                  const max = Math.max(...dash.monthly.map(x => x.count), 1);
                  return (
                    <div className="bar-row" key={m.month}>
                      <span className="bar-label">{m.month}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width:`${Math.round(m.count/max*100)}%`,background:'var(--primary)' }}></div>
                      </div>
                      <span className="bar-val">{m.count}</span>
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
        </>
      )}

      {/* Hierarchy */}
      {tab === 1 && (
        <div className="card" style={{ marginTop:16 }}>
          {/* Bulk import can put thousands of employees in a tenant. The org
              chart renders a node per person and recurses through the reporting
              lines, so past a few thousand it simply locks the tab up. Say so
              instead of hanging. */}
          {data.truncated && (
            <div className="alert alert-warning" style={{ marginBottom:12,fontSize:12,lineHeight:1.6 }}>
              {t('sa.too_many_tree', { shown: data.limit, total: data.stats?.total ?? 0 })}
            </div>
          )}
          <div id="hierarchy-tree">
            {roots.length
              ? roots.map(n => renderHierarchyNode(n, 0, t))
              : <div style={{ color:'var(--subtle)',padding:16 }}>{t('sa.no_users')}</div>
            }
          </div>
        </div>
      )}

      {/* Users */}
      {tab === 2 && (
        <div style={{ marginTop:16 }}>
          <input className="form-control" type="search" placeholder={t('filter.search_users')}
            value={userSearch} onChange={e => setUserSearch(e.target.value)}
            id="sa-user-search" style={{ maxWidth:320,marginBottom:12 }} />
          <div className="card" style={{ overflowX:'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('table.user')}</th><th>{t('table.emp_id')}</th><th>{t('table.role')}</th><th>{t('table.dept')}</th>
                  <th>{t('table.bu')}</th><th>{t('table.email')}</th><th>{t('table.manager')}</th><th>{t('table.points')}</th><th>{t('table.ideas')}</th>
                </tr>
              </thead>
              <tbody id="hierarchy-users-tbody">
                {!filteredUsers.length && <tr><td colSpan="9" className="text-center">{t('sa.no_users')}</td></tr>}
                {filteredUsers.map(u => {
                  const color = ROLE_COLORS[u.role] || '#888';
                  return (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display:'flex',alignItems:'center',gap:9 }}>
                          <div className="avatar" style={{ background:`linear-gradient(135deg,${color},${color}99)` }}>
                            {u.avatar_initials||u.name?.[0]||'?'}
                          </div>
                          <div>
                            <div style={{ fontWeight:600 }}>{u.name}</div>
                            <div style={{ fontSize:11,color:'var(--subtle)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize:12,color:'var(--subtle)' }}>{u.employee_id}</td>
                      <td><span className="badge" style={{ background:`${color}18`,color,border:`1px solid ${color}40` }}>{formatRole(u.role, t)}</span></td>
                      <td>{u.department||'–'}</td>
                      <td>{u.business_unit||'–'}</td>
                      <td style={{ fontSize:12 }}>{u.email}</td>
                      <td style={{ fontSize:12,color:'var(--subtle)' }}>{u.manager_name||'—'}</td>
                      <td><strong>{u.points}</strong></td>
                      <td>{u.idea_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* System */}
      {tab === 3 && (
        <div style={{ marginTop:16,maxWidth:480 }}>
          <div className="card">
            <div style={{ fontWeight:700,fontSize:13,marginBottom:12 }}>{t('sa.rescore_title')}</div>
            <p style={{ fontSize:13,color:'var(--subtle)',marginBottom:12 }}>
              {t('sa.rescore_desc')}
            </p>
            <button className="btn btn-warning" id="sa-rescore-btn" onClick={handleRescore}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign:'middle',marginRight:4 }}>
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
              </svg>
              <span>{t('btn.rescore_all')}</span>
            </button>
            {rescoreMsg && <div id="sa-rescore-result" style={{ marginTop:8,fontSize:13 }}>{rescoreMsg}</div>}
          </div>
        </div>
      )}
    </>
  );
}
