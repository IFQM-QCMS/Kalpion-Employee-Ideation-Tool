import { useState, useMemo, useRef, useEffect } from 'react';

/*
 * Pick one organisation, by typing.
 *
 * A plain <select> lists every organisation at once. That is fine at five and
 * unusable at a thousand: the browser builds an option for each, the operator
 * scrolls a list they cannot search, and finding "Vertex Precision" means
 * knowing roughly where V falls among a thousand names. Nobody picks from a
 * list that long — they give up and guess.
 *
 * So this filters as you type, across both the name and the code, and shows a
 * bounded number of matches. The full set still arrives from the caller; the
 * cost that mattered was rendering it, not fetching it. If the platform ever
 * outgrows fetching them all, the same component takes a server-backed
 * `onSearch` without any caller changing.
 */
const MAX_SHOWN = 50;

export default function OrgPicker({
  orgs = [], value = '', onChange, placeholder = 'Search organizations…', disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const boxRef = useRef(null);

  const selected = useMemo(
    () => orgs.find((o) => String(o.id) === String(value)) || null,
    [orgs, value]
  );

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle
      ? orgs.filter((o) => `${o.name} ${o.slug}`.toLowerCase().includes(needle))
      : orgs;
    return pool.slice(0, MAX_SHOWN);
  }, [orgs, q]);

  // Clicking anywhere else closes the list. Without this the panel stays open
  // behind the rest of the dialog and swallows the next click.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const choose = (org) => {
    onChange?.(String(org.id));
    setQ('');
    setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        className="form-control"
        disabled={disabled}
        value={open ? q : (selected ? `${selected.name} (${selected.slug})` : '')}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); }
          // Enter picks the only remaining match, which is what typing a code
          // and pressing Enter is meant to do.
          if (e.key === 'Enter' && open && matches.length === 1) {
            e.preventDefault();
            choose(matches[0]);
          }
        }}
      />

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4,
          maxHeight: 260, overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-xl, 0 12px 32px rgba(0,0,0,.18))',
        }}>
          {!matches.length && (
            <div style={{ padding: '11px 13px', fontSize: 12.5, color: 'var(--subtle)' }}>
              No organization matches “{q}”.
            </div>
          )}
          {matches.map((o) => (
            <div
              key={o.id}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              style={{
                padding: '9px 13px', cursor: 'pointer', fontSize: 13,
                borderBottom: '1px solid var(--border)',
                background: String(o.id) === String(value) ? 'var(--primary-light)' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--heading)' }}>{o.name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--subtle)' }}>{o.slug}</div>
            </div>
          ))}
          {/* Say so when the list is cut, rather than letting somebody conclude
              their organisation is missing. */}
          {matches.length === MAX_SHOWN && (
            <div style={{ padding: '8px 13px', fontSize: 11.5, color: 'var(--subtle)' }}>
              Showing the first {MAX_SHOWN}. Keep typing to narrow it down.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
