import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { votesApi, exportApi } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, fmtDate } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import ScreenGuard from '../components/ScreenGuard';

export default function BoardPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const [ideas,   setIdeas]   = useState([]);
  const [sort,    setSort]    = useState('votes');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [openId,  setOpenId]  = useState(null);

  useEffect(() => { load(); }, [sort]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await votesApi.board({ sort });
      if (res.data.success) setIdeas(res.data.ideas || []);
      else setError(res.data.error || t('board.load_failed'));
    } catch { setError(t('board.load_failed')); }
    setLoading(false);
  }


  /* The one-page summary. Same endpoint as the full export - the server sends
     whichever document this reader is entitled to. */
  async function downloadGist(idea) {
    try {
      await exportApi.ideaPdf(idea.id, idea.idea_code);
    } catch {
      showToast(t('msg.network_error'), 'danger');
    }
  }

  async function castVote(ideaId, voteType) {
    try {
      const res = await votesApi.communityVote({ idea_id: ideaId, vote_type: voteType }); // POST /votes/community
      if (res.data.success) load();
      else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  return (
    <ScreenGuard>
      <div className="filter-bar">
        <select className="form-control" value={sort} onChange={e => setSort(e.target.value)} style={{ width:180 }}>
          <option value="votes">{t('board.sort_votes')}</option>
          <option value="newest">{t('board.sort_newest')}</option>
          <option value="score">{t('board.sort_score')}</option>
        </select>
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div> {t('msg.loading')}</div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && !ideas.length && (
        <div className="empty-state">{t('board.empty')}</div>
      )}

      <div id="board-list">
        {ideas.map(i => {
          const upvotes   = parseInt(i.upvotes)||0;
          const downvotes = parseInt(i.downvotes)||0;
          const userVote  = i.user_vote;
          const isSelf    = parseInt(i.submitter_id) === parseInt(user?.id);
          const net       = upvotes - downvotes;
          return (
            <div key={i.id} className="idea-card" id={`board-card-${i.id}`}>
              <div style={{ display:'flex',gap:12 }}>
                <div style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:4,minWidth:44 }}>
                  <button
                    className="btn btn-sm"
                    style={{
                      padding:'4px 8px',borderRadius:8,fontSize:13,fontWeight:700,
                      background:userVote==='up'?'#bbf7d0':'var(--chip-bg)',
                      color:userVote==='up'?'#10b981':'var(--text-muted)',
                      border:`1px solid ${userVote==='up'?'#bbf7d0':'var(--border)'}`
                    }}
                    onClick={() => !isSelf && castVote(i.id, 'up')}
                    disabled={isSelf}
                  >▲</button>
                  <span style={{ fontSize:14,fontWeight:700,color:'var(--heading)' }}>{net}</span>
                  <button
                    className="btn btn-sm"
                    style={{
                      padding:'4px 8px',borderRadius:8,fontSize:13,fontWeight:700,
                      background:userVote==='down'?'#fee2e2':'var(--chip-bg)',
                      color:userVote==='down'?'#ef4444':'var(--text-muted)',
                      border:`1px solid ${userVote==='down'?'#fecaca':'var(--border)'}`
                    }}
                    onClick={() => !isSelf && castVote(i.id, 'down')}
                    disabled={isSelf}
                  >▼</button>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:15,fontWeight:600,color:'var(--heading)' }}>{i.title}</div>
                  <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:2 }}>
                    {i.submitter_name} · {i.department||'–'} · {fmtDate(i.created_at)}
                  </div>
                  {/* Summaries, not the full text. The board is a browse view
                      like All Ideas, so the same rule applies: the server sends
                      a gist and nothing more. The line clamp used to be the only
                      thing hiding the rest — which hid it from the reader, not
                      from the page. */}
                  <div style={{ fontSize:13,color:'var(--text)',marginTop:6,WebkitLineClamp:2,display:'-webkit-box',WebkitBoxOrient:'vertical',overflow:'hidden' }}>
                    {i.situation_summary || i.present_situation}
                  </div>
                  {i.solution_summary && (
                    <div style={{ fontSize:12.5,color:'var(--text-muted)',marginTop:4 }}>
                      {i.solution_summary}
                      {i.solution_redacted && <span style={{ marginLeft:5,opacity:.65 }} aria-hidden="true">🔒</span>}
                    </div>
                  )}
                  <div style={{ display:'flex',gap:8,marginTop:8,alignItems:'center',flexWrap:'wrap' }}>
                    <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status,t)}</span>
                    <span className={`badge ${impactBadge(i.impact_level)}`}>
                      {translateImpact(i.impact_level, t)} {t('idea.impact_suffix')}
                    </span>
                    {i.ai_score > 0 && <span className={scoreBadgeClass(i.ai_score)}>AI: {i.ai_score}/100</span>}
                    {/* The board is where an employee sees other people's ideas,
                        so this is the button that matters. Somebody outside the
                        idea is offered the summary, not a full view. */}
                    {i.viewer_inside === false ? (
                      <button className="btn btn-outline btn-sm" title={t('idea.summary_only_hint')}
                        onClick={() => downloadGist(i)}>{t('btn.summary')}</button>
                    ) : (
                      <button className="btn btn-outline btn-sm" onClick={() => setOpenId(i.id)}>{t('btn.view')}</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </ScreenGuard>
  );
}
