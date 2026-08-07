import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi, votesApi, uploadApi, exportApi, ideaAdminApi } from '../services/api';
import {
  statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact, translateAreas,
  fmtDate, actionLabel, isPrivileged, communityScore,
} from '../utils/helpers';
import ReviewActionModal from './ReviewActionModal';
import AssignReviewersModal from './AssignReviewersModal';
import ReviewerDecisionModal from './ReviewerDecisionModal';

const TAB_KEYS = ['modal.details', 'modal.timeline', 'modal.attachments'];

export default function IdeaDetailModal({ ideaId, onClose }) {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState(0);
  const [idea,     setIdea]     = useState(null);
  const [voteData, setVoteData] = useState(null);
  const [commData, setCommData] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const [showReview,      setShowReview]      = useState(false);
  const [showAssign,      setShowAssign]      = useState(false);
  const [showRvDecision,  setShowRvDecision]  = useState(false);
  const [exporting,       setExporting]       = useState(false);

  // §13.10 / §13.2 — org-admin controls. `pat` mirrors the idea so the select is
  // controlled; it re-syncs whenever the idea reloads.
  const [pat, setPat] = useState('not_assessed');
  const [busyAdmin, setBusyAdmin] = useState(false);
  const isOrgAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => { load(); }, [ideaId]);
  useEffect(() => { if (idea) setPat(idea.patentability || 'not_assessed'); }, [idea?.id, idea?.patentability]);

  async function savePatentability(value) {
    const prev = pat;
    setPat(value);                       // optimistic: the select must not lag the click
    setBusyAdmin(true);
    try {
      const note = value === 'not_assessed' ? '' : (window.prompt(t('idea.pat_note_prompt'), idea.patentability_note || '') ?? '');
      const res = await ideaAdminApi.setPatentability(ideaId, value, note);
      if (res.data.success) { showToast(t('idea.pat_saved'), 'success'); await load(); }
      else { setPat(prev); showToast(res.data.error || t('msg.error'), 'danger'); }
    } catch (e) {
      setPat(prev);
      showToast(e?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusyAdmin(false);
  }

  async function toggleArchive() {
    const archiving = !idea.archived_at;
    if (archiving && !window.confirm(t('idea.confirm_archive'))) return;
    setBusyAdmin(true);
    try {
      const res = await ideaAdminApi.setArchived(ideaId, archiving);
      if (res.data.success) {
        showToast(archiving ? t('idea.archived_ok') : t('idea.restored_ok'), 'success');
        await load();
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch (e) {
      showToast(e?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusyAdmin(false);
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await ideasApi.get(ideaId);
      if (!res.data.success) { setError(res.data.error || t('msg.fail_idea')); setLoading(false); return; }
      setIdea(res.data.idea);
      // Load vote stats in background (non-critical)
      Promise.all([
        votesApi.stats({ idea_id: ideaId }),
        votesApi.communityStats({ idea_id: ideaId }),
      ]).then(([vr, cr]) => {
        setVoteData(vr.data);
        setCommData(cr.data);
      }).catch(() => {});
    } catch { setError(t('msg.fail_idea')); }
    setLoading(false);
  }

  async function castVote(ideaId, voteType) {
    try {
      const res = await votesApi.communityVote({ idea_id: ideaId, vote_type: voteType });
      if (res.data.success) {
        const [vr, cr] = await Promise.all([votesApi.stats({ idea_id: ideaId }), votesApi.communityStats({ idea_id: ideaId })]);
        setVoteData(vr.data); setCommData(cr.data);
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  async function castRating(ideaId, rating) {
    try {
      const res = await votesApi.castVote({ idea_id: ideaId, rating });
      if (res.data.success) {
        const vr = await votesApi.stats({ idea_id: ideaId });
        setVoteData(vr.data);
        showToast(`${t('community.rating_ok')}: ${rating}/5 ⭐`, 'success');
      } else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  // Higher authorities in the review hierarchy can export the employee's idea as
  // a pre-formatted Closure Summary PDF. Gated server-side too — the button just
  // hides it from people who would get a 403.
  async function handleExportPdf() {
    setExporting(true);
    try {
      await exportApi.ideaPdf(ideaId, idea?.idea_code);
    } catch {
      showToast(t('msg.network_error'), 'danger');
    }
    setExporting(false);
  }

  if (!idea && !loading && !error) return null;

  const isSelf   = idea ? parseInt(idea.submitter_id) === parseInt(user?.id) : false;
  const isPriv   = isPrivileged(user?.role);
  const isMultiRv = idea?.workflow_type === 'multi_reviewer';
  const isAssignedReviewer = isPriv && !isSelf && idea && (idea.reviewers||[]).some(
    rv => parseInt(rv.reviewer_id) === parseInt(user?.id) && rv.decision === 'pending'
  );
  const canDirectReview   = isPriv && !isSelf && !isMultiRv && idea && ['Submitted','Under Review'].includes(idea.status);
  const canRouteReviewers = isPriv && !isSelf && !isMultiRv && idea && ['Submitted','Under Review'].includes(idea.status);
  const selfNote = isPriv && isSelf && idea && ['Submitted','Under Review'].includes(idea.status);

  const upvotes   = parseInt(commData?.upvotes||0);
  const downvotes = parseInt(commData?.downvotes||0);
  const userVote  = commData?.user_vote || null;
  const net       = upvotes - downvotes;
  const userRating = voteData?.user_rating ?? null;
  const avgRating  = voteData?.avg_rating  || 0;
  const voteCount  = voteData?.vote_count  || 0;
  const cScoreVal  = commData?.community_score !== undefined
    ? commData.community_score
    : communityScore(idea?.ai_score||0, upvotes, downvotes);
  const adjStr = (cScoreVal - (parseInt(idea?.ai_score)||0)) >= 0
    ? `+${cScoreVal-(parseInt(idea?.ai_score)||0)}`
    : `${cScoreVal-(parseInt(idea?.ai_score)||0)}`;

  return (
    <>
      <div className="modal-overlay open" id="modal-idea-detail" onClick={e => e.target===e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth:740 }}>
          <div className="modal-header">
            <span>
              <strong id="modal-idea-code">{loading ? t('msg.loading') : idea ? `#${idea.idea_code}` : ''}</strong>
              <span id="modal-idea-title-sub" style={{ fontWeight:400,color:'var(--subtle)',marginLeft:8,fontSize:13 }}>
                {idea?.title}
              </span>
            </span>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>

          {/* Tabs */}
          <div className="tab-bar" style={{ padding:'0 20px' }}>
            {TAB_KEYS.map((key, i) => (
              <div key={key} className={`tab${activeTab===i?' active':''}`} onClick={() => setActiveTab(i)}>{t(key)}</div>
            ))}
          </div>

          <div className="modal-body" style={{ minHeight:300 }}>
            {loading && <div style={{ display:'flex',justifyContent:'center',padding:40 }}><div className="spinner"></div></div>}
            {error   && <div className="alert alert-danger">{error}</div>}

            {!loading && !error && idea && (
              <>
                {/* Tab 0: Details */}
                <div id="dtab1" className={`tab-content${activeTab===0?' active':''}`} style={{ display:activeTab===0?'block':'none' }}>
                  <div className="form-row" style={{ marginBottom:12 }}>
                    <div><strong>{t('detail.submitted_by')}:</strong> {idea.submitter_name} ({idea.department||'–'})</div>
                    <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                      <strong>{t('table.status')}:</strong>
                      <span className={`badge ${statusBadge(idea.status)}`}>{translateStatus(idea.status,t)}</span>
                    </div>
                  </div>

                  {/* §13.13 — one line answering "where is this now?", rather
                      than leaving the reader to reconstruct it from the timeline. */}
                  {idea.review_stage && (
                    <div style={{ display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',
                                  background:'var(--panel-bg)',border:'1px solid var(--border)',
                                  borderRadius:10,padding:'9px 12px',marginBottom:12,fontSize:12.5 }}>
                      <span style={{ fontWeight:700,color:'var(--heading)' }}>
                        {idea.review_stage.state === 'pending' && idea.review_stage.names.length
                          ? t('idea.under_review_by').replace('{names}', idea.review_stage.names.join(', '))
                          : idea.review_stage.state === 'pending' || idea.review_stage.state === 'unassigned'
                            ? t('idea.review_unassigned')
                            : idea.review_stage.state === 'draft'
                              ? t('idea.review_draft')
                              : t('idea.review_closed').replace('{status}', translateStatus(idea.review_stage.status, t))}
                      </span>
                      {idea.archived_at && (
                        <span style={{ background:'var(--chip-bg)',color:'var(--text-muted)',fontSize:10.5,
                                       fontWeight:700,padding:'2px 9px',borderRadius:999,textTransform:'uppercase' }}>
                          {t('idea.archived')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* §13.10 / §13.2 — org-admin decisions. The server enforces the
                      role as well; this only decides whether to draw the controls. */}
                  {isOrgAdmin && (
                    <div style={{ display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end',marginBottom:14 }}>
                      <div style={{ flex:'1 1 220px' }}>
                        <label style={{ fontSize:12,fontWeight:650,color:'var(--subtext)',display:'block',marginBottom:4 }}>
                          {t('idea.patentability')}
                        </label>
                        <select className="form-control" value={pat} disabled={busyAdmin}
                          onChange={e => savePatentability(e.target.value)}>
                          {['not_assessed','not_patentable','possible','recommended','filed'].map(v => (
                            <option key={v} value={v}>{t(`idea.pat_${v}`)}</option>
                          ))}
                        </select>
                      </div>
                      <button className="btn btn-outline btn-sm" disabled={busyAdmin}
                        onClick={toggleArchive}>
                        {idea.archived_at ? t('idea.restore') : t('idea.archive')}
                      </button>
                    </div>
                  )}

                  <div className="form-group">
                    <label>{t('detail.situation')}</label>
                    <div style={{ background:'var(--panel-bg)',padding:10,borderRadius:6,fontSize:13,overflowWrap:'anywhere' }}>{idea.present_situation}</div>
                  </div>
                  <div className="form-group">
                    <label>{t('detail.solution')}</label>
                    {/* Colleagues who are neither the author nor a reviewer get the
                        one-line gist. The server decides — the full text is never
                        sent to them, so this is not a display-only restriction. */}
                    {idea.solution_redacted ? (
                      <div style={{ background:'var(--panel-bg)',padding:10,borderRadius:6,fontSize:13,overflowWrap:'anywhere' }}>
                        <div>{idea.solution_summary || '—'}</div>
                        <div style={{ marginTop:8,fontSize:11.5,color:'var(--text-muted)',display:'flex',gap:6,alignItems:'flex-start' }}>
                          <span aria-hidden="true">🔒</span>
                          <span>{t('idea.solution_hidden_hint')}</span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ background:'var(--panel-bg)',padding:10,borderRadius:6,fontSize:13,overflowWrap:'anywhere' }}>{idea.proposed_solution}</div>
                    )}
                  </div>
                  <div className="form-row" style={{ marginBottom:10 }}>
                    <div><strong>{t('detail.impact_areas')}:</strong> {translateAreas(idea.impact_areas, t)||'–'}</div>
                    <div><strong>{t('detail.impact_level')}:</strong> <span className={`badge ${impactBadge(idea.impact_level)}`}>{translateImpact(idea.impact_level,t)||'–'}</span></div>
                  </div>
                  {idea.tangible_benefit   && <div style={{ marginTop:8 }}><strong>{t('detail.tangible')}:</strong> {idea.tangible_benefit}</div>}
                  {idea.intangible_benefit && <div style={{ marginTop:8 }}><strong>{t('detail.intangible')}:</strong> {idea.intangible_benefit}</div>}
                  {(idea.co_suggesters_display || idea.co1_name) && (
                    <div style={{ marginTop:8 }}><strong>{t('detail.co_suggesters')}:</strong> {idea.co_suggesters_display || (idea.co1_name + (idea.co2_name?', '+idea.co2_name:''))}</div>
                  )}

                  {/* Business case. Ideas submitted before these fields existed
                      have none of them, so the whole panel stays out of the way
                      rather than rendering five empty rows. */}
                  {(() => {
                    const bc = [
                      [t('form.investment'),  idea.investment_required ? `₹ ${idea.investment_required}` : ''],
                      [t('form.feasibility'), idea.feasibility ? translateImpact(idea.feasibility, t) : ''],
                      [t('form.impl_time'),   [idea.implementation_duration,
                                               idea.expected_implementation_date ? fmtDate(idea.expected_implementation_date) : '']
                                              .filter(Boolean).join(' · ')],
                      [t('form.benefits'),    idea.benefits_expected],
                      [t('form.support'),     idea.support_required],
                    ].filter(([, v]) => v);
                    if (!bc.length) return null;
                    return (
                      <div className="ai-panel" style={{ marginTop:14,borderLeftColor:'#0891b2' }}>
                        <div className="ai-panel-title" style={{ color:'#0e7490' }}>{t('detail.business_case')}</div>
                        {bc.map(([label, v]) => (
                          <div key={label} style={{ marginTop:6,fontSize:13,lineHeight:1.5 }}>
                            <strong>{label}:</strong> {v}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* AI Panel */}
                  <div className="ai-panel" style={{ marginTop:14 }}>
                    <div className="ai-panel-title">{t('detail.ai_eval')}</div>
                    <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:6 }}>
                      <strong style={{ fontSize:13 }}>{t('detail.score')}:</strong>
                      {idea.ai_score > 0
                        ? <span className={scoreBadgeClass(idea.ai_score)}>{idea.ai_score}/100</span>
                        : <span className="score-badge score-none">{t('detail.not_scored')}</span>
                      }
                    </div>
                    <div style={{ fontSize:13,color:'var(--text)',lineHeight:1.5 }}>
                      {(idea.ai_reason && idea.ai_reason.trim()) ? idea.ai_reason : t('detail.no_ai')}
                    </div>
                  </div>

                  {/* Community Engagement Panel */}
                  {commData && (
                    <div className="ai-panel" style={{ marginTop:14,borderLeftColor:'#374151' }}>
                      <div className="ai-panel-title" style={{ color:'#4b5563' }}>▲▼ {t('community.title')}</div>

                      <div style={{ display:'flex',alignItems:'center',gap:20,flexWrap:'wrap',marginBottom:14 }}>
                        <div style={{ textAlign:'center' }}>
                          <div style={{ fontSize:22,fontWeight:800,color:'#065f46' }}>▲ {upvotes}</div>
                          <div style={{ fontSize:11,color:'var(--subtle)' }}>{t('community.upvotes')}</div>
                        </div>
                        <div style={{ textAlign:'center' }}>
                          <div style={{ fontSize:22,fontWeight:800,color:net>=0?'#15803d':'#b91c1c' }}>{net>=0?'+':''}{net}</div>
                          <div style={{ fontSize:11,color:'var(--subtle)' }}>{t('community.net')}</div>
                        </div>
                        <div style={{ textAlign:'center' }}>
                          <div style={{ fontSize:22,fontWeight:800,color:'#991b1b' }}>▼ {downvotes}</div>
                          <div style={{ fontSize:11,color:'var(--subtle)' }}>{t('community.downvotes')}</div>
                        </div>
                        <div style={{ marginLeft:'auto',textAlign:'right' }}>
                          <div style={{ fontSize:11,color:'var(--subtle)',marginBottom:4 }}>{t('community.score')}</div>
                          <span className={scoreBadgeClass(cScoreVal)} style={{ fontSize:15,padding:'4px 12px' }}>{cScoreVal}/100</span>
                          {idea.ai_score > 0 && <div style={{ fontSize:10,color:'var(--subtle)',marginTop:3 }}>AI: {idea.ai_score} · Votes: {adjStr}</div>}
                        </div>
                      </div>

                      {idea.status !== 'Draft' && (
                        <div style={{ borderTop:'1px solid var(--border)',paddingTop:12 }}>
                          <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:8,fontWeight:600 }}>
                            {isSelf ? t('community.your_votes') : t('community.vote_on')}
                          </div>
                          {!isSelf && (
                            <div style={{ display:'flex',alignItems:'center',gap:12,flexWrap:'wrap' }}>
                              <button className="btn btn-sm"
                                style={{ padding:'4px 12px',borderRadius:8,fontWeight:700,
                                  background:userVote==='up'?'#bbf7d0':'var(--chip-bg)',
                                  color:userVote==='up'?'#10b981':'var(--text-muted)',
                                  border:`1px solid ${userVote==='up'?'#bbf7d0':'var(--border)'}` }}
                                onClick={() => castVote(ideaId,'up')}>▲ {t('community.upvote')}</button>
                              <button className="btn btn-sm"
                                style={{ padding:'4px 12px',borderRadius:8,fontWeight:700,
                                  background:userVote==='down'?'#fee2e2':'var(--chip-bg)',
                                  color:userVote==='down'?'#ef4444':'var(--text-muted)',
                                  border:`1px solid ${userVote==='down'?'#fecaca':'var(--border)'}` }}
                                onClick={() => castVote(ideaId,'down')}>▼ {t('community.downvote')}</button>
                              <span style={{ fontSize:11,color:'var(--subtle)' }}>{t('community.vote_hint')}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Star rating */}
                      {!isSelf && idea.status !== 'Draft' && (
                        <div style={{ borderTop:'1px solid var(--border)',paddingTop:10,marginTop:10 }}>
                          <div style={{ fontSize:11,color:'var(--subtle)',marginBottom:6,fontWeight:600,textTransform:'uppercase' }}>{t('community.rating_title')}</div>
                          {avgRating > 0 && (
                            <div style={{ display:'flex',alignItems:'center',gap:8,marginBottom:6 }}>
                              <span style={{ color:'#f59e0b',fontWeight:700 }}>{avgRating.toFixed(1)} ⭐</span>
                              <span style={{ fontSize:11,color:'var(--subtle)' }}>{voteCount} {t('unit.votes')}</span>
                            </div>
                          )}
                          <StarWidget ideaId={ideaId} userRating={userRating} onRate={castRating} t={t} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Multi-reviewer panel */}
                  {isMultiRv && (idea.reviewers||[]).length > 0 && (
                    <div className="ai-panel" style={{ marginTop:14,borderLeftColor:'#0284c7',background:'linear-gradient(135deg,#eff6ff,var(--panel-bg))' }}>
                      <div className="ai-panel-title" style={{ color:'#0284c7' }}>
                        ■ {t('review.committee_badge')} — {idea.approval_threshold}{t('committee.approval_req')}
                      </div>
                      <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:12 }}>
                        {(idea.reviewers||[]).filter(r=>r.decision==='approved').length} {t('committee.approved_count')} ·{' '}
                        {(idea.reviewers||[]).filter(r=>r.decision==='rejected').length} {t('committee.rejected_count')} ·{' '}
                        {(idea.reviewers||[]).filter(r=>r.decision==='pending').length} {t('committee.pending_count')}
                      </div>
                      <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
                        {(idea.reviewers||[]).map(rv => {
                          const rvColor = rv.decision==='approved'?'#10b981':rv.decision==='rejected'?'#ef4444':'#94a3b8';
                          return (
                            <div key={rv.reviewer_id} style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:'var(--r)',border:'1px solid var(--border)',background:'var(--surface)',minWidth:160 }}>
                              <div className="avatar" style={{ width:28,height:28,fontSize:10,flexShrink:0,background:`linear-gradient(135deg,${rvColor},${rvColor})` }}>
                                {rv.avatar_initials||rv.reviewer_name?.[0]||'?'}
                              </div>
                              <div>
                                <div style={{ fontSize:12,fontWeight:600 }}>{rv.reviewer_name}</div>
                                <div style={{ fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color:rvColor }}>
                                  {t(rv.decision==='approved' ? 'committee.approved_count'
                                    : rv.decision==='rejected' ? 'committee.rejected_count'
                                    : 'committee.pending_count')}
                                </div>
                                {rv.comment && <div style={{ fontSize:11,color:'var(--subtext)',marginTop:2,fontStyle:'italic' }}>"{rv.comment}"</div>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Tab 1: Timeline */}
                <div id="dtab2" className={`tab-content${activeTab===1?' active':''}`} style={{ display:activeTab===1?'block':'none' }}>
                  {!(idea.workflow||[]).length
                    ? <div className="empty-state">{t('detail.no_timeline')}</div>
                    : (idea.workflow||[]).map((w, i) => (
                      <div key={i} className="tl-item">
                        <div className="tl-dot tl-dot-blue">{actionLabel(w.action)}</div>
                        <div>
                          <div className="tl-title">{translateStatus(w.action, t)}</div>
                          <div className="tl-meta">{w.actor_name} · {fmtDate(w.created_at)}</div>
                          {w.comment && <div className="tl-comment">{w.comment}</div>}
                        </div>
                      </div>
                    ))
                  }
                </div>

                {/* Tab 2: Attachments */}
                <div id="dtab3" className={`tab-content${activeTab===2?' active':''}`} style={{ display:activeTab===2?'block':'none' }}>
                  {!(idea.attachments||[]).length
                    ? <div className="empty-state">{t('detail.no_attachments')}</div>
                    : (idea.attachments||[]).map(a => <Attachment key={a.id} att={a} t={t} />)
                  }
                </div>
              </>
            )}
          </div>

          <div className="modal-footer" id="idea-detail-footer">
            <button className="btn btn-outline" onClick={onClose}>{t('detail.close')}</button>
            {isPriv && idea && (
              <button className="btn btn-outline" style={{ borderColor:'#1a7d6b',color:'#136052' }}
                disabled={exporting} onClick={handleExportPdf}>
                {exporting ? t('msg.loading') : `⤓ ${t('detail.export_pdf')}`}
              </button>
            )}
            {selfNote && <span style={{ fontSize:12,color:'#f59e0b',marginRight:10 }}>{t('review.cannot_own')}</span>}
            {canRouteReviewers && (
              <button className="btn btn-outline" style={{ borderColor:'#0284c7',color:'#0284c7' }}
                onClick={() => setShowAssign(true)}>{t('review.route_committee')}</button>
            )}
            {isAssignedReviewer && (
              <button className="btn btn-primary" onClick={() => setShowRvDecision(true)}>{t('review.submit_mine')}</button>
            )}
            {canDirectReview && (
              <button className="btn btn-success" onClick={() => setShowReview(true)}>{t('review.decide')}</button>
            )}
          </div>
        </div>
      </div>

      {showReview && idea && (
        <ReviewActionModal ideaId={ideaId} ideaCode={idea.idea_code}
          onClose={() => { setShowReview(false); onClose(); }} />
      )}
      {showAssign && idea && (
        <AssignReviewersModal ideaId={ideaId} ideaCode={idea.idea_code}
          onClose={() => { setShowAssign(false); onClose(); }} />
      )}
      {showRvDecision && idea && (
        <ReviewerDecisionModal ideaId={ideaId} ideaCode={idea.idea_code}
          onClose={() => { setShowRvDecision(false); onClose(); }} />
      )}
    </>
  );
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif'];

/**
 * A single idea attachment.
 *
 * Attachments are private: they are streamed from an authenticated,
 * tenant-scoped endpoint rather than sitting on a public URL. A plain
 * <img src> / <a href> cannot send the Authorization header, so image previews
 * are fetched as a blob and shown via an object URL, and the download button
 * pulls the bytes through the API client.
 */
function Attachment({ att, t }) {
  const { showToast } = useToast();
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const ext     = (att.filename.split('.').pop() || '').toLowerCase();
  const isImage = IMAGE_EXT.includes(ext);

  useEffect(() => {
    if (!isImage) return undefined;
    let url = '';
    let cancelled = false;
    uploadApi.fetchBlob(att.id)
      .then(blob => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch(() => { /* preview is best-effort; the download button still works */ });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url); // don't leak the blob when the modal closes
    };
  }, [att.id, isImage]);

  async function handleDownload() {
    setBusy(true);
    try {
      await uploadApi.download(att.id, att.filename);
    } catch {
      showToast(t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  return (
    <div style={{ padding:'10px 0',borderBottom:'1px solid var(--border)' }}>
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',gap:10 }}>
        <div style={{ minWidth:0 }}>
          <span style={{ fontSize:12,color:'var(--subtle)',textTransform:'uppercase',marginRight:6 }}>{att.section}</span>
          <span style={{ fontSize:13,color:'var(--text)' }}>{att.filename}</span>
        </div>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={handleDownload}>
          {busy ? t('msg.loading') : t('btn.download')}
        </button>
      </div>
      {isImage && previewUrl && (
        <div style={{ marginTop:8 }}>
          <img src={previewUrl} alt={att.filename}
            style={{ maxWidth:'100%',maxHeight:320,borderRadius:6,border:'1px solid var(--border)',display:'block' }} />
        </div>
      )}
    </div>
  );
}

function StarWidget({ ideaId, userRating, onRate, t }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display:'flex',gap:4,cursor:'pointer' }}>
      {[1,2,3,4,5].map(s => (
        <span key={s}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onRate(ideaId, s)}
          style={{ fontSize:22,color:(hover||userRating)>=s?'#f59e0b':'#d1d5db',transition:'color .1s' }}
        >★</span>
      ))}
      {userRating && <span style={{ fontSize:12,color:'var(--subtle)',marginLeft:6,lineHeight:'26px' }}>{t('community.your_rating')}: {userRating}/5</span>}
    </div>
  );
}
