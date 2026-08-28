import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, fmtDate, fmtDateTime, parseServerDate, engagementIndex } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import ReviewActionModal from '../components/ReviewActionModal';
import AssignReviewersModal from '../components/AssignReviewersModal';
import ReviewerDecisionModal from '../components/ReviewerDecisionModal';
import ScreenGuard from '../components/ScreenGuard';
import Pager, { usePager } from '../components/Pager';
import QcBadge from '../components/QcBadge';

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
  /*
   * The chain, as this organisation has it configured right now.
   *
   * Sent with the queue on every load rather than kept in the client, because
   * an administrator can change the stages at any moment and a cached copy
   * would label ideas with a journey the server is no longer taking.
   */
  const [chain, setChain] = useState(null);
  const [openDetailId, setOpenDetailId] = useState(null);
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
      if (res.data.success) { setIdeas(res.data.ideas || []); setChain(res.data.chain || null); setSelected(new Set()); }
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

  // Twenty to a page: the list endpoints already bound what they return,
  // but rendering every row was the browser's cost, not the server's.
  const pager = usePager(ideas);

  // Org admins may not act on ideas, so they get no selection column at all -
  // and the column count has to follow it, or every empty-state row runs short.
  const canSelect = user?.role !== 'admin';
  const colCount  = canSelect ? 12 : 11;   // +1 for the Stage column

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
          {/* Explicitly transparent.
              This carried .btn-outline, whose background is a light surface
              colour from the theme, while the inline style forced white text -
              so the button rendered as a blank white pill with an invisible
              label on a dark bar. It worked; nobody could tell it was there. */}
          <button className="btn btn-sm"
            style={{ background:'transparent',color:'#fff',border:'1px solid #ffffff66' }}
            onClick={() => { setSelected(new Set()); setSelectAll(false); }}>{t('bulk.clear')}</button>
        </div>
      )}

      {loading && <div className="empty-state"><div className="spinner"></div> {t('msg.loading')}</div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {/*
        A table, not a stack of cards.
        A reviewer's question here is comparative — which of these is oldest,
        which is overdue, which is high impact — and cards force that comparison
        to be made from memory, because the same fact sits at a different height
        in every card. Down a column it is one glance.
        Select-all moved into the header cell, where it governs the column it
        stands on instead of floating above the list.
      */}
      <div className="card" style={{ overflowX:'auto' }}>
        <table className="table">
          <thead>
            <tr>
              {canSelect && (
                <th style={{ width:34 }}>
                  <input type="checkbox" id="bulk-select-all" checked={selectAll}
                    style={{ accentColor:'var(--primary)' }}
                    title={t('review.select_all')}
                    onChange={e => handleSelectAll(e.target.checked)} />
                </th>
              )}
              <th>{t('table.code')}</th>
              <th>{t('table.title')}</th>
              <th>{t('table.submitter')}</th>
              <th>{t('table.dept')}</th>
              <th>{t('table.impact')}</th>
              <th>{t('table.score')}</th>
              <th>{t('table.status')}</th>
              <th>{t('table.stage')}</th>
              <th>{t('review.due')}</th>
              <th>{t('audit.when')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="review-list">
            {loading && <tr><td colSpan={colCount} className="text-center"><div className="spinner"></div></td></tr>}
            {!loading && !error && !ideas.length && (
              <tr><td colSpan={colCount} className="text-center">{t('msg.no_review')}</td></tr>
            )}
            {pager.slice.map(i => {
              const isSelf       = parseInt(i.submitter_id) === parseInt(user?.id);
              const isMultiRv    = i.workflow_type === 'multi_reviewer';
              const isMyPending  = i.my_reviewer_decision === 'pending';
              const pending      = Math.max(0, (parseInt(i.reviewer_count)||0)-(parseInt(i.approved_count)||0)-(parseInt(i.rejected_count)||0));
              const dueDate      = parseServerDate(i.review_due_date);
              const isOverdue    = dueDate && dueDate < new Date();
              const showCheckbox = !isSelf && !isMultiRv && canSelect;

              return (
                <tr key={i.id} data-status={i.status} data-id={i.id}>
                  {canSelect && (
                    <td>
                      {showCheckbox && (
                        <input type="checkbox" className="bulk-chk" data-id={i.id}
                          checked={selected.has(i.id)}
                          style={{ accentColor:'var(--primary)' }}
                          onChange={() => toggleSelect(i.id)} />
                      )}
                    </td>
                  )}
                  <td><strong>{i.idea_code}</strong></td>
                  <td title={i.title}>
                    <div className="cell-clamp" style={{ maxWidth:260 }}>{i.title}</div>
                    {/* Committee tallies and this reviewer's own outstanding vote
                        ride under the title: they qualify one idea rather than
                        being facts anyone would scan a whole column of. */}
                    {isMultiRv && (
                      <div style={{ marginTop:3,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap' }}>
                        <span className="chip chip-info">{t('review.committee_badge')}</span>
                        <span style={{ fontSize:11,color:'var(--subtle)' }}>
                          {i.approved_count||0} {t('committee.approved_count')} · {i.rejected_count||0} {t('committee.rejected_count')} · {pending} {t('committee.pending_count')}
                        </span>
                        {isMyPending && <span className="chip chip-warning">{t('review.vote_needed')}</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    {i.submitter_name}
                    {isSelf && <div style={{ fontSize:11,color:'var(--warning)' }}>{t('review.own_idea')}</div>}
                  </td>
                  <td>{i.department||'–'}</td>
                  <td>
                    <span className={`badge ${impactBadge(i.impact_level)}`}>{translateImpact(i.impact_level,t)||'–'}</span>
                  </td>
                  <td style={{ whiteSpace:'nowrap' }}>
                    {i.ai_score > 0
                      ? <span className={scoreBadgeClass(i.ai_score)}>{i.ai_score}/100</span>
                      : <span className="score-none score-badge">—</span>}
                    <EngBadge aiScore={i.ai_score} avgRating={i.avg_rating} voteCount={i.vote_count} t={t} />
                  </td>
                  <td>
                    <span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status,t)}</span>
                    <QcBadge status={i.qcms_push_status} />
                    {parseInt(i.escalation_level) > 0 && (
                      <div style={{ marginTop:3 }}>
                        <span className="chip chip-primary">↑ L{i.escalation_level}</span>
                      </div>
                    )}
                  </td>
                  {/* Which approval this idea is waiting for, and how far
                      along it is. "Under Review" alone never said. */}
                  <td style={{ whiteSpace:'nowrap' }}>
                    {(() => {
                      const step = chain?.steps?.find(x => x.stage === i.current_stage);
                      if (!step) return <span style={{ color:'var(--subtle)' }}>—</span>;
                      return (
                        <span title={t('review.at_stage', { stage: step.label, n: step.position, total: chain.total })}>
                          <span className="chip chip-primary">{step.label}</span>
                          <span style={{ fontSize:11,color:'var(--subtle)',marginLeft:5 }}>
                            {step.position}/{chain.total}
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ whiteSpace:'nowrap' }}>
                    {dueDate
                      ? <span className={`chip ${isOverdue ? 'chip-danger' : ''}`}>
                          {isOverdue ? `⚠ ${t('review.overdue')} ` : ''}{fmtDate(i.review_due_date)}
                        </span>
                      : <span style={{ color:'var(--subtle)' }}>—</span>}
                  </td>
                  <td style={{ whiteSpace:'nowrap' }}>{i.submitted_at ? fmtDateTime(i.submitted_at) : '–'}</td>
                  <td>
                    <div style={{ display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end' }}>
                      {isSelf && (
                        <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('btn.view')}</button>
                      )}
                      {!isSelf && isMultiRv && isMyPending && (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('btn.view')}</button>
                          <button className="btn btn-primary btn-sm" onClick={() => { setOpenRvDecId(i.id); setOpenRvDecCode(i.idea_code); }}>{t('review.my_review')}</button>
                        </>
                      )}
                      {!isSelf && isMultiRv && !isMyPending && (
                        <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('btn.view')}</button>
                      )}
                      {!isSelf && !isMultiRv && (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => { setOpenAssignId(i.id); setOpenAssignCode(i.idea_code); }}>
                            {t('review.route_committee')}
                          </button>
                          <button className="btn btn-outline btn-sm" onClick={() => setOpenDetailId(i.id)}>{t('btn.view')}</button>
                          {/* Named for the outcome, not for the screen it
                              opens: at the last stage this approves the idea,
                              everywhere else it passes it on. */}
                          <button className="btn btn-success btn-sm"
                            onClick={() => { setOpenReviewId(i.id); setOpenReviewCode(i.idea_code); }}>
                            {chain?.steps?.find(x => x.stage === i.current_stage)?.is_final
                              ? t('review.approve_final')
                              : t('review.review_btn')}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager {...pager} noun="ideas" />
      </div>

      {openDetailId && <IdeaDetailModal ideaId={openDetailId} onClose={() => { setOpenDetailId(null); load(); }} />}
      {openReviewId && (
        <ReviewActionModal
          ideaId={openReviewId}
          ideaCode={openReviewCode}
          stage={ideas.find(i => i.id === openReviewId)?.current_stage}
          chain={chain}
          onClose={() => { setOpenReviewId(null); load(); }}
        />
      )}
      {openAssignId && <AssignReviewersModal ideaId={openAssignId} ideaCode={openAssignCode} onClose={() => { setOpenAssignId(null); load(); }} />}
      {openRvDecId  && <ReviewerDecisionModal ideaId={openRvDecId} ideaCode={openRvDecCode} onClose={() => { setOpenRvDecId(null); load(); }} />}
    </ScreenGuard>
  );
}
