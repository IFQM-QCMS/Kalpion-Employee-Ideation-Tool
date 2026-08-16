import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { ideasApi, votesApi, exportApi, saveBlob } from '../services/api';
import { statusBadge, impactBadge, scoreBadgeClass, translateStatus, translateImpact,
         fmtDateTime, communityScore, isAdmin, isSuperAdmin } from '../utils/helpers';
import IdeaDetailModal from '../components/IdeaDetailModal';
import InfoDot from '../components/InfoDot';
import ScreenGuard from '../components/ScreenGuard';
import BulkArchivePanel from '../components/BulkArchivePanel';
import Pager, { usePager } from '../components/Pager';

/* Escape for the print window — that HTML is built by string concatenation, so
   React's automatic escaping does not apply to it. */
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function VoteWidget({ ideaId, isSelf, upvotes, downvotes, userVote, onVote }) {
  return (
    <div style={{ display:'inline-flex',alignItems:'center',gap:4 }}>
      <button
        className="btn btn-sm"
        style={{ padding:'2px 6px',fontSize:11,borderRadius:6,
          background:userVote==='up'?'#bbf7d0':'var(--chip-bg)',
          color:userVote==='up'?'#10b981':'var(--text-muted)',
          border:`1px solid ${userVote==='up'?'#bbf7d0':'var(--border)'}` }}
        onClick={() => !isSelf && onVote(ideaId,'up')}
        disabled={isSelf}
      >▲ {upvotes}</button>
      <button
        className="btn btn-sm"
        style={{ padding:'2px 6px',fontSize:11,borderRadius:6,
          background:userVote==='down'?'#fee2e2':'var(--chip-bg)',
          color:userVote==='down'?'#ef4444':'var(--text-muted)',
          border:`1px solid ${userVote==='down'?'#fecaca':'var(--border)'}` }}
        onClick={() => !isSelf && onVote(ideaId,'down')}
        disabled={isSelf}
      >▼ {downvotes}</button>
    </div>
  );
}

export default function AllIdeasPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();
  const [ideas,   setIdeas]   = useState([]);

  /* Twenty to a page. The endpoint already bounds what it returns; rendering
     every row of it was the browser's cost, not the server's. */
  const pager = usePager(ideas);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [status,  setStatus]  = useState('');
  const [impact,  setImpact]  = useState('');
  const [openId,  setOpenId]  = useState(null);
  const [archived, setArchived] = useState('');   // '' = live only, '1' = archived only
  const pollRef = useRef(null);
  const canArchive = isAdmin(user?.role) || isSuperAdmin(user?.role);

  /*
   * Refresh while somebody is actually looking.
   *
   * This used to poll every 10 seconds and keep polling while the tab sat in
   * the background — 360 requests an hour from one person, all day. Ideas do
   * not change that fast. A minute is plenty, the timer stops while the tab is
   * hidden, and returning to the tab fetches once immediately so nobody is
   * looking at stale rows while waiting for the next tick.
   */
  useEffect(() => {
    loadIdeas();

    const start = () => {
      clearInterval(pollRef.current);
      pollRef.current = setInterval(loadIdeas, 60000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { loadIdeas(); start(); }
      else clearInterval(pollRef.current);
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [search, status, impact, archived]);

  async function loadIdeas() {
    try {
      const res = await ideasApi.list({ search, status, impact, archived });
      setIdeas(res.data.ideas || []);
    } catch { /* non-blocking poll */ }
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
    try {
      const res = await votesApi.communityVote({ idea_id: ideaId, vote_type: voteType });
      if (res.data.success) loadIdeas();
      else showToast(res.data.error || t('msg.error'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  /*
   * CSV of the current view. Values are quoted and internal quotes doubled — an
   * idea titled `Reduce "idle" time, phase 2` would otherwise split into extra
   * columns and silently corrupt the file.
   *
   * The full solution is deliberately NOT exported: the server does not send it
   * to this screen (see redactSolution), so an export that appeared to contain
   * it would either be empty or a privacy hole depending on who clicked it.
   */
  function exportCsv() {
    const cols = ['idea_code','title','solution_summary','patentable_flag','submitter_name','department',
      'impact_level','ai_score','status','submitted_at'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...ideas.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n');
    saveBlob(new Blob([csv], { type:'text/csv;charset=utf-8' }), 'ifqm-ideas.csv');
  }

  /* PDF via the browser's own print-to-PDF. A dependency-free route that gives
     the user their platform's real save dialogue, rather than shipping a PDF
     library to every visitor for a button most never press. */
  function exportPdf() {
    const rows = ideas.map(i => `<tr>
        <td>${esc(i.idea_code)}</td><td>${esc(i.title)}</td>
        <td>${esc(i.solution_summary)}</td>
        <td>${i.patentable_flag ? 'Yes' : ''}</td><td>${esc(i.submitter_name)}</td>
        <td>${esc(i.department)}</td><td>${esc(i.impact_level)}</td>
        <td>${esc(i.ai_score)}</td><td>${esc(i.status)}</td>
        <td>${esc(fmtDateTime(i.submitted_at))}</td></tr>`).join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>IFQM — Ideas</title><style>
        body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px;color:#111}
        h1{font-size:17px;margin:0 0 4px} p{font-size:11px;color:#666;margin:0 0 16px}
        table{border-collapse:collapse;width:100%;font-size:10.5px}
        th,td{border:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}
        th{background:#f3f4f6}
      </style></head><body>
      <h1>IFQM — Ideas</h1>
      <p>${ideas.length} idea(s) · exported ${new Date().toLocaleString()}</p>
      <table><thead><tr>
        <th>Code</th><th>Title</th><th>Solution (gist)</th><th>{t('table.patentable')}</th><th>{t('table.submitter')}</th><th>Dept</th>
        <th>{t('table.impact')}</th><th>{t('table.score')}</th><th>Status</th><th>{t('table.datetime')}</th>
      </tr></thead><tbody>${rows}</tbody></table></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <ScreenGuard>
      <div className="filter-bar">
        <input className="form-control" type="search" placeholder={t('filter.search_ideas')}
          value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth:260 }} />
        <select className="form-control" value={status} onChange={e => setStatus(e.target.value)} style={{ width:160 }}>
          <option value="">{t('filter.all_statuses')}</option>
          {['Submitted','Under Review','Approved','Rejected','Implemented'].map(s => (
            <option key={s} value={s}>{translateStatus(s, t)}</option>
          ))}
        </select>
        <select className="form-control" value={impact} onChange={e => setImpact(e.target.value)} style={{ width:160 }}>
          <option value="">{t('filter.all_impact')}</option>
          {['High','Medium','Low'].map(l => (
            <option key={l} value={l}>{translateImpact(l, t)}</option>
          ))}
        </select>

        {/* §13.2 — archived ideas are out of the way but never gone. */}
        <label style={{ display:'flex',alignItems:'center',gap:6,fontSize:12.5,color:'var(--text-muted)',cursor:'pointer' }}>
          <input type="checkbox" checked={archived === '1'}
            onChange={e => setArchived(e.target.checked ? '1' : '')}
            style={{ accentColor:'var(--primary)' }} />
          {t('idea.show_archived')}<InfoDot term="archived" />
        </label>

        {/* §13.3 — export what is on screen. Client-side: the rows are already
            in the browser, so this needs no endpoint and honours the filters
            exactly as the user set them. */}
        <div style={{ display:'flex',gap:8,marginLeft:'auto' }}>
          <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={!ideas.length}>
            {t('btn.export_csv')}
          </button>
          <button className="btn btn-outline btn-sm" onClick={exportPdf} disabled={!ideas.length}>
            {t('btn.export_pdf')}
          </button>
        </div>
      </div>

      {/* True archiving, not just a filter — an organisation admin can clear out
          a whole year of ideas at once, and put them back the same way. */}
      {canArchive && (
        <BulkArchivePanel
          visibleIds={ideas.map(i => i.id)}
          onRun={(payload) => ideasApi.bulkArchive(payload)}
          onDone={loadIdeas}
          labelKey="bulk.ideas" />
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card" style={{ overflowX:'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('table.code')}</th>
              <th>{t('table.title')}</th>
              <th>{t('table.solution_gist')}</th>
              <th>{t('table.patentable')}<InfoDot term="patentable" /></th>
              <th>{t('table.submitter')}</th>
              <th>{t('table.dept')}</th>
              <th>{t('table.impact')}</th>
              <th>{t('table.score')}<InfoDot term="community_score" /></th>
              <th>{t('table.votes')}</th>
              <th>{t('table.status')}</th>
              <th>{t('table.date')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="all-ideas-tbody">
            {loading && (
              <tr><td colSpan="12" className="text-center"><div className="spinner"></div></td></tr>
            )}
            {!loading && !ideas.length && (
              <tr><td colSpan="12" className="text-center">{t('msg.no_ideas')}</td></tr>
            )}
            {pager.slice.map(i => {
              const isSelf  = parseInt(i.submitter_id) === parseInt(user?.id);
              const cScore  = communityScore(i.ai_score, i.upvotes||0, i.downvotes||0);
              return (
                <tr key={i.id}>
                  <td><strong>{i.idea_code}</strong></td>
                  <td title={i.title}>
                    <div className="cell-clamp" style={{ maxWidth:280 }}>{i.title}</div>
                  </td>
                  {/* One line only. The full proposal is deliberately not sent to
                      this screen — see redactSolution() in ideaService. */}
                  <td style={{ color:'var(--text-muted)',fontSize:12.5 }}>
                    {i.solution_summary
                      ? <div className="cell-clamp" style={{ maxWidth:260 }}
                             title={i.solution_redacted ? t('idea.solution_hidden_hint') : i.solution_summary}>
                          {i.solution_summary}
                          {i.solution_redacted && <span style={{ marginLeft:5,opacity:.65 }} aria-hidden="true">Protected</span>}
                        </div>
                      : <span style={{ color:'var(--subtle)' }}>—</span>}
                  </td>
                  <td className="text-center">
                    {i.patentable_flag
                      ? <span className="badge badge-info" title={t('idea.patentable_hint')}>{t('idea.patentable_short')}</span>
                      : <span style={{ color:'var(--subtle)' }}>—</span>}
                  </td>
                  <td>{i.submitter_name}</td>
                  <td>{i.department||'–'}</td>
                  <td><span className={`badge ${impactBadge(i.impact_level)}`}>{translateImpact(i.impact_level,t)||'–'}</span></td>
                  <td>
                    {i.ai_score > 0
                      ? <span id={`cscore-${i.id}`} className={scoreBadgeClass(cScore)}
                          title={`AI Score: ${i.ai_score}/100 · Community adjustment: ${cScore-i.ai_score>=0?'+':''}${cScore-i.ai_score}`}>
                          {cScore}/100
                        </span>
                      : <span className="score-none score-badge">—</span>
                    }
                  </td>
                  <td>
                    {i.status !== 'Draft'
                      ? <VoteWidget ideaId={i.id} isSelf={isSelf}
                          upvotes={i.upvotes||0} downvotes={i.downvotes||0}
                          userVote={i.user_community_vote||null} onVote={castVote} />
                      : <span style={{ fontSize:11,color:'var(--subtle)' }}>—</span>
                    }
                  </td>
                  <td><span className={`badge ${statusBadge(i.status)}`}>{translateStatus(i.status,t)}</span></td>
                  <td style={{ whiteSpace:'nowrap' }}>{fmtDateTime(i.submitted_at)}</td>
                  <td>
                    {/* Outside the idea? No full view is offered - the overlay
                        would be a title and a row of locked notices. The gist
                        they are entitled to is downloadable instead. */}
                    {i.viewer_inside === false ? (
                      <button className="btn btn-outline btn-sm" title={t('idea.summary_only_hint')}
                        onClick={() => downloadGist(i)}>
                        {t('btn.summary')}
                      </button>
                    ) : (
                      <button className="btn btn-outline btn-sm" onClick={() => setOpenId(i.id)}>
                        {t('btn.view')}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager {...pager} noun="ideas" />
      </div>

      {openId && <IdeaDetailModal ideaId={openId} onClose={() => { setOpenId(null); loadIdeas(); }} />}
    </ScreenGuard>
  );
}
