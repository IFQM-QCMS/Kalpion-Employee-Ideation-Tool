import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { platformApi, saveBlob } from '../services/api';
import { fmtDateTime } from '../utils/helpers';
import InfoDot from '../components/InfoDot';

/*
 * Sign-in activity for the IFQM platform console.
 *
 * Staff accounts only. It used to list every employee sign-in across every
 * customer organisation, which buried the thing the page exists to answer —
 * who has been in this console — and put customers' internal staff movements
 * on a screen that has no business showing them.
 *
 * The record is append-only and separate from the lockout counter, which is
 * wiped on every successful sign-in and so could never answer "who signed in,
 * and when". Kept for 180 days, then trimmed.
 *
 * Failures matter as much as successes: a run of them against one account, or
 * from one address, is the first sign of somebody guessing passwords.
 */

/*
 * Turn a user-agent string into something a person can read.
 *
 * Deliberately shallow. Every browser lies in its user-agent for historical
 * reasons — Chrome claims to be Safari, Edge claims to be Chrome — so this
 * checks in the order that gets the common cases right and gives up gracefully
 * rather than pretending to be a full parser. The raw string stays in the
 * tooltip for anyone who needs the truth.
 */
function describeDevice(ua) {
  const s = String(ua || '');
  if (!s) return '—';
  const browser =
      /Edg\//.test(s)                        ? 'Edge'
    : /OPR\/|Opera/.test(s)                  ? 'Opera'
    : /Chrome\//.test(s) && !/Chromium/.test(s) ? 'Chrome'
    : /Firefox\//.test(s)                    ? 'Firefox'
    : /Safari\//.test(s)                     ? 'Safari'
    : 'Browser';
  const version = s.match(/(?:Edg|OPR|Chrome|Firefox|Version)\/(\d+)/)?.[1];
  const os =
      /Windows NT 10/.test(s)  ? 'Windows'
    : /Windows/.test(s)        ? 'Windows'
    : /Android/.test(s)        ? 'Android'
    : /iPhone|iPad|iOS/.test(s)? 'iOS'
    : /Mac OS X/.test(s)       ? 'macOS'
    : /Linux/.test(s)          ? 'Linux'
    : '';
  return `${browser}${version ? ' ' + version : ''}${os ? ' on ' + os : ''}`;
}

/* An address on a private range is almost always the hosting provider's own
   proxy rather than anything about the person, so the row says so instead of
   leaving an operator to wonder why every sign-in is from 10.x. */
const NETWORK_NOTE = { private: 'internal network', local: 'this machine', public: '' };

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
  const [actorType, setActorType] = useState('all');
  const [last24,  setLast24]  = useState({ successes: 0, failures: 0, lockouts: 0 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [outcome, setOutcome] = useState('');
  const [limit,   setLimit]   = useState(100);
  const [search,  setSearch]  = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [actorType, outcome, limit]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await platformApi.activity({ actor_type: actorType, outcome, limit });
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
    return [r.actor_name, r.actor_email, r.ip, r.location, r.tenant_slug]
      .some((v) => String(v || '').toLowerCase().includes(q));
  });

  function exportCsv() {
    const cols = ['created_at', 'actor_name', 'actor_email', 'tenant_slug', 'outcome',
      'location', 'ip', 'network', 'user_agent'];
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
          className="form-control" style={{ flex: '1 1 200px', minWidth: 180 }}
          placeholder={t('la.search_ph')} value={search}
          onChange={(e) => setSearch(e.target.value)} />
        <select className="form-control" style={{ width: 170 }} value={actorType}
          onChange={(e) => setActorType(e.target.value)}>
          <option value="all">All Accounts</option>
          <option value="platform_admin">Platform Admins Only</option>
          <option value="tenant_user">Tenant Users Only</option>
        </select>
        <select className="form-control" style={{ width: 150 }} value={outcome}
          onChange={(e) => setOutcome(e.target.value)}>
          <option value="">{t('la.all_outcomes')}</option>
          <option value="success">{t('la.success')}</option>
          <option value="failure">{t('la.failure')}</option>
          <option value="lockout">{t('la.lockout')}</option>
        </select>
        <select className="form-control" style={{ width: 130 }} value={limit}
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
              <th>{t('la.col_outcome')}</th>
              <th>{t('la.col_location')}<InfoDot term="approx_location" /></th>
              <th>{t('la.col_ip')}<InfoDot term="ip_address" /></th>
              <th>{t('la.col_device')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="6" className="text-center"><div className="spinner"></div></td></tr>}
            {!loading && !filtered.length && (
              <tr><td colSpan="6" className="text-center">{t('la.none')}</td></tr>
            )}
            {!loading && filtered.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                <td>
                  <div style={{ fontWeight: 600, color: 'var(--heading)' }}>{r.actor_name || '—'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--subtle)' }}>{r.actor_email || '—'}</div>
                </td>
                <td><OutcomeBadge outcome={r.outcome} t={t} /></td>
                <td style={{ fontSize: 12.5 }}>
                  {r.location || <span style={{ color: 'var(--subtle)' }}>—</span>}
                </td>
                <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {r.ip || '—'}
                  {NETWORK_NOTE[r.network] && (
                    <div style={{ fontSize: 11, color: 'var(--subtle)' }}>{NETWORK_NOTE[r.network]}</div>
                  )}
                </td>
                <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  <div className="cell-clamp" style={{ maxWidth: 220 }} title={r.user_agent || ''}>
                    {describeDevice(r.user_agent)}
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
