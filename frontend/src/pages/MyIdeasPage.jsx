import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { ideasApi } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, translateAreas, fmtDate, engagementIndex } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';

function EngBadge({ aiScore, avgRating, voteCount, t }) {
  const ei = engagementIndex(aiScore, avgRating, voteCount);
  if (!aiScore && !voteCount) return null;
  const tier = ei >= 70 ? { bg:'#bbf7d0',color:'#065f46',lbl:t('eng.high') }
             : ei >= 40 ? { bg:'#fef3c7',color:'#92400e',lbl:t('eng.med')  }
             : { bg:'#fee2e2',color:'#991b1b',lbl:t('eng.low') };
  return (
    <span style={{ fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:20,background:tier.bg,color:tier.color,border:`1px solid ${tier.bg}` }}>
      EI:{ei} {tier.lbl}
    </span>
  );
}

function EngMiniStats({ avgRating, voteCount }) {
  if (!avgRating && !voteCount) return null;
  return (
    <span style={{ fontSize:11,color:'var(--subtle)',display:'flex',alignItems:'center',gap:6 }}>
      {avgRating > 0 && <span>Rating {parseFloat(avgRating).toFixed(1)}</span>}
      {voteCount > 0 && <span>Votes {voteCount}</span>}
    </span>
  );
}

export default function MyIdeasPage() {
  const { t } = useLang();
  const [all,     setAll]     = useState([]);
  const [ideas,   setIdeas]   = useState([]);
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [openId,  setOpenId]  = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await ideasApi.my();
      const list = res.data.ideas || [];
      setAll(list);
      setIdeas(list);
    } catch { setError(t('msg.fail_ideas')); }
    setLoading(false);
  }

  useEffect(() => {
    const q  = search.toLowerCase();
    const st = status;
    setIdeas(all.filter(i =>
      (String(i.title || '').toLowerCase().includes(q) || String(i.idea_code || '').toLowerCase().includes(q)) &&
      (!st || i.status === st)
    ));
  }, [search, status, all]);

  return (
    <>
      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="form-control"
          type="search"
          placeholder={t('filter.search_ideas')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth:280 }}
        />
        <select className="form-control" value={status} onChange={e => setStatus(e.target.value)} style={{ width:160 }}>
          <option value="">{t('filter.all_statuses')}</option>
          {['Draft','Submitted','Under Review','Approved','Rejected','Implemented'].map(s => (
            <option key={s} value={s}>{translateStatus(s, t)}</option>
          ))}
        </select>
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && !ideas.length && (
        <div className="empty-state">{t('msg.no_ideas')}</div>
      )}

      <div id="my-ideas-list">
        {ideas.map(i => (
          <div key={i.id} className="idea-card" data-status={i.status} onClick={() => setOpenId(i.id)}>
            <div className="idea-card-header">
              <div>
                <div className="idea-card-id">#{i.idea_code}</div>
                <div className="idea-card-title">{i.title}</div>
              </div>
              <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4 }}>
                <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status, t)}</span>
                {i.ai_score > 0 && <span className={scoreBadgeClass(i.ai_score)}>{i.ai_score}/100</span>}
                {i.status !== 'Draft' && <EngBadge aiScore={i.ai_score} avgRating={i.avg_rating} voteCount={i.vote_count} t={t} />}
              </div>
            </div>
            <div className="idea-card-meta">
              {translateAreas(i.impact_areas, t) || '—'} · {i.submitted_at ? fmtDate(i.submitted_at) : translateStatus('Draft', t)}
            </div>
            {i.status !== 'Draft' && <div style={{ marginTop:4 }}><EngMiniStats avgRating={i.avg_rating} voteCount={i.vote_count} /></div>}
            <div className="idea-card-footer">
              <span className={`badge ${impactBadge(i.impact_level)}`}>
                {translateImpact(i.impact_level, t)||'–'} {t('idea.impact_suffix')}
              </span>
              <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                {i.points_awarded > 0 && <span className="points-badge">+{i.points_awarded} {t('unit.pts')}</span>}
                <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); setOpenId(i.id); }}>
                  {t('btn.view')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </>
  );
}
