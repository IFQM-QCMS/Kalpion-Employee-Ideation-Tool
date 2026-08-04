import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi, votesApi } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, fmtDate, communityScore } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';

function VoteWidget({ ideaId, isSelf, upvotes, downvotes, userVote, onVote }) {
  return (
    <div style={{ display:'inline-flex',alignItems:'center',gap:4 }}>
      <button
        className="btn btn-sm"
        style={{ padding:'2px 6px',fontSize:11,borderRadius:6,
          background:userVote==='up'?'#bbf7d0':'var(--chip-bg)',
          color:userVote==='up'?'#10b981':'var(--text-muted)',
          border:`1px solid ${userVote==='up'?'#bbf7d0':'var(--border)'}` }}
        onClick={() => !isSelf && onVote(ideaId,'up')}
        disabled={isSelf}
      >▲ {upvotes}</button>
      <button
        className="btn btn-sm"
        style={{ padding:'2px 6px',fontSize:11,borderRadius:6,
          background:userVote==='down'?'#fee2e2':'var(--chip-bg)',
          color:userVote==='down'?'#ef4444':'var(--text-muted)',
          border:`1px solid ${userVote==='down'?'#fecaca':'var(--border)'}` }}
        onClick={() => !isSelf && onVote(ideaId,'down')}
        disabled={isSelf}
      >▼ {downvotes}</button>
    </div>
  );
}

export default function AllIdeasPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const [ideas,   setIdeas]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('');
  const [impact,  setImpact]  = useState('');
  const [openId,  setOpenId]  = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    loadIdeas();
    pollRef.current = setInterval(loadIdeas, 10000);
    return () => clearInterval(pollRef.current);
  }, [search, status, impact]);

  async function loadIdeas() {
    try {
      const res = await ideasApi.list({ search, status, impact });
      setIdeas(res.data.ideas || []);
    } catch { /* non-blocking poll */ }
    setLoading(false);
  }

  async function castVote(ideaId, voteType) {
    try {
      const res = await votesApi.communityVote({ idea_id: ideaId, vote_type: voteType });
      if (res.data.success) loadIdeas();
      else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  return (
    <>
      <div className="filter-bar">
        <input className="form-control" type="search" placeholder={t('filter.search_ideas')}
          value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth:260 }} />
        <select className="form-control" value={status} onChange={e => setStatus(e.target.value)} style={{ width:160 }}>
          <option value="">{t('filter.all_statuses')}</option>
          {['Submitted','Under Review','Approved','Rejected','Implemented'].map(s => (
            <option key={s} value={s}>{translateStatus(s, t)}</option>
          ))}
        </select>
        <select className="form-control" value={impact} onChange={e => setImpact(e.target.value)} style={{ width:160 }}>
          <option value="">{t('filter.all_impact')}</option>
          {['High','Medium','Low'].map(l => (
            <option key={l} value={l}>{translateImpact(l, t)}</option>
          ))}
        </select>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card" style={{ overflowX:'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('table.code')}</th>
              <th>{t('table.title')}</th>
              <th>{t('table.solution_gist')}</th>
              <th>{t('table.submitter')}</th>
              <th>{t('table.dept')}</th>
              <th>{t('table.impact')}</th>
              <th>{t('table.score')}</th>
              <th>{t('table.votes')}</th>
              <th>{t('table.status')}</th>
              <th>{t('table.date')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="all-ideas-tbody">
            {loading && (
              <tr><td colSpan="11" className="text-center"><div className="spinner"></div></td></tr>
            )}
            {!loading && !ideas.length && (
              <tr><td colSpan="11" className="text-center">{t('msg.no_ideas')}</td></tr>
            )}
            {ideas.map(i => {
              const isSelf  = parseInt(i.submitter_id) === parseInt(user?.id);
              const cScore  = communityScore(i.ai_score, i.upvotes||0, i.downvotes||0);
              return (
                <tr key={i.id}>
                  <td><strong>{i.idea_code}</strong></td>
                  <td title={i.title}>{i.title.length > 60 ? i.title.substring(0,60)+'…' : i.title}</td>
                  {/* One line only. The full proposal is deliberately not sent to
                      this screen — see redactSolution() in ideaService. */}
                  <td style={{ maxWidth:260,color:'var(--text-muted)',fontSize:12.5 }}>
                    {i.solution_summary
                      ? <span title={i.solution_redacted ? t('idea.solution_hidden_hint') : i.solution_summary}>
                          {i.solution_summary}
                          {i.solution_redacted && <span style={{ marginLeft:5,opacity:.65 }} aria-hidden="true">🔒</span>}
                        </span>
                      : <span style={{ color:'var(--subtle)' }}>—</span>}
                  </td>
                  <td>{i.submitter_name}</td>
                  <td>{i.department||'–'}</td>
                  <td><span className={`badge ${impactBadge(i.impact_level)}`}>{translateImpact(i.impact_level,t)||'–'}</span></td>
                  <td>
                    {i.ai_score > 0
                      ? <span id={`cscore-${i.id}`} className={scoreBadgeClass(cScore)}
                          title={`AI Score: ${i.ai_score}/100 · Community adjustment: ${cScore-i.ai_score>=0?'+':''}${cScore-i.ai_score}`}>
                          {cScore}/100
                        </span>
                      : <span className="score-none score-badge">—</span>
                    }
                  </td>
                  <td>
                    {i.status !== 'Draft'
                      ? <VoteWidget ideaId={i.id} isSelf={isSelf}
                          upvotes={i.upvotes||0} downvotes={i.downvotes||0}
                          userVote={i.user_community_vote||null} onVote={castVote} />
                      : <span style={{ fontSize:11,color:'var(--subtle)' }}>—</span>
                    }
                  </td>
                  <td><span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status,t)}</span></td>
                  <td>{i.submitted_at ? fmtDate(i.submitted_at) : '–'}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => setOpenId(i.id)}>
                      {t('btn.view')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); loadIdeas(); }} />}
    </>
  );
}
