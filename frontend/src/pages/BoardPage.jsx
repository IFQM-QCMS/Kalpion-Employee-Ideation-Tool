import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { votesApi, exportApi } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, fmtDateTime } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import ScreenGuard from '../components/ScreenGuard';
import QcBadge from '../components/QcBadge';
import VoteWidget from '../components/VoteWidget';
import Pager, { usePager } from '../components/Pager';

export default function BoardPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const [ideas,   setIdeas]   = useState([]);
  const [sort,    setSort]    = useState('votes');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [openId,  setOpenId]  = useState(null);
  const pager = usePager(ideas);

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
    const prev = [...ideas];
    setIdeas((list) =>
      list.map((item) => {
        if (item.id !== ideaId) return item;
        const current = item.user_vote;
        let nextVote = voteType;
        let upDelta = 0;
        let downDelta = 0;
        if (current === voteType) {
          nextVote = null;
          if (voteType === 'up') upDelta = -1;
          if (voteType === 'down') downDelta = -1;
        } else if (current === 'up' && voteType === 'down') {
          upDelta = -1;
          downDelta = 1;
        } else if (current === 'down' && voteType === 'up') {
          downDelta = -1;
          upDelta = 1;
        } else {
          if (voteType === 'up') upDelta = 1;
          if (voteType === 'down') downDelta = 1;
        }
        return {
          ...item,
          user_vote: nextVote,
          upvotes: Math.max(0, (parseInt(item.upvotes) || 0) + upDelta),
          downvotes: Math.max(0, (parseInt(item.downvotes) || 0) + downDelta),
        };
      })
    );
    try {
      const res = await votesApi.communityVote({ idea_id: ideaId, vote_type: voteType });
      if (res.data.success) {
        setIdeas((list) =>
          list.map((item) => {
            if (item.id !== ideaId) return item;
            return {
              ...item,
              upvotes: res.data.upvotes,
              downvotes: res.data.downvotes,
              user_vote: res.data.user_vote,
            };
          })
        );
      } else {
        setIdeas(prev);
        showToast(res.data.error || t('msg.error'), 'danger');
      }
    } catch {
      setIdeas(prev);
      showToast(t('msg.network_error'), 'danger');
    }
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

      {error && <div className="alert alert-danger">{error}</div>}

      {/*
        The board ranks ideas against each other — that is what the sort control
        at the top is for. Cards made the ranking almost impossible to read: the
        net score sat in a rail whose vertical position moved with the length of
        every summary above it, so "is this one ahead of that one" meant
        scrolling back and forth. As a column, the order the sort produced is
        finally visible as an order.
      */}
      <div className="card" style={{ overflowX:'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('table.title')}</th>
              <th>{t('table.submitter')}</th>
              <th>{t('table.dept')}</th>
              <th>{t('table.impact')}</th>
              <th>{t('table.score')}</th>
              <th>{t('table.votes')}</th>
              <th>{t('table.net')}</th>
              <th>{t('table.status')}</th>
              <th>{t('audit.when')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="board-list">
            {loading && <tr><td colSpan="10" className="text-center"><div className="spinner"></div></td></tr>}
            {!loading && !error && !ideas.length && (
              <tr><td colSpan="10" className="text-center">{t('board.empty')}</td></tr>
            )}
            {pager.slice.map(i => {
              const upvotes   = parseInt(i.upvotes)||0;
              const downvotes = parseInt(i.downvotes)||0;
              const isSelf    = parseInt(i.submitter_id) === parseInt(user?.id);
              const net       = upvotes - downvotes;
              return (
                <tr key={i.id} id={`board-card-${i.id}`} data-status={i.status}>
                  <td title={i.title}>
                    <div style={{ fontWeight:600,color:'var(--heading)' }}>
                      <div className="cell-clamp" style={{ maxWidth:300 }}>{i.title}</div>
                    </div>
                    {/* Summaries, not the full text. The board is a browse view
                        like All Ideas, so the same rule applies: the server
                        sends a gist and nothing more. The clamp is presentation
                        — it is not what keeps the rest of the proposal back. */}
                    <div className="cell-clamp" style={{ maxWidth:300,fontSize:12.5,color:'var(--text-muted)',marginTop:2 }}
                         title={i.situation_summary || i.present_situation || ''}>
                      {i.situation_summary || i.present_situation}
                    </div>
                    {i.solution_summary && (
                      <div className="cell-clamp" style={{ maxWidth:300,fontSize:12,color:'var(--subtle)',marginTop:2 }}
                           title={i.solution_redacted ? t('idea.solution_hidden_hint') : i.solution_summary}>
                        {i.solution_summary}
                        {i.solution_redacted && <span style={{ marginLeft:5,opacity:.65 }} aria-hidden="true">Protected</span>}
                      </div>
                    )}
                  </td>
                  <td>{i.submitter_name}</td>
                  <td>{i.department||'–'}</td>
                  <td><span className={`badge ${impactBadge(i.impact_level)}`}>{translateImpact(i.impact_level, t)||'–'}</span></td>
                  <td>
                    {i.ai_score > 0
                      ? <span className={scoreBadgeClass(i.ai_score)}>{i.ai_score}/100</span>
                      : <span className="score-none score-badge">—</span>}
                  </td>
                  <td>
                    <VoteWidget ideaId={i.id} isSelf={isSelf}
                      upvotes={upvotes} downvotes={downvotes}
                      userVote={i.user_vote} onVote={castVote} />
                  </td>
                  {/* The number the sort is actually ordering by, given a column
                      of its own so the ranking can be checked at a glance. */}
                  <td style={{ fontWeight:700,color:'var(--heading)' }}>{net}</td>
                  <td>
                    <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status,t)}</span>
                    <QcBadge status={i.qcms_push_status} />
                  </td>
                  <td style={{ whiteSpace:'nowrap' }}>{fmtDateTime(i.created_at)}</td>
                  <td>
                    {/* Somebody outside the idea is offered the summary, never
                        a full view. */}
                    {i.viewer_inside === false ? (
                      <button className="btn btn-outline btn-sm" title={t('idea.summary_only_hint')}
                        onClick={() => downloadGist(i)}>{t('btn.summary')}</button>
                    ) : (
                      <button className="btn btn-outline btn-sm" onClick={() => setOpenId(i.id)}>{t('btn.view')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager {...pager} noun="ideas" />
      </div>

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </ScreenGuard>
  );
}
