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


  // The one-page summary. Same endpoint as the full export - the server sends whichever
  // document this reader is entitled to.
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

      {loading && <div className="card text-center"><div className="spinner"></div></div>}
      {!loading && !error && !ideas.length && <div className="card text-center">{t('board.empty')}</div>}

      {/* The board ranks ideas against each other - that is what the sort control at the top is for. */}
      {!loading && !error && !!ideas.length && (
        <div className="idea-list">
          {pager.slice.map(i => {
            const upvotes   = parseInt(i.upvotes)||0;
            const downvotes = parseInt(i.downvotes)||0;
            const isSelf    = parseInt(i.submitter_id) === parseInt(user?.id);
            const net       = upvotes - downvotes;
            const canOpen   = i.viewer_inside !== false;
            return (
              <div key={i.id} id={`board-card-${i.id}`} className={canOpen ? 'idea-card is-clickable' : 'idea-card'}
                data-status={i.status} onClick={canOpen ? () => setOpenId(i.id) : undefined}>
                <div className="idea-card-top">
                  <div className="idea-card-id">
                    <div className="idea-card-title">{i.title}</div>
                    {/* Summaries, not the full text. */}
                    {(i.situation_summary || i.present_situation) && (
                      <div className="idea-card-sub">{i.situation_summary || i.present_situation}</div>
                    )}
                    {i.solution_summary && (
                      <div className="idea-card-sub" style={{ color:'var(--subtle)' }}>
                        {i.solution_summary}
                        {i.solution_redacted && <span style={{ marginLeft:5,opacity:.65 }} aria-hidden="true" title={t('idea.solution_hidden_hint')}>Protected</span>}
                      </div>
                    )}
                  </div>
                  <div className="idea-card-badges">
                    <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status,t)}</span>
                    <QcBadge status={i.qcms_push_status} />
                  </div>
                </div>

                <div className="idea-card-meta">
                  <div className="idea-card-meta-item">
                    <span className="idea-card-meta-label">{t('table.submitter')}</span>
                    <span className="idea-card-meta-value">{i.submitter_name}</span>
                  </div>
                  <div className="idea-card-meta-item">
                    <span className="idea-card-meta-label">{t('table.dept')}</span>
                    <span className="idea-card-meta-value">{i.department||'-'}</span>
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
                  {/* The number the sort is actually ordering by, given its own slot so the ranking can be checked at a glance. */}
                  <div className="idea-card-meta-item">
                    <span className="idea-card-meta-label">{t('table.net')}</span>
                    <span className="idea-card-meta-value" style={{ fontWeight:700 }}>{net}</span>
                  </div>
                  <div className="idea-card-meta-item">
                    <span className="idea-card-meta-label">{t('audit.when')}</span>
                    <span className="idea-card-meta-value">{fmtDateTime(i.created_at)}</span>
                  </div>
                </div>

                <div className="idea-card-actions" onClick={(e) => e.stopPropagation()}>
                  <VoteWidget ideaId={i.id} isSelf={isSelf}
                    upvotes={upvotes} downvotes={downvotes}
                    userVote={i.user_vote} onVote={castVote} />
                  <div style={{ marginLeft:'auto' }}>
                    {/* Somebody outside the idea is offered the summary, never a full view. */}
                    {!canOpen ? (
                      <button className="btn btn-outline btn-sm" title={t('idea.summary_only_hint')}
                        onClick={() => downloadGist(i)}>{t('btn.summary')}</button>
                    ) : (
                      <button className="btn btn-outline btn-sm" onClick={() => setOpenId(i.id)}>{t('btn.view')}</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <Pager {...pager} noun="ideas" />
        </div>
      )}

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </ScreenGuard>
  );
}
