import { useState, useEffect, useMemo } from 'react';

// Client-side paging for the long lists in this application.
export const PAGE_SIZE = 20;

/** Slice a list into the current page, and keep the page number honest. */
export function usePager(items, size = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const list = Array.isArray(items) ? items : [];
  const pages = Math.max(1, Math.ceil(list.length / size));

  useEffect(() => { if (page > pages) setPage(pages); }, [pages, page]);

  const slice = useMemo(
    () => list.slice((page - 1) * size, (page - 1) * size + size),
    [list, page, size]
  );

  return {
    page, pages, setPage, slice,
    total: list.length,
    from: list.length ? (page - 1) * size + 1 : 0,
    to: Math.min(page * size, list.length),
    reset: () => setPage(1),
  };
}

/*
 * The control itself. Renders nothing at all for a single page, because a pager under a
 * four-row table is noise.
 */
export default function Pager({ page, pages, total, from, to, setPage, noun = 'rows' }) {
  if (pages <= 1) return null;

  // A window around the current page, so a hundred pages do not produce a hundred buttons.
  const window = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i < start + 5 && i <= pages; i += 1) window.push(i);

  const btn = (active) => ({
    minWidth: 32, padding: '5px 9px', fontSize: 12.5, fontWeight: active ? 700 : 500,
    borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
    background: active ? 'var(--primary)' : 'transparent',
    color: active ? 'var(--on-primary,#fff)' : 'var(--text-muted)',
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, flexWrap: 'wrap', padding: '12px 2px 2px',
    }}>
      <div style={{ fontSize: 12.5, color: 'var(--subtle)' }}>
        Showing {from}-{to} of {total} {noun}
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <button type="button" style={btn(false)} disabled={page === 1}
          onClick={() => setPage(page - 1)}>Prev</button>
        {start > 1 && <span style={{ color: 'var(--subtle)', fontSize: 12 }}>...</span>}
        {window.map((n) => (
          <button key={n} type="button" style={btn(n === page)} onClick={() => setPage(n)}>{n}</button>
        ))}
        {start + 5 <= pages && <span style={{ color: 'var(--subtle)', fontSize: 12 }}>...</span>}
        <button type="button" style={btn(false)} disabled={page === pages}
          onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
