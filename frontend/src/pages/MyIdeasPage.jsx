import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLang } from '../context/LangContext';
import { ideasApi } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, translateAreas, fmtDateTime, engagementIndex } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import QcBadge from '../components/QcBadge';
import Pager, { usePager } from '../components/Pager';

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
  // /my-ideas?idea=<id> - the link every email about an idea carries.
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    const id = Number(params.get('idea')) || 0;
    if (id) setOpenId(id);
  }, [params]);
  const pager = usePager(ideas);

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

      {error && <div className="alert alert-danger">{error}</div>}

      {loading && <div className="card text-center"><div className="spinner"></div></div>}
      {!loading && !error && !ideas.length && <div className="card text-center">{t('msg.no_ideas')}</div>}

      {/*
       * One card per idea, not a many-column table - status stays pinned in its own slot at
       * the top right regardless of title length. An earlier card layout here put status
       * inline after the title text instead, so its position drifted row to row and made the
       * column impossible to scan; that is fixed by giving it a fixed flex slot rather than
       * letting it flow with the text.
       */}
      {!loading && !error && !!ideas.length && (
        <div className="idea-list">
          {pager.slice.map(i => (
            <div key={i.id} className="idea-card is-clickable" data-status={i.status} onClick={() => setOpenId(i.id)}>
              <div className="idea-card-top">
                <div className="idea-card-id">
                  <div className="idea-card-code">{i.idea_code}</div>
                  <div className="idea-card-title">{i.title}</div>
                </div>
                <div className="idea-card-badges">
                  <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status, t)}</span>
                  {/* A draft that came back from a reviewer is not just a draft. */}
                  {i.returned_at && i.status === 'Draft' && (
                    <span className="badge badge-rejected">{t('idea.returned_badge')}</span>
                  )}
                  <QcBadge status={i.qcms_push_status} />
                </div>
              </div>

              <div className="idea-card-meta">
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('table.impact_areas')}</span>
                  <span className="idea-card-meta-value">{translateAreas(i.impact_areas, t) || '-'}</span>
                </div>
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('table.impact')}</span>
                  <span className="idea-card-meta-value">
                    <span className={`badge ${impactBadge(i.impact_level)}`}>{translateImpact(i.impact_level, t)||'-'}</span>
                  </span>
                </div>
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('table.score')}</span>
                  <span className="idea-card-meta-value">
                    {i.ai_score > 0
                      ? <span className={scoreBadgeClass(i.ai_score)}>{i.ai_score}/100</span>
                      : <span className="score-none score-badge">-</span>}
                  </span>
                </div>
                {/* A draft has been seen by nobody, so it has no engagement to report - an empty slot here means "not yet", not "zero". */}
                {i.status !== 'Draft' && (
                  <div className="idea-card-meta-item">
                    <span className="idea-card-meta-label">{t('table.engagement')}</span>
                    <span className="idea-card-meta-value" style={{ display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
                      <EngBadge aiScore={i.ai_score} avgRating={i.avg_rating} voteCount={i.vote_count} t={t} />
                      <EngMiniStats avgRating={i.avg_rating} voteCount={i.vote_count} />
                    </span>
                  </div>
                )}
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('table.points')}</span>
                  <span className="idea-card-meta-value">
                    {i.points_awarded > 0
                      ? <span className="points-badge">+{i.points_awarded} {t('unit.pts')}</span>
                      : '-'}
                  </span>
                </div>
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('audit.when')}</span>
                  <span className="idea-card-meta-value">
                    {i.submitted_at ? fmtDateTime(i.submitted_at) : translateStatus('Draft', t)}
                  </span>
                </div>
              </div>

              <div className="idea-card-actions align-end">
                {/* An unfinished draft's next step is finishing it, not reading it. */}
                {i.status === 'Draft' ? (
                  <button className="btn btn-primary btn-sm"
                    onClick={e => { e.stopPropagation(); navigate(`/submit?edit=${i.id}`); }}>
                    {t('idea.continue_draft')}
                  </button>
                ) : (
                  <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); setOpenId(i.id); }}>
                    {t('btn.view')}
                  </button>
                )}
              </div>
            </div>
          ))}
          <Pager {...pager} noun="ideas" />
        </div>
      )}

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => {
        setOpenId(null);
        if (params.get('idea')) setParams({}, { replace: true });
        load();
      }} />}
    </>
  );
}
