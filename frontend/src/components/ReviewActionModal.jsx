import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi } from '../services/api';

/** Decide on one idea. */
export default function ReviewActionModal({ ideaId, ideaCode, stage, chain, onClose }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [decision, setDecision] = useState('Approved');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  // Where this idea sits, and what comes after it.
  const steps = chain?.steps || [];
  const here = steps.find((s) => s.stage === stage) || null;
  const next = here ? steps.find((s) => s.position === here.position + 1) : null;
  const isFinal = here ? here.is_final : !next;

  async function handleSubmit() {
    setLoading(true);
    try {
      const res = await ideasApi.reviewAction({ idea_id: ideaId, decision, comment });
      if (res.data.success) {
        const d = res.data;
        if (d.decision === 'Escalated') {
          showToast(
            d.escalated_to
              ? t('review.sent_to_named', { stage: d.stage_label, name: d.escalated_to })
              : t('review.sent_to', { stage: d.stage_label }),
            'success'
          );
        } else if (d.decision === 'Waiting') {
          // Approved, but nothing further in the chain has anybody in it.
          showToast(d.detail || t('review.no_next_stage'), 'info');
        } else {
          const pts = d.points_awarded ? ` · ${t('msg.pts_earned', { n: d.points_awarded })}` : '';
          showToast(`${t('msg.decision_ok')}${pts}`, 'success');
        }
        onClose();
      } else {
        showToast(`${t('msg.error')}: ` + (res.data.error || t('msg.server_error')), 'danger');
      }
    } catch (e) {
      showToast(e.response?.data?.error || t('msg.server_error'), 'danger');
    }
    setLoading(false);
  }

  // What pressing the button will actually do, in one sentence.
  const consequence = decision === 'Rejected'
    ? t('review.will_reject')
    : isFinal
      ? t('review.will_approve_final')
      : next
        ? t('review.will_advance', { stage: next.label })
        : t('review.will_approve_final');

  return (
    <div className="modal-overlay open" id="modal-review" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span>{t('review.decide')} - <span id="review-id">#{ideaCode}</span></span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {/* Where it is now. Without this the reviewer is deciding blind. */}
          {here && (
            <div style={{
              padding: '10px 12px', marginBottom: 14, borderRadius: 'var(--r-sm)',
              background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12.5,
            }}>
              <div style={{ color: 'var(--text-muted)' }}>
                {t('review.at_stage', { stage: here.label, n: here.position, total: chain.total })}
              </div>
              {/* The whole journey, so it is obvious what has happened and what has not. */}
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                {steps.map((s, i) => (
                  <span key={s.stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span style={{ color: 'var(--subtle)' }}>→</span>}
                    <span style={{
                      padding: '1px 7px', borderRadius: 999, fontSize: 11,
                      fontWeight: s.position === here.position ? 700 : 500,
                      background: s.position === here.position ? 'var(--primary-light)' : 'transparent',
                      color: s.position === here.position ? 'var(--primary)'
                        : s.position < here.position ? 'var(--success)' : 'var(--subtle)',
                    }}>
                      {s.label}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label>{t('review.decision_label')}</label>
            <select className="form-control" id="review-decision" value={decision}
              onChange={e => setDecision(e.target.value)}>
              <option value="Approved">
                {isFinal ? t('review.approve_final') : t('review.approve_advance')}
              </option>
              <option value="Rejected">{t('review.reject')}</option>
            </select>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 6 }}>
              {consequence}
            </div>
          </div>

          <div className="form-group">
            <label>
              {t('review.comment_label')}
              {decision === 'Rejected' && <span style={{ color: 'var(--danger)' }}> *</span>}
            </label>
            <textarea className="form-control" id="review-comment" rows="4" value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={decision === 'Rejected' ? t('review.reject_reason_ph') : t('review.comment_ph')} />
            {/* A rejection with no reason is the complaint every suggestion scheme collects. */}
            {decision === 'Rejected' && !comment.trim() && (
              <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>
                {t('review.reject_needs_reason')}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{t('btn.cancel')}</button>
          <button
            className={`btn ${decision === 'Rejected' ? 'btn-danger' : 'btn-primary'}`}
            disabled={loading || (decision === 'Rejected' && !comment.trim())}
            onClick={handleSubmit}
          >
            {loading ? t('msg.loading')
              : decision === 'Rejected' ? t('review.reject')
                : isFinal ? t('review.approve_final') : t('review.approve_advance')}
          </button>
        </div>
      </div>
    </div>
  );
}
