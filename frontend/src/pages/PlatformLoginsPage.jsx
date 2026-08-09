import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { platformApi, saveBlob } from '../services/api';
import { fmtDateTime } from '../utils/helpers';
import InfoDot from '../components/InfoDot';

/*
 * Sign-in activity for the whole platform.
 *
 * The record it reads is append-only and separate from the lockout counter,
 * which is wiped on every successful sign-in and so can never answer "who
 * signed in, and when". Kept for 180 days, then trimmed.
 *
 * Failures are as interesting as successes: a run of them against one account,
 * or from one address, is the first sign of somebody guessing passwords.
 */

const OUTCOME_STYLE = {
  success: { bg: 'var(--success-light)', fg: 'var(--success)' },
  failure: { bg: 'var(--warning-light)', fg: 'var(--warning)' },
  lockout: { bg: 'var(--danger-light)',  fg: 'var(--danger)'  },
};

function OutcomeBadge({ outcome, t }) {
  const s = OUTCOME_STYLE[outcome] || OUTCOME_STYLE.failure;
  const label = { success: t('la.success'), failure: t('la.failure'), lockout: t('la.lockout') }[outcome] || outcome;
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 11, fontWeight: 700,
      padding: '3px 9px', borderRadius: 999, letterSpacing: .3, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

export default function PlatformLoginsPage() {
  const { t } = useLang();

  const [rows,    setRows]    = useState([]);
  const [last24,  setLast24]  = useState({ successes: 0, failures: 0, lockouts: 0 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [outcome, setOutcome] = useState('');
  const [limit,   setLimit]   = useState(100);
  const [search,  setSearch]  = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [outcome, limit]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await platformApi.activity({ outcome, limit });
      if (res.data.success) {
        setRows(res.data.activity || []);
        setLast24(res.data.last_24h || { successes: 0, failures: 0, lockouts: 0 });
      } else setError(res.data.error || t('msg.fail_load'));
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.fail_load'));
    }
    setLoading(false);
  }

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.actor_name, r.actor_email, r.tenant_slug, r.ip]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  function exportCsv() {
    const cols = ['created_at', 'actor_type', 'actor_name', 'actor_email',
      'tenant_slug', 'outcome', 'ip', 'user_agent'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...filtered.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'ifqm-login-activity.csv');
  }

  const kpis = [
    [t('la.kpi_success_24h'), last24.successes, 'var(--success)', 'var(--success-light)'],
    [t('la.kpi_failed_24h'),  last24.failures,  'var(--warning)', 'var(--warning-light)'],
    [t('la.kpi_lockouts_24h'), last24.lockouts, 'var(--danger)',  'var(--danger-light)'],
    [t('la.kpi_shown'),        filtered.length, 'var(--info)',    'var(--info-light)'],
  ];

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--heading)', margin: 0, letterSpacing: '-.5px' }}>
          {t('la.title')}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--subtle)', marginTop: 4 }}>{t('la.subtitle')}</div>
      </div>

      <div className="kpi-grid">
        {kpis.map(([label, val, color, bg]) => (
          <div className="card kpi-card" key={label}>
            <div className="kpi-icon" style={{ background: bg, color }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                <polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
              </svg>
            </div>
            <div>
              <div className="kpi-value" style={{ color }}>{val}</div>
              <div className="kpi-label">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="form-control" style={{ flex: '1 1 240px', minWidth: 200 }}
          placeholder={t('la.search_ph')} value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <select className="form-control" style={{ width: 170 }} value={outcome}
          onChange={(e) => setOutcome(e.target.value)}>
          <option value="">{t('la.all_outcomes')}</option>
          <option value="success">{t('la.success')}</option>
          <option value="failure">{t('la.failure')}</option>
          <option value="lockout">{t('la.lockout')}</option>
        </select>
        <select className="form-control" style={{ width: 140 }} value={limit}
          onChange={(e) => setLimit(parseInt(e.target.value, 10))}>
          {[50, 100, 200].map((n) => <option key={n} value={n}>{t('la.last_n').replace('{n}', n)}</option>)}
        </select>
        <button className="btn btn-outline" onClick={load}>{t('btn.refresh')}</button>
        <button className="btn btn-outline" onClick={exportCsv} disabled={!filtered.length}>
          {t('pa.export_csv')}
        </button>
      </div>

      {error && <div className="alert alert-danger" style={{ marginTop: 14 }}>{error}</div>}

      <div className="card" style={{ marginTop: 18, overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('la.col_when')}</th>
              <th>{t('la.col_who')}</th>
              <th>{t('la.col_kind')}</th>
              <th>{t('la.col_org')}</th>
              <th>{t('la.col_outcome')}</th>
              <th>{t('la.col_ip')}<InfoDot term="ip_address" /></th>
              <th>{t('la.col_device')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="7" className="text-center"><div className="spinner"></div></td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan="7" className="text-center">{t('la.none')}</td></tr>
            )}
            {!loading && filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--heading)' }}>{r.actor_name || '—'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--subtle)' }}>{r.actor_email || '—'}</div>
                </td>
                <td style={{ fontSize: 12.5 }}>
                  {r.actor_type === 'platform_admin' ? t('la.kind_platform') : t('la.kind_tenant')}
                </td>
                <td style={{ fontSize: 12.5 }}>{r.tenant_slug || '—'}</td>
                <td><OutcomeBadge outcome={r.outcome} t={t} /></td>
                <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.ip || '—'}</td>
                <td style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  <div className="cell-clamp" style={{ maxWidth: 260 }} title={r.user_agent || ''}>
                    {r.user_agent || '—'}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 10 }}>{t('la.retention_note')}</div>
    </>
  );
}
