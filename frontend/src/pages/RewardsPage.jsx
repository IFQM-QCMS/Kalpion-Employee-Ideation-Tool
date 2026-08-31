import { useState, useEffect, useCallback } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { rewardsApi } from '../services/api';
import { formatRole } from '../utils/helpers';

/*
 * Rewards & Recognition.
 *
 * The org admin picks a period, sees the WHOLE leaderboard for it, and hands
 * HR a document. That last part is the point of the screen — nobody rewards
 * anybody from a browser tab, they forward a file.
 *
 * ── Why the whole list, always ─────────────────────────────────────────────
 *
 * The ordinary leaderboard stops at twenty. A reward list that silently
 * truncates is worse than none: the twenty-first person is not told they were
 * cut, and the person reading it cannot tell the cut happened. Everybody who
 * took part in the period appears here, in order, and the count is stated so
 * the reader can see nothing is missing.
 */

const PERIODS = [
  ['weekly', 'rr.p_weekly'],
  ['fortnightly', 'rr.p_fortnightly'],
  ['monthly', 'rr.p_monthly'],
  ['quarterly', 'rr.p_quarterly'],
  ['half_yearly', 'rr.p_half_yearly'],
  ['yearly', 'rr.p_yearly'],
];

export default function RewardsPage() {
  const { t } = useLang();
  const { showToast } = useToast();

  const [period, setPeriod] = useState('monthly');
  /*
   * Defaults to the LAST complete period, not the one in progress.
   *
   * Rewarding happens just after a period ends — you decide March's award in
   * April. Opening on a half-finished month would show a list that is going to
   * change, which is the one thing a reward shortlist must not do.
   */
  const [offset, setOffset] = useState(1);
  const [includeAll, setIncludeAll] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [custom, setCustom] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const opts = useCallback(() => (custom
    ? { from, to, include_all: includeAll }
    : { period, offset, include_all: includeAll }), [custom, from, to, period, offset, includeAll]);

  const load = useCallback(async () => {
    if (custom && (!from || !to)) return;
    setLoading(true);
    setError('');
    try {
      const res = await rewardsApi.leaderboard(opts());
      if (res.data.success) setData(res.data);
      else setError(res.data.error || t('msg.fail_load'));
    } catch (e) {
      setError(e?.response?.data?.error || t('msg.fail_load'));
    }
    setLoading(false);
  }, [opts, custom, from, to, t]);

  useEffect(() => { load(); }, [load]);

  const download = async (kind) => {
    setBusy(kind);
    try {
      const r = data?.range;
      const name = `rewards_${r?.period || period}_${r?.start || ''}_to_${r?.end || ''}.${kind === 'excel' ? 'xlsx' : 'pdf'}`;
      if (kind === 'excel') await rewardsApi.excel(opts(), name);
      else await rewardsApi.pdf(opts(), name);
      showToast(t('rr.downloaded'), 'success');
    } catch (e) {
      showToast(e?.response?.data?.error || t('msg.server_error'), 'danger');
    }
    setBusy('');
  };

  const totals = data?.totals;

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--heading)', margin: 0, letterSpacing: '-.4px' }}>
          {t('rr.title')}
        </h1>
        <div style={{ fontSize: 13, color: 'var(--subtle)', marginTop: 3 }}>
          {t('rr.subtitle')}
        </div>
      </div>

      {/* ── Period ── */}
      <div className="card" style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, minWidth: 180 }}>
            <label>{t('rr.period')}</label>
            <select className="form-control" value={custom ? 'custom' : period}
              onChange={(e) => {
                if (e.target.value === 'custom') setCustom(true);
                else { setCustom(false); setPeriod(e.target.value); }
              }}>
              {PERIODS.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
              <option value="custom">{t('rr.p_custom')}</option>
            </select>
          </div>

          {!custom && (
            <div className="form-group" style={{ margin: 0, minWidth: 200 }}>
              <label>{t('rr.which')}</label>
              <select className="form-control" value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}>
                <option value={1}>{t('rr.last_complete')}</option>
                <option value={0}>{t('rr.in_progress')}</option>
                <option value={2}>{t('rr.two_ago')}</option>
                <option value={3}>{t('rr.three_ago')}</option>
              </select>
            </div>
          )}

          {custom && (
            <>
              <div className="form-group" style={{ margin: 0 }}>
                <label>{t('rr.from')}</label>
                <input type="date" className="form-control" value={from}
                  onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>{t('rr.to')}</label>
                <input type="date" className="form-control" value={to}
                  onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, paddingBottom: 8 }}>
            <input type="checkbox" checked={includeAll}
              onChange={(e) => setIncludeAll(e.target.checked)} />
            {t('rr.include_all')}
          </label>
        </div>

        {data?.range && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--text-muted)' }}>
            {/* The window in dates, not just its name. A reader a month later
                cannot check "monthly"; they can check "1 Mar to 31 Mar". */}
            {t('rr.covering', { range: data.range.display })}
          </div>
        )}
      </div>

      {/* ── Download ── */}
      <div className="card" style={{ marginTop: 14, padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--heading)' }}>
            {t('rr.share_title')}
          </span>
          <button className="btn btn-primary btn-sm" disabled={!!busy || !data?.people?.length}
            onClick={() => download('excel')}>
            {busy === 'excel' ? t('msg.loading') : t('rr.dl_excel')}
          </button>
          <button className="btn btn-outline btn-sm" disabled={!!busy || !data?.people?.length}
            onClick={() => download('pdf')}>
            {busy === 'pdf' ? t('msg.loading') : t('rr.dl_pdf')}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--subtle)' }}>{t('rr.dl_hint')}</span>
        </div>
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error && <div className="alert alert-danger" style={{ marginTop: 14 }}>{error}</div>}

      {!loading && !error && totals && (
        <>
          <div className="kpi-grid" style={{ marginTop: 16 }}>
            <Stat label={t('rr.k_people')} value={totals.people} accent="#0b2545" />
            <Stat label={t('rr.k_ideas')} value={totals.ideas} accent="#1a5299" />
            <Stat label={t('rr.k_approved')} value={totals.approved} accent="#177245" />
            <Stat label={t('rr.k_implemented')} value={totals.implemented} accent="#8a6d1f" />
            <Stat label={t('rr.k_points')} value={totals.points} accent="#7a2e6d" />
          </div>

          <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
            {!data.people.length ? (
              <div className="empty-state">{t('rr.none')}</div>
            ) : (
              <>
                <div style={{ padding: '12px 16px 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                  {/* Stated so nobody has to wonder whether this is a top ten. */}
                  {t('rr.showing_all', { n: data.people.length })}
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 50 }}>{t('rr.col_rank')}</th>
                      <th>{t('rr.col_name')}</th>
                      <th>{t('rr.col_dept')}</th>
                      <th>{t('rr.col_role')}</th>
                      <th className="text-center">{t('rr.col_ideas')}</th>
                      <th className="text-center">{t('rr.col_approved')}</th>
                      <th className="text-center">{t('rr.col_implemented')}</th>
                      <th className="text-center">{t('rr.col_pending')}</th>
                      <th style={{ textAlign: 'right' }}>{t('rr.col_points')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.people.map((p) => (
                      <tr key={p.id}>
                        <td style={{ fontWeight: 700 }}>{p.rank}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--subtle)' }}>{p.employee_id}</div>
                        </td>
                        <td style={{ fontSize: 12.5 }}>{p.department || '—'}</td>
                        <td style={{ fontSize: 12.5 }}>{formatRole(p.role, t)}</td>
                        <td className="text-center">{p.ideas_submitted}</td>
                        <td className="text-center">{p.ideas_approved}</td>
                        <td className="text-center">{p.ideas_implemented}</td>
                        <td className="text-center">{p.ideas_pending}</td>
                        <td style={{ textAlign: 'right' }}>
                          <strong>{p.points_period}</strong>
                          {/* The working, beside the total: a score somebody is
                              rewarded against should be checkable on sight. */}
                          <div style={{ fontSize: 10.5, color: 'var(--subtle)' }}>
                            {p.points_submission} + {p.points_from_ideas}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="card" style={{ padding: '16px 18px', borderTop: `4px solid ${accent}`, borderRadius: 12 }}>
      <div style={{ color: accent, fontSize: 28, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontWeight: 650, fontSize: 12.5, color: 'var(--heading)', marginTop: 6 }}>{label}</div>
    </div>
  );
}
