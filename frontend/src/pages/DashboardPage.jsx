import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { ideasApi } from '../services/api';
import { animateCounter, actionLabel, timeAgo, isPrivileged, translateStatus } from '../utils/helpers';
import ManualButton from '../components/ManualButton';

const STATUS_COLORS = {
  'Submitted':'#2563eb','Under Review':'#d97706','Approved':'#16a34a',
  'Rejected':'#dc2626','Implemented':'#4f46e5','Draft':'#94a3b8',
};

export default function DashboardPage() {
  const { user }   = useAuth();
  const { t }      = useLang();
  const navigate   = useNavigate();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const kpiRef = useRef(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await ideasApi.dashboard();
      setData(res.data);
    } catch { setError(t('msg.fail_dashboard')); }
    setLoading(false);
  }

  // Animate KPI counters after data renders
  useEffect(() => {
    if (!data) return;
    const els = document.querySelectorAll('#dash-kpis .kpi-val[data-target]');
    els.forEach(el => animateCounter(el, parseInt(el.dataset.target), 900));
    // Animate bar fills
    setTimeout(() => {
      document.querySelectorAll('#dash-status-chart .bar-fill[data-w]').forEach((bar, i) => {
        setTimeout(() => {
          bar.style.transition = 'width .7s cubic-bezier(.4,0,.2,1)';
          bar.style.width = bar.dataset.w + '%';
        }, i * 80);
      });
    }, 150);
  }, [data]);

  if (loading) return <div className="empty-state"><div className="spinner"></div></div>;
  if (error)   return <div className="alert alert-danger">{error}</div>;
  if (!data)   return null;

  const counts   = data.counts || {};
  const total    = Object.values(counts).reduce((a,b) => a + b, 0);
  const maxCount = Math.max(...Object.values(counts), 1);
  const isReviewer = isPrivileged(user?.role);

  /*
   * Time of day from the browser, not the server. The server runs in UTC on a
   * host in another country; greeting somebody "good evening" over their
   * morning tea is the kind of small wrongness that makes software feel like it
   * was built for somebody else.
   */
  const hour = new Date().getHours();
  const greetKey = hour < 12 ? 'dash.greet_morning'
    : hour < 17 ? 'dash.greet_afternoon'
    : 'dash.greet_evening';
  const firstName = String(user?.name || '').trim().split(/\s+/)[0];

  return (
    <>
      {/*
        The page used to open on a wall of counters. A dashboard's first job is
        to tell somebody what to do next, and for almost everybody here that is
        "raise the thing you came to raise" — so the action is at the top, in
        front of the numbers, rather than behind a sidebar link.
      */}
      <div style={{ display:'flex',alignItems:'flex-end',justifyContent:'space-between',
        gap:16,flexWrap:'wrap',marginBottom:18 }}>
        <div>
          <h1 style={{ fontSize:22,fontWeight:800,color:'var(--heading)',margin:0,
            letterSpacing:'-.4px' }}>
            {t(greetKey, { name: firstName })}
          </h1>
          <div style={{ fontSize:13,color:'var(--subtle)',marginTop:4 }}>
            {isReviewer && data.pending_reviews > 0
              ? t('dash.sub_reviewer', { n: data.pending_reviews })
              : t('dash.sub_employee')}
          </div>
        </div>
        <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
          {isReviewer && data.pending_reviews > 0 && (
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/review')}>
              {t('dash.go_review', { n: data.pending_reviews })}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/submit')}>
            {t('dash.go_submit')}
          </button>
          {/* Which manual arrives is decided by the server from the session
              role, so this is the same component on all three dashboards. */}
          <ManualButton />
        </div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid" id="dash-kpis">
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background:'var(--primary-light)',color:'var(--primary)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
              <path d="M9 21h6M12 3a6 6 0 016 6c0 2.2-1.1 3.8-2.5 5L15 16H9l-.5-2C7 12.8 6 11.2 6 9a6 6 0 016-6z"/>
            </svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-val" data-target={total}>0</div>
            <div className="kpi-label">{t('dash.total')}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background:'var(--warning-light)',color:'var(--warning)' }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-val" data-target={counts['Under Review']||0}>0</div>
            <div className="kpi-label">{t('status.review')}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background:'var(--success-light)',color:'var(--success)' }}>
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-val" data-target={counts['Approved']||0}>0</div>
            <div className="kpi-label">{t('dash.approved')}</div>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon" style={{ background:'var(--surface-2)',color:'var(--text-muted)' }}>
            <svg viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div className="kpi-body">
            <div className="kpi-val" data-target={counts['Implemented']||0}>0</div>
            <div className="kpi-label">{t('dash.implemented')}</div>
          </div>
        </div>

        {isReviewer && (data.pending_reviews > 0) && (
          <div className="kpi-card" style={{ cursor:'pointer' }} onClick={() => navigate('/review')}>
            <div className="kpi-icon" style={{ background:'var(--info-light)',color:'var(--info)' }}>
              <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/><polyline points="9 14 11 16 15 12"/></svg>
            </div>
            <div className="kpi-body">
              <div className="kpi-val" data-target={data.pending_reviews||0}>0</div>
              <div className="kpi-label">{t('dash.pending_review')}</div>
            </div>
          </div>
        )}

        {isReviewer && (data.overdue_reviews > 0) && (
          <div className="kpi-card" style={{ cursor:'pointer' }} onClick={() => navigate('/review')}>
            <div className="kpi-icon" style={{ background:'var(--danger-light)',color:'var(--danger)' }}>
              <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </div>
            <div className="kpi-body">
              <div className="kpi-val" data-target={data.overdue_reviews||0}>0</div>
              <div className="kpi-label">{t('dash.overdue_reviews')}</div>
            </div>
          </div>
        )}
      </div>

      {/* Status Distribution Bar Chart */}
      {/* auto-fit rather than 1fr 1fr: on a narrow screen the two panels stack
          instead of being squeezed into unreadable halves. */}
      <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',
        gap:20,marginTop:20 }}>
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontWeight: 750, fontSize: 14, color: 'var(--heading)' }}>{t('dash.status_dist')}</div>
            <span style={{ fontSize: 11, color: 'var(--subtle)', fontWeight: 600 }}>
              {t('dash.total_n', { n: data.total || 0 })}
            </span>
          </div>
          <div className="bar-chart" id="dash-status-chart">
            {Object.entries(counts).map(([s, c]) => (
              <div className="bar-row" key={s} style={{ marginBottom: 10 }}>
                <span className="bar-label" style={{ fontWeight: 600 }}>{translateStatus(s, t)}</span>
                <div className="bar-track" style={{ height: 8, borderRadius: 999 }}>
                  <div className="bar-fill" style={{ width:'0%',height:'100%',borderRadius:999,background:STATUS_COLORS[s]||'#ccc' }} data-w={Math.round(c/maxCount*100)}></div>
                </div>
                <span className="bar-val" style={{ fontWeight: 700 }}>{c}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity Timeline */}
        <div className="card" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontWeight: 750, fontSize: 14, color: 'var(--heading)' }}>{t('dash.recent_activity')}</div>
            <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700 }}>
              {t('dash.recent_tag')}
            </span>
          </div>
          <div id="dash-activity">
            {!data.recent?.length
              ? <div className="empty-state">{t('msg.no_ideas')}</div>
              : data.recent.map((r, i) => (
                <div className="tl-item" key={i}>
                  <div className="tl-dot tl-dot-blue">{actionLabel(r.action)}</div>
                  <div>
                    <div className="tl-title">{r.idea_code} — {translateStatus(r.action, t)}</div>
                    <div className="tl-meta">{r.actor_name} · {timeAgo(r.created_at, t)}</div>
                    {r.comment && <div className="tl-comment">{r.comment}</div>}
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </>
  );
}
