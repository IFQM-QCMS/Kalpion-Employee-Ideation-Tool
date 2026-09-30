import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { ideasApi } from '../services/api';
import { impactBadge, translateImpact, fmtDate } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import ScreenGuard from '../components/ScreenGuard';

// Rejected ideas - MOM §13.5 / §14.1.
export default function RejectedIdeasPage() {
  const { t } = useLang();
  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, [search]);

  async function load() {
    try {
      const res = await ideasApi.list({ status: 'Rejected', search });
      setIdeas(res.data.ideas || []);
    } catch { /* keep the last good list rather than blanking the page */ }
    setLoading(false);
  }

  return (
    <ScreenGuard>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ margin: '0 0 4px' }}>{t('dash.rejected_title')}</div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('dash.rejected_sub')}
        </p>
        <input className="form-control" type="search" placeholder={t('filter.search_ideas')}
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} />
      </div>

      {loading && <div className="card text-center"><div className="spinner"></div></div>}
      {!loading && !ideas.length && <div className="card text-center">{t('dash.rejected_none')}</div>}

      {!loading && !!ideas.length && (
        <div className="idea-list">
          {ideas.map((i) => (
            <div key={i.id} className="idea-card is-clickable" data-status={i.status} onClick={() => setOpenId(i.id)}>
              <div className="idea-card-top">
                <div className="idea-card-id">
                  <div className="idea-card-code">{i.idea_code}</div>
                  <div className="idea-card-title">{i.title}</div>
                </div>
                <div className="idea-card-badges">
                  <span className={`badge ${impactBadge(i.impact_level)}`}>
                    {translateImpact(i.impact_level, t) || '-'}
                  </span>
                </div>
              </div>

              {i.solution_summary && <div className="idea-card-sub">{i.solution_summary}</div>}

              <div className="idea-card-meta">
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('table.submitter')}</span>
                  <span className="idea-card-meta-value">{i.submitter_name}</span>
                </div>
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('table.dept')}</span>
                  <span className="idea-card-meta-value">{i.department || '-'}</span>
                </div>
                <div className="idea-card-meta-item">
                  <span className="idea-card-meta-label">{t('table.date')}</span>
                  <span className="idea-card-meta-value">{i.submitted_at ? fmtDate(i.submitted_at) : '-'}</span>
                </div>
              </div>

              <div className="idea-card-actions align-end">
                <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setOpenId(i.id); }}>
                  {t('btn.view')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* The rejection reason lives in the idea's workflow timeline, which the detail modal already renders - no separate fetch needed. */}
      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </ScreenGuard>
  );
}
