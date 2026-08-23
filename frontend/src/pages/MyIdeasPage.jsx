import { useState, useEffect } from 'react';
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

      {/*
        One row per idea.
        As cards, an author scanning for "which of mine is still sitting in
        review" had to read every card in full, because status lived in a
        different spot depending on how long the title was. In a column the
        answer is found without reading anything.
      */}
      <div className="card" style={{ overflowX:'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('table.code')}</th>
              <th>{t('table.title')}</th>
              <th>{t('table.impact_areas')}</th>
              <th>{t('table.impact')}</th>
              <th>{t('table.score')}</th>
              <th>{t('table.engagement')}</th>
              <th>{t('table.status')}</th>
              <th>{t('table.points')}</th>
              <th>{t('audit.when')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="my-ideas-list">
            {loading && <tr><td colSpan="10" className="text-center"><div className="spinner"></div></td></tr>}
            {!loading && !error && !ideas.length && (
              <tr><td colSpan="10" className="text-center">{t('msg.no_ideas')}</td></tr>
            )}
            {pager.slice.map(i => (
              <tr key={i.id} data-status={i.status} style={{ cursor:'pointer' }} onClick={() => setOpenId(i.id)}>
                <td><strong>{i.idea_code}</strong></td>
                <td title={i.title}><div className="cell-clamp" style={{ maxWidth:280 }}>{i.title}</div></td>
                <td style={{ color:'var(--text-muted)',fontSize:12.5 }}>
                  <div className="cell-clamp" style={{ maxWidth:200 }}>{translateAreas(i.impact_areas, t) || '—'}</div>
                </td>
                <td><span className={`badge ${impactBadge(i.impact_level)}`}>{translateImpact(i.impact_level, t)||'–'}</span></td>
                <td>
                  {i.ai_score > 0
                    ? <span className={scoreBadgeClass(i.ai_score)}>{i.ai_score}/100</span>
                    : <span className="score-none score-badge">—</span>}
                </td>
                {/* A draft has been seen by nobody, so it has no engagement to
                    report - an empty cell here means "not yet", not "zero". */}
                <td style={{ whiteSpace:'nowrap' }}>
                  {i.status !== 'Draft'
                    ? <div style={{ display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
                        <EngBadge aiScore={i.ai_score} avgRating={i.avg_rating} voteCount={i.vote_count} t={t} />
                        <EngMiniStats avgRating={i.avg_rating} voteCount={i.vote_count} />
                      </div>
                    : <span style={{ color:'var(--subtle)' }}>—</span>}
                </td>
                <td>
                  <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status, t)}</span>
                  <QcBadge status={i.qcms_push_status} />
                </td>
                <td>
                  {i.points_awarded > 0
                    ? <span className="points-badge">+{i.points_awarded} {t('unit.pts')}</span>
                    : <span style={{ color:'var(--subtle)' }}>—</span>}
                </td>
                <td style={{ whiteSpace:'nowrap' }}>
                  {i.submitted_at ? fmtDateTime(i.submitted_at) : translateStatus('Draft', t)}
                </td>
                <td>
                  <button className="btn btn-outline btn-sm" onClick={e => { e.stopPropagation(); setOpenId(i.id); }}>
                    {t('btn.view')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager {...pager} noun="ideas" />
      </div>

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </>
  );
}
