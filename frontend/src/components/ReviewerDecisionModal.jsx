import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi } from '../services/api';

export default function ReviewerDecisionModal({ ideaId, ideaCode, onClose }) {
  const { t }         = useLang();
  const { showToast } = useToast();
  const [decision, setDecision] = useState('approved');
  const [comment,  setComment]  = useState('');
  const [loading,  setLoading]  = useState(false);

  const decisionLabel = () => t(decision === 'approved' ? 'review.approve' : 'review.reject');

  async function handleSubmit() {
    if (!confirm(t('rd.confirm', { decision: decisionLabel(), code: ideaCode }))) return;
    setLoading(true);
    try {
      const res = await ideasApi.reviewerDecision({ idea_id: ideaId, decision, comment });
      if (res.data.success) {
        showToast(t('rd.recorded', { decision: decisionLabel() }), 'success');
        onClose();
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch { showToast(t('msg.server_error'), 'danger'); }
    setLoading(false);
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:440 }}>
        <div className="modal-header">
          <span>{t('review.my_review')} - #{ideaCode}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize:13,color:'var(--subtle)',marginBottom:14 }}>
            {t('rd.intro')}
          </div>
          <div className="form-group">
            <label>{t('rd.decision')}</label>
            <select className="form-control" value={decision} onChange={e => setDecision(e.target.value)}>
              <option value="approved">{t('review.approve')}</option>
              <option value="rejected">{t('review.reject')}</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t('rd.feedback')}</label>
            <textarea className="form-control" rows="4" value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={t('rd.feedback_ph')} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={loading} onClick={handleSubmit}>
            {loading ? t('msg.loading') : t('review.submit_mine')}
          </button>
        </div>
      </div>
    </div>
  );
}
