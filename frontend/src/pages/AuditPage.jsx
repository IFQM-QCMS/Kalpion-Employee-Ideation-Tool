import { useState, useEffect } from 'react';
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

  // Twenty to a page: the list endpoints already bound what they return, but rendering every
  // row was the browser's cost, not the server's.
  const pager = usePager(rows);

  return (
    <div className="card" style={{ overflowX:'auto' }}>
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

      <table className="table">
        <thead>
          <tr>
            <th>{t('audit.when')}</th>
            <th>{t('table.idea')}</th>
            <th>{t('table.action')}</th>
            <th>{t('table.actor')}</th>
            <th>{t('table.comment')}</th>
          </tr>
        </thead>
        <tbody id="audit-tbody">
          {loading && (
            <tr><td colSpan="5" className="text-center"><div className="spinner"></div></td></tr>
          )}
          {error && (
            <tr><td colSpan="5" className="text-center">
              <div className="alert alert-warning">{error}</div>
            </td></tr>
          )}
          {!loading && !error && !rows.length && (
            <tr><td colSpan="5" className="text-center">{t('msg.no_audit')}</td></tr>
          )}
          {pager.slice.map((w, i) => (
            <tr key={i}>
              {/* Date AND time. An audit trail that says only "23 Aug" cannot order two decisions made on the same day, which is the question it exists to answer - and on a busy idea that is most of them. */}
              <td style={{ whiteSpace:'nowrap' }}>{fmtDateTime(w.created_at)}</td>
              <td>
                <strong>{w.idea_code}</strong>
                <br /><small>{(w.idea_title||'').substring(0,40)}</small>
              </td>
              <td><span className={`badge ${statusBadge(w.action)}`}>{translateStatus(w.action, t)}</span></td>
              <td>{w.actor_name} <small>({formatRole(w.actor_role, t)})</small></td>
              <td>{w.comment || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
        <Pager {...pager} noun="entries" />
    </div>
  );
}
