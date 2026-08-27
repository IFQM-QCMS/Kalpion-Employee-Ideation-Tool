import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { usersApi } from '../services/api';
import { fmtDateTime, statusBadge, translateStatus, formatRole, canViewReports } from '../utils/helpers';
import Pager, { usePager } from '../components/Pager';

export default function AuditPage() {
  const { user }   = useAuth();
  const { t }      = useLang();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    if (!canViewReports(user?.role)) {
      setError(t('msg.audit_restricted'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await usersApi.audit();
      if (res.data.success) setRows(res.data.audit || []);
      else setError(res.data.error || t('msg.fail_audit'));
    } catch { setError(t('msg.fail_audit')); }
    setLoading(false);
  }

  // Twenty to a page: the list endpoints already bound what they return,
  // but rendering every row was the browser's cost, not the server's.
  const pager = usePager(rows);

  return (
    <div className="card" style={{ overflowX:'auto' }}>
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
              {/*
                Date AND time. An audit trail that says only "23 Aug" cannot
                order two decisions made on the same day, which is the question
                it exists to answer — and on a busy idea that is most of them.
              */}
              <td style={{ whiteSpace:'nowrap' }}>{fmtDateTime(w.created_at)}</td>
              <td>
                <strong>{w.idea_code}</strong>
                <br /><small>{(w.idea_title||'').substring(0,40)}</small>
              </td>
              <td><span className={`badge ${statusBadge(w.action)}`}>{translateStatus(w.action, t)}</span></td>
              <td>{w.actor_name} <small>({formatRole(w.actor_role, t)})</small></td>
              <td>{w.comment || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
        <Pager {...pager} noun="entries" />
    </div>
  );
}
