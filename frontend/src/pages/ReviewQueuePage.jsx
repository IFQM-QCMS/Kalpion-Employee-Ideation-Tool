import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, fmtDate, engagementIndex, isPrivileged } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import ReviewActionModal from '../components/ReviewActionModal';
import AssignReviewersModal from '../components/AssignReviewersModal';
import ReviewerDecisionModal from '../components/ReviewerDecisionModal';
import ScreenGuard from '../components/ScreenGuard';

function EngBadge({ aiScore, avgRating, voteCount, t }) {
  const ei = engagementIndex(aiScore, avgRating, voteCount);
  if (!aiScore && !voteCount) return null;
  const tier = ei >= 70 ? { bg:'#bbf7d0',color:'#065f46',lbl:t('eng.high') }
             : ei >= 40 ? { bg:'#fef3c7',color:'#92400e',lbl:t('eng.med')  }
             : { bg:'#fee2e2',color:'#991b1b',lbl:t('eng.low') };
  return <span style={{ fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:20,background:tier.bg,color:tier.color,border:`1px solid ${tier.bg}` }}>EI:{ei} {tier.lbl}</span>;
}

export default function ReviewQueuePage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const [ideas,     setIdeas]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [selected,  setSelected]  = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [openDetailId,   setOpenDetailId]   = useState(null);
  const [openReviewId,   setOpenReviewId]   = useState(null);
  const [openReviewCode, setOpenReviewCode] = useState('');
  const [openAssignId,   setOpenAssignId]   = useState(null);
  const [openAssignCode, setOpenAssignCode] = useState('');
  const [openRvDecId,    setOpenRvDecId]    = useState(null);
  const [openRvDecCode,  setOpenRvDecCode]  = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await ideasApi.reviewQueue();
      if (res.data.success) { setIdeas(res.data.ideas || []); setSelected(new Set()); }
      else setError(res.data.error || t('msg.fail_queue'));
    } catch { setError(t('msg.fail_queue')); }
    setLoading(false);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleSelectAll(checked) {
    if (user?.role === 'admin') return;
    setSelectAll(checked);
    if (checked) {
      const eligible = ideas.filter(i => {
        const isSelf    = parseInt(i.submitter_id) === parseInt(user?.id);
        const isMultiRv = i.workflow_type === 'multi_reviewer';
        return !isSelf && !isMultiRv;
      }).map(i => i.id);
      setSelected(new Set(eligible));
    } else setSelected(new Set());
  }

  async function submitBulk(decision) {
    if (user?.role === 'admin') return;
    if (!selected.size) return;
    const ids     = [...selected];
    const comment = decision === 'Rejected' ? (prompt(t('bulk.reject_reason')) || '') : '';
    const action  = decision === 'Rejected' ? t('review.reject') : t('review.approve');
    if (!confirm(t('bulk.confirm', { action, n: ids.length }))) return;
    try {
      const res = await ideasApi.bulkReview({ idea_ids: ids, decision, comment });
      if (res.data.success) {
        showToast(t('bulk.done', { n: res.data.processed }), 'success');
        setSelected(new Set()); setSelectAll(false);
        load();
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  return (
    <ScreenGuard>
      {user?.role === 'admin' && (
        <div className="alert alert-warning" style={{ marginBottom: 16 }}>
          Org Admins are strictly prohibited from approving, rejecting, or acting on submitted ideas.
        </div>
      )}
      {/* Bulk action bar */}
      {selected.size > 0 && user?.role !== 'admin' && (
        <div id="bulk-action-bar" style={{
          position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',
          display:'flex',alignItems:'center',gap:12,
          background:'var(--sidebar-bg)',color:'#fff',
          padding:'12px 20px',borderRadius:12,boxShadow:'0 4px 24px rgba(0,0,0,.3)',zIndex:999
        }}>
          <span id="bulk-count-label">{t('review.selected_count', { n: selected.size })}</span>
          <button className="btn btn-sm" style={{ background:'#10b981',color:'#fff',border:'none' }}
            onClick={() => submitBulk('Approved')}>{t('bulk.approve_all')}</button>
          <button className="btn btn-sm" style={{ background:'#ef4444',color:'#fff',border:'none' }}
            onClick={() => submitBulk('Rejected')}>{t('bulk.reject_all')}</button>
          <button className="btn btn-sm btn-outline" style={{ color:'#fff',borderColor:'#ffffff66' }}
            onClick={() => { setSelected(new Set()); setSelectAll(false); }}>{t('bulk.clear')}</button>
        </div>
      )}

      {/* Select all row */}
      {user?.role !== 'admin' && (
        <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:14 }}>
          <input type="checkbox" id="bulk-select-all" checked={selectAll} style={{ accentColor:'var(--primary)' }}
            onChange={e => handleSelectAll(e.target.checked)} />
          <label htmlFor="bulk-select-all" style={{ fontSize:13,color:'var(--subtle)',cursor:'pointer' }}>
            {t('review.select_all')}
          </label>
        </div>
      )}

      {loading && <div className="empty-state"><div className="spinner"></div> {t('msg.loading')}</div>}
      {error   && <div className="alert alert-danger">{error}</div>}
      {!loading && !error && !ideas.length && <div className="empty-state">{t('msg.no_review')}</div>}

      <div id="review-list">
        {ideas.map(i => {
          const isSelf       = parseInt(i.submitter_id) === parseInt(user?.id);
          const isMultiRv    = i.workflow_type === 'multi_reviewer';
          const isMyPending  = i.my_reviewer_decision === 'pending';
          const pending      = Math.max(0, (parseInt(i.reviewer_count)||0)-(parseInt(i.approved_count)||0)-(parseInt(i.rejected_count)||0));
          const dueDate      = i.review_due_date ? new Date(i.review_due_date) : null;
          const isOverdue    = dueDate && dueDate < new Date();
          const showCheckbox = !isSelf && !isMultiRv && user?.role !== 'admin';

          return (
            <div key={i.id} className="idea-card" data-status={i.status} data-id={i.id}>
              <div className="idea-card-header">
                <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
                  {showCheckbox && (
                    <input type="checkbox" className="bulk-chk" data-id={i.id}
                      checked={selected.has(i.id)}
                      style={{ marginTop:4,accentColor:'var(--primary)' }}
                      onChange={() => toggleSelect(i.id)} />
                  )}
                  <div>
                    <div className="idea-card-id">#{i.idea_code}</div>
                    <div className="idea-card-title">{i.title}</div>
                  </div>
                </div>
                <div style={{ display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4 }}>
                  <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status,t)}</span>
                  {i.ai_score > 0 && <span className={scoreBadgeClass(i.ai_score)}>AI: {i.ai_score}/100</span>}
                </div>
              </div>

              <div className="idea-card-meta">
                {t('detail.submitted_by')}: {i.submitter_name} · {i.department||'–'} · {i.submitted_at ? fmtDate(i.submitted_at) : '–'}
              </div>

              {(dueDate || parseInt(i.escalation_level) > 0) && (
                <div style={{ display:'flex',gap:6,flexWrap:'wrap',marginTop:6 }}>
                  {dueDate && (
                    <span style={{ fontSize:11,padding:'2px 8px',borderRadius:20,fontWeight:600,
                      border:`1px solid ${isOverdue?'var(--danger-dim)':'var(--border)'}`,
                      background:isOverdue?'var(--danger-light)':'var(--chip-bg)',
                      color:isOverdue?'var(--danger)':'var(--text-muted)' }}>
                      {isOverdue ? `⚠ ${t('review.overdue')}` : `⏱ ${t('review.due')}`} {fmtDate(i.review_due_date)}
                    </span>
                  )}
                  {parseInt(i.escalation_level) > 0 && (
                    <span style={{ fontSize:11,padding:'2px 8px',borderRadius:20,fontWeight:600,
                      border:'1px solid var(--primary-dim)',background:'var(--primary-light)',color:'var(--primary)' }}>
                      ↑ L{i.escalation_level}
                    </span>
                  )}
                </div>
              )}

              {isMultiRv && (
                <div style={{ marginTop:6,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap' }}>
                  <span style={{ fontSize:11,background:'var(--info-light)',color:'var(--info)',padding:'2px 9px',borderRadius:'var(--r-full)',fontWeight:600,border:'1px solid var(--info-dim)' }}>
                    {t('review.committee_badge')}
                  </span>
                  <span style={{ fontSize:11,color:'var(--subtle)' }}>
                    {i.approved_count||0} {t('committee.approved_count')} · {i.rejected_count||0} {t('committee.rejected_count')} · {pending} {t('committee.pending_count')}
                  </span>
                  {isMyPending && (
                    <span style={{ fontSize:11,background:'var(--warning-light)',color:'var(--warning)',padding:'2px 9px',borderRadius:'var(--r-full)',fontWeight:600,border:'1px solid var(--warning-dim)' }}>
                      {t('review.vote_needed')}
                    </span>
                  )}
                </div>
              )}

              {(i.avg_rating > 0 || i.vote_count > 0) && (
                <div style={{ marginTop:4,fontSize:11,color:'var(--subtle)',display:'flex',gap:6 }}>
                  {i.avg_rating > 0 && <span>⭐ {parseFloat(i.avg_rating).toFixed(1)}</span>}
                  {i.vote_count > 0 && <span>🗳 {i.vote_count}</span>}
                </div>
              )}

              <div className="idea-card-footer">
                <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                  <span className={`badge ${impactBadge(i.impact_level)}`}>
                    {translateImpact(i.impact_level,t)||'–'} {t('idea.impact_suffix')}
                  </span>
                  <EngBadge aiScore={i.ai_score} avgRating={i.avg_rating} voteCount={i.vote_count} t={t} />
                </div>
                <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                  {isSelf && (
                    <>
                      <span style={{ fontSize:11,color:'#f59e0b' }}>{t('review.own_idea')}</span>
                      <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('btn.view')}</button>
                    </>
                  )}
                  {!isSelf && isMultiRv && isMyPending && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('btn.view')}</button>
                      <button className="btn btn-primary btn-sm" onClick={() => { setOpenRvDecId(i.id); setOpenRvDecCode(i.idea_code); }}>{t('review.my_review')}</button>
                    </>
                  )}
                  {!isSelf && isMultiRv && !isMyPending && (
                    <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('review.view_details')}</button>
                  )}
                  {!isSelf && !isMultiRv && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => { setOpenAssignId(i.id); setOpenAssignCode(i.idea_code); }}>
                        {t('review.route_committee')}
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('review.view_details')}</button>
                      <button className="btn btn-success btn-sm" onClick={() => { setOpenReviewId(i.id); setOpenReviewCode(i.idea_code); }}>{t('review.review_btn')}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {openDetailId && <IdeaDetailModal ideaId={openDetailId} onClose={() => { setOpenDetailId(null); load(); }} />}
      {openReviewId && <ReviewActionModal ideaId={openReviewId} ideaCode={openReviewCode} onClose={() => { setOpenReviewId(null); load(); }} />}
      {openAssignId && <AssignReviewersModal ideaId={openAssignId} ideaCode={openAssignCode} onClose={() => { setOpenAssignId(null); load(); }} />}
      {openRvDecId  && <ReviewerDecisionModal ideaId={openRvDecId} ideaCode={openRvDecCode} onClose={() => { setOpenRvDecId(null); load(); }} />}
    </ScreenGuard>
  );
}
