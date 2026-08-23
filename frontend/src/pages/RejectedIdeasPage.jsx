import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { ideasApi } from '../services/api';
import { impactBadge, translateImpact, fmtDate } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import ScreenGuard from '../components/ScreenGuard';

/*
  Rejected ideas — MOM §13.5 / §14.1.

  Rejected was already a filter value on All Ideas, which is not the same thing:
  a filter is something you have to think to apply, and nobody browsing their
  pipeline thinks "let me go and read the failures". Giving it a screen makes
  the rejections readable as a set, which is where the value is — the reason an
  idea was turned down is the most reusable thing in the system, and re-filing a
  near-identical idea six months later is the waste this prevents.

  The list is scoped by the same role rules as every other idea view: an
  employee sees their own, a lead sees their team's, an admin sees all of them.
  That is enforced server-side in ideaService.list().
*/
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

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('table.code')}</th>
              <th>{t('table.title')}</th>
              <th>{t('table.solution_gist')}</th>
              <th>{t('table.submitter')}</th>
              <th>{t('table.dept')}</th>
              <th>{t('table.impact')}</th>
              <th>{t('table.date')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan="8" className="text-center"><div className="spinner"></div></td></tr>
            )}
            {!loading && !ideas.length && (
              <tr><td colSpan="8" className="text-center">{t('dash.rejected_none')}</td></tr>
            )}
            {ideas.map((i) => (
              <tr key={i.id} data-status={i.status}>
                <td><strong>{i.idea_code}</strong></td>
                <td title={i.title}>{i.title.length > 60 ? i.title.substring(0, 60) + '…' : i.title}</td>
                <td style={{ maxWidth: 260, color: 'var(--text-muted)', fontSize: 12.5 }}>
                  {i.solution_summary || <span style={{ color: 'var(--subtle)' }}>—</span>}
                </td>
                <td>{i.submitter_name}</td>
                <td>{i.department || '–'}</td>
                <td>
                  <span className={`badge ${impactBadge(i.impact_level)}`}>
                    {translateImpact(i.impact_level, t) || '–'}
                  </span>
                </td>
                <td>{i.submitted_at ? fmtDate(i.submitted_at) : '–'}</td>
                <td>
                  <button className="btn btn-outline btn-sm" onClick={() => setOpenId(i.id)}>
                    {t('btn.view')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The rejection reason lives in the idea's workflow timeline, which the
          detail modal already renders — no separate fetch needed. */}
      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </ScreenGuard>
  );
}
