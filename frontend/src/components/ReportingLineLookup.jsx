import { useState, useRef, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { usersApi } from '../services/api';
import { formatRole } from '../utils/helpers';
import InfoDot from '../components/InfoDot';

/*
 * Type a name, get that person's whole reporting line.
 *
 * The org chart already existed, but reading one person's line off a tree of a
 * few thousand people means scrolling and counting indents. The question an
 * administrator actually asks is "who does Priya's idea go to, and after that?"
 * — and that is a straight line, not a tree.
 *
 * The chain is worked out on the server (userService.reportingChain), walking
 * manager_id upward with a visited-set, because a chart that has accidentally
 * been made circular is a real thing and would otherwise spin forever here.
 *
 * Shown top-down: the most senior person first, the person you asked about
 * last, then their direct reports. That is the direction an idea travels, so
 * it reads the same way the escalation works.
 */
export default function ReportingLineLookup() {
  const { t } = useLang();

  const [query,   setQuery]   = useState('');
  const [matches, setMatches] = useState([]);
  const [open,    setOpen]    = useState(false);
  const [chain,   setChain]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const timerRef = useRef(null);
  const boxRef   = useRef(null);

  // Close the suggestion list on an outside click, or the list hangs over the
  // rest of the page after the person has moved on.
  useEffect(() => {
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  /* Search on the server rather than filtering a list held in the browser: a
     tenant can hold ten thousand employees and pulling them all down to answer
     one lookup is the thing this screen was changed to stop doing. */
  function onType(value) {
    setQuery(value);
    setError('');
    clearTimeout(timerRef.current);
    if (value.trim().length < 2) { setMatches([]); setOpen(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await usersApi.adminList({ q: value.trim(), limit: 8, page: 1 });
        setMatches(res.data.users || []);
        setOpen(true);
      } catch { /* a failed suggestion lookup is not worth an error banner */ }
    }, 250);
  }

  async function pick(u) {
    setOpen(false);
    setQuery(u.name);
    setLoading(true);
    setError('');
    try {
      const res = await usersApi.chain(u.id);
      if (res.data.success) setChain(res.data);
      else setError(res.data.error || t('msg.fail_load'));
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.fail_load'));
    }
    setLoading(false);
  }

  function clear() {
    setQuery(''); setMatches([]); setChain(null); setError(''); setOpen(false);
  }

  // Most senior first, then downward to the person asked about.
  const ladder = chain ? [...(chain.chain || [])].reverse() : [];

  const Person = ({ p, level, highlight }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 12px', marginLeft: level * 22,
      background: highlight ? 'var(--primary-light)' : 'var(--panel-bg)',
      border: `1px solid ${highlight ? 'var(--primary-dim, var(--primary))' : 'var(--border)'}`,
      borderRadius: 10, marginBottom: 6,
    }}>
      <div className="avatar" style={{ width: 30, height: 30, fontSize: 11, flexShrink: 0 }}>
        {p.avatar_initials || p.name?.[0] || '?'}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: highlight ? 800 : 600, fontSize: 13, color: 'var(--heading)' }}>
          {p.name}
          {highlight && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>
            {t('hier.this_person')}
          </span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--subtle)' }}>
          {formatRole(p.role, t)}{p.department ? ` · ${p.department}` : ''}
          {p.employee_id ? ` · ${p.employee_id}` : ''}
        </div>
      </div>
    </div>
  );

  return (
    <div className="card">
      <div className="card-title">{t('hier.lookup_title')}<InfoDot term="reporting_line" /></div>
      <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 14 }}>{t('hier.lookup_hint')}</div>

      <div ref={boxRef} style={{ position: 'relative', maxWidth: 420, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-control"
            placeholder={t('hier.lookup_ph')}
            value={query}
            onChange={(e) => onType(e.target.value)}
            onFocus={() => matches.length && setOpen(true)} />
          {(query || chain) && (
            <button className="btn btn-outline btn-sm" onClick={clear}>{t('btn.clear')}</button>
          )}
        </div>

        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40, marginTop: 4,
            background: 'var(--card-bg, var(--panel-bg))', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.12)', overflow: 'hidden',
          }}>
            {!matches.length
              ? <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--subtle)' }}>{t('hier.lookup_none')}</div>
              : matches.map((u) => (
                <button key={u.id} type="button" onClick={() => pick(u)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px',
                    background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--heading)' }}>{u.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--subtle)' }}>
                    {formatRole(u.role, t)}{u.department ? ` · ${u.department}` : ''} · {u.email}
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error && <div className="alert alert-danger">{error}</div>}

      {!loading && chain && (
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                        color: 'var(--subtle)', fontWeight: 700, marginBottom: 8 }}>
            {t('hier.chain_up')}
          </div>
          {!ladder.length && (
            <div style={{ fontSize: 12.5, color: 'var(--subtle)', marginBottom: 8 }}>{t('hier.chain_top')}</div>
          )}
          {ladder.map((p, i) => <Person key={p.id} p={p} level={i} />)}
          <Person p={chain.user} level={ladder.length} highlight />

          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .5,
                        color: 'var(--subtle)', fontWeight: 700, margin: '16px 0 8px' }}>
            {t('hier.direct_reports')} ({(chain.direct_reports || []).length})
          </div>
          {!(chain.direct_reports || []).length
            ? <div style={{ fontSize: 12.5, color: 'var(--subtle)' }}>{t('hier.no_reports')}</div>
            : chain.direct_reports.map((p) => <Person key={p.id} p={p} level={ladder.length + 1} />)}
        </div>
      )}
    </div>
  );
}
