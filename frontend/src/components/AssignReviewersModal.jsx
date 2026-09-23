import { useState, useRef, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi, usersApi } from '../services/api';
import { formatRole } from '../utils/helpers';

// The roles STAGE_CATALOG knows about: the only ones that can hold a stage, and so the only
// ones an idea can be routed to. Anyone else is refused by assignReviewers.
const ROUTABLE_ROLES = [
  'team_lead', 'manager', 'project_lead', 'department_manager',
  'senior_manager', 'plant_head', 'executive',
];

export default function AssignReviewersModal({ ideaId, ideaCode, onClose }) {
  const { t }         = useLang();
  const { showToast } = useToast();
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState([]);
  const [selected,  setSelected]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const timerRef = useRef(null);

  async function handleSearch(q) {
    setQuery(q);
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await usersApi.list({ q });
        /*
         * Only people the server will actually accept. It refuses anybody who holds no role
         * in the approval path, and anybody below the router's own level - but the search
         * listed every employee by name, department and id, with no mention of their role, so
         * the first thing a reviewer learned about an ineligible choice was an error after
         * pressing Assign. The role is shown for the same reason.
         */
        setResults((res.data.users||[])
          .filter(u => ROUTABLE_ROLES.includes(u.role))
          .filter(u => !selected.some(s=>s.id===u.id)));
      } catch {}
    }, 300);
  }

  function addReviewer(u) {
    setSelected(prev => [...prev, u]);
    setResults([]);
    setQuery('');
  }

  function removeReviewer(id) {
    setSelected(prev => prev.filter(u=>u.id!==id));
  }

  async function handleSubmit() {
    if (!selected.length) { showToast(t('ar.need_one'), 'warning'); return; }
    setLoading(true);
    try {
      const res = await ideasApi.assignReviewers({
        idea_id: ideaId,
        reviewer_ids: selected.map(u=>u.id),
      });
      if (res.data.success) {
        showToast(t('ar.assigned_ok'), 'success');
        onClose();
      } else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch { showToast(t('msg.server_error'), 'danger'); }
    setLoading(false);
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:480 }}>
        <div className="modal-header">
          <span>{t('review.route_committee')} - #{ideaCode}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>{t('ar.search_label')}</label>
            <div className="pos-rel">
              <input className="form-control" value={query} onChange={e => handleSearch(e.target.value)}
                placeholder={t('form.co_search_ph')} />
              {results.length > 0 && (
                <div className="user-search-results" style={{ display:'block' }}>
                  {results.map(u => (
                    <div key={u.id} className="uitem" onClick={() => addReviewer(u)}>
                      {u.name} · {formatRole(u.role, t)} · {u.department||'-'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {selected.length > 0 && (
            <div className="form-group">
              <label>{t('ar.selected')} ({selected.length})</label>
              <div style={{ display:'flex',flexWrap:'wrap',gap:6 }}>
                {selected.map(u => (
                  <span key={u.id} style={{ display:'flex',alignItems:'center',gap:4,background:'var(--chip-bg)',border:'1px solid var(--border)',borderRadius:'var(--r-full)',padding:'3px 10px',fontSize:12 }}>
                    {u.name}
                    <button onClick={() => removeReviewer(u.id)} style={{ background:'none',border:'none',cursor:'pointer',color:'#ef4444',fontSize:14,lineHeight:1,padding:0 }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* The rule, stated rather than configured. */}
          <div style={{ fontSize:12,color:'var(--text-muted)',background:'var(--bg)',
            border:'1px solid var(--border)',borderRadius:'var(--r)',padding:'8px 12px' }}>
            {t('ar.unanimous_note')}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={loading || !selected.length} onClick={handleSubmit}>
            {loading ? t('msg.loading') : t('ar.assign')}
          </button>
        </div>
      </div>
    </div>
  );
}
