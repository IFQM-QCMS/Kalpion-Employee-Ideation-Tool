import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { usersApi } from '../services/api';
import { fmtDateTime, statusBadge, translateStatus, formatRole, canViewReports } from '../utils/helpers';
import Pager, { usePager } from '../components/Pager';

const EMPTY = { action: '', idea: '', actor: '', from: '', to: '' };

export default function AuditPage() {
  const { user }   = useAuth();
  const { t }      = useLang();
  const [rows,    setRows]    = useState([]);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  // What is typed, and what was last asked for - so typing does not fire a request per key.
  const [draft,   setDraft]   = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);

  useEffect(() => { load(filters); }, [filters]);

  async function load(f) {
    if (!canViewReports(user?.role)) {
      setError(t('msg.audit_restricted'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Calendar days are the reader's; the server needs the offset to turn them into UTC.
      const res = await usersApi.audit({ ...f, tz_offset: -new Date().getTimezoneOffset() });
      if (res.data.success) {
        setRows(res.data.audit || []);
        setActions(res.data.actions || []);
      } else setError(res.data.error || t('msg.fail_audit'));
    } catch { setError(t('msg.fail_audit')); }
    setLoading(false);
  }

  const active = Object.values(filters).some(Boolean);
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const apply = (e) => { e?.preventDefault?.(); setFilters({ ...draft }); };
  const clear = () => { setDraft(EMPTY); setFilters(EMPTY); };

  /*
   * One idea, one line - not a flat wall of every action against every idea mixed together
   * with no way to tell where one idea's history ends and the next begins. `rows` already
   * arrives newest-first, and a Map preserves insertion order, so the first time an idea is
   * seen while walking the list is also its most recent entry - the groups come out sorted
   * by "most recently active idea" for free.
   */
  const groups = useMemo(() => {
    const map = new Map();
    for (const w of rows) {
      const key = w.idea_id ?? w.idea_code;
      if (!map.has(key)) {
        map.set(key, {
          key, idea_code: w.idea_code, idea_title: w.idea_title,
          submitter_name: w.submitter_name, department: w.department,
          latest: w, entries: [],
        });
      }
      map.get(key).entries.push(w);
    }
    return [...map.values()];
  }, [rows]);

  const [expanded, setExpanded] = useState(new Set());
  function toggleExpanded(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Twenty ideas to a page, not twenty raw entries - the endpoint already bounds what it
  // returns (200 entries), but rendering all of them at once was the browser's cost, not the
  // server's.
  const pager = usePager(groups);

  return (
    <div className="card">
      {/* Filters: by what happened, to which idea, by whom, and when. */}
      <form onSubmit={apply} id="audit-filters"
        style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'flex-end', marginBottom:12 }}>
        <div className="form-group" style={{ margin:0 }}>
          <label style={{ fontSize:11 }}>{t('audit.filter_action')}</label>
          <select className="form-control" id="audit-f-action" value={draft.action} onChange={set('action')} style={{ width:170 }}>
            <option value="">{t('audit.filter_all_actions')}</option>
            {actions.map((a) => <option key={a} value={a}>{translateStatus(a, t)}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin:0 }}>
          <label style={{ fontSize:11 }}>{t('audit.filter_idea')}</label>
          <input className="form-control" id="audit-f-idea" type="search" value={draft.idea} onChange={set('idea')} style={{ width:200 }} />
        </div>
        <div className="form-group" style={{ margin:0 }}>
          <label style={{ fontSize:11 }}>{t('audit.filter_actor')}</label>
          <input className="form-control" id="audit-f-actor" type="search" value={draft.actor} onChange={set('actor')} style={{ width:160 }} />
        </div>
        <div className="form-group" style={{ margin:0 }}>
          <label style={{ fontSize:11 }}>{t('audit.filter_from')}</label>
          <input className="form-control" id="audit-f-from" type="date" value={draft.from} onChange={set('from')} />
        </div>
        <div className="form-group" style={{ margin:0 }}>
          <label style={{ fontSize:11 }}>{t('audit.filter_to')}</label>
          <input className="form-control" id="audit-f-to" type="date" value={draft.to} onChange={set('to')} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm">{t('audit.filter_apply')}</button>
        {active && <button type="button" className="btn btn-outline btn-sm" onClick={clear}>{t('audit.filter_clear')}</button>}
        {!loading && !error && (
          <span style={{ fontSize:11.5, color:'var(--text-muted)', marginLeft:'auto' }}>
            {t('audit.showing', { n: rows.length })}
          </span>
        )}
      </form>

      {loading && <div className="text-center" style={{ padding:'20px 0' }}><div className="spinner"></div></div>}
      {error && <div className="alert alert-warning">{error}</div>}
      {!loading && !error && !groups.length && <div className="text-center" style={{ padding:'20px 0' }}>{t('msg.no_audit')}</div>}

      {/*
       * One idea, one line: code, title, who last touched it and when, and how many entries
       * its history holds. Everything that used to be its own row - every action, every
       * actor, every comment - is one click away in the dropdown, grouped under the idea it
       * actually belongs to instead of interleaved with every other idea's history.
       */}
      {!loading && !error && !!groups.length && (
        <div className="idea-list" id="audit-tbody">
          {pager.slice.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <div key={g.key} className="idea-card">
                <div className="idea-card-top" style={{ cursor:'pointer' }} onClick={() => toggleExpanded(g.key)}
                  role="button" tabIndex={0} aria-expanded={isOpen}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(g.key); } }}>
                  <div className="idea-card-id">
                    <div className="idea-card-code">{g.idea_code}</div>
                    <div className="idea-card-title">{g.idea_title}</div>
                    <div className="idea-card-sub">
                      {g.submitter_name}{g.department ? ` · ${g.department}` : ''}
                    </div>
                  </div>
                  <div className="idea-card-badges">
                    <span className={`badge ${statusBadge(g.latest.action)}`}>{translateStatus(g.latest.action, t)}</span>
                    <span style={{ fontSize:11.5,color:'var(--subtle)' }}>{fmtDateTime(g.latest.created_at)}</span>
                  </div>
                </div>

                <button type="button" className="link" style={{ fontSize:12.5,marginTop:10,display:'flex',alignItems:'center',gap:5 }}
                  onClick={() => toggleExpanded(g.key)}>
                  <span style={{ display:'inline-block',transition:'transform .15s',transform:isOpen?'rotate(90deg)':'none' }}>▶</span>
                  {isOpen
                    ? t('audit.hide_entries')
                    : t('audit.show_entries', { n: g.entries.length })}
                </button>

                {isOpen && (
                  <div style={{ marginTop:10,paddingTop:10,borderTop:'1px solid var(--border)',display:'flex',flexDirection:'column',gap:10 }}>
                    {g.entries.map((w, i) => (
                      <div key={i} style={{ display:'flex',flexWrap:'wrap',gap:'4px 14px',fontSize:12.5 }}>
                        {/* Date AND time. An audit trail that says only "23 Aug" cannot order two decisions made on the same day, which is the question it exists to answer - and on a busy idea that is most of them. */}
                        <span style={{ color:'var(--subtle)',whiteSpace:'nowrap',minWidth:130 }}>{fmtDateTime(w.created_at)}</span>
                        <span className={`badge ${statusBadge(w.action)}`}>{translateStatus(w.action, t)}</span>
                        <span style={{ color:'var(--text-muted)' }}>{w.actor_name} ({formatRole(w.actor_role, t)})</span>
                        {w.comment && <span style={{ color:'var(--text)',width:'100%' }}>{w.comment}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Pager {...pager} noun="ideas" />
    </div>
  );
}
