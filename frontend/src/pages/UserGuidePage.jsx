import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { guideForRole } from '../content/userGuides';

/*
 * The user manual, in the app.
 *
 * The manual used to be a PDF behind a download button on three dashboards.
 * This replaces it: the same content, as a page, with the role decided from the
 * signed-in user so nobody has to pick which of the three manuals is theirs.
 */

/*
 * **bold** and nothing else.
 *
 * The manuals use exactly one kind of inline emphasis — the name of a button or
 * a screen — so that is the only thing supported. A general markdown renderer
 * would be a dependency and a sanitiser to worry about, for one asterisk pair.
 *
 * Split on the delimiter rather than replacing into HTML: this returns React
 * elements, so nothing here can ever inject markup, and dangerouslySetInnerHTML
 * never enters the picture.
 */
function RichText({ children }) {
  const parts = String(children ?? '').split(/\*\*/);
  return (
    <>
      {parts.map((part, i) => (
        i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
      ))}
    </>
  );
}

function Block({ block }) {
  if (block.p) {
    return <p style={{ margin:'0 0 12px', lineHeight:1.7 }}><RichText>{block.p}</RichText></p>;
  }

  if (block.note) {
    // The PDF's boxed asides. They are warnings and caveats — the things people
    // get wrong — so they keep a visual weight of their own here too.
    return (
      <div style={{
        margin:'0 0 14px', padding:'12px 14px',
        background:'var(--warning-light)', border:'1px solid var(--warning-dim)',
        borderLeft:'3px solid var(--warning)', borderRadius:'var(--r-sm)',
        fontSize:13, lineHeight:1.65, color:'var(--text)',
      }}>
        <RichText>{block.note}</RichText>
      </div>
    );
  }

  if (block.steps) {
    return (
      <ol style={{ margin:'0 0 14px', paddingLeft:22, lineHeight:1.7 }}>
        {block.steps.map((s, i) => (
          <li key={i} style={{ marginBottom:6 }}><RichText>{s}</RichText></li>
        ))}
      </ol>
    );
  }

  if (block.bullets) {
    return (
      <ul style={{ margin:'0 0 14px', paddingLeft:22, lineHeight:1.7 }}>
        {block.bullets.map((b, i) => (
          <li key={i} style={{ marginBottom:6 }}>
            {typeof b === 'string'
              ? <RichText>{b}</RichText>
              : <><strong>{b.term}</strong>{b.text ? <> — <RichText>{b.text}</RichText></> : null}</>}
          </li>
        ))}
      </ul>
    );
  }

  if (block.table) {
    return (
      <div className="card" style={{ overflowX:'auto', margin:'0 0 16px' }}>
        <table className="table">
          <thead>
            <tr>{block.table.head.map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} style={j === 0 ? { fontWeight:600, whiteSpace:'normal' } : undefined}>
                    <RichText>{cell}</RichText>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

export default function UserGuidePage() {
  const { user } = useAuth();
  const { t } = useLang();
  const [query, setQuery] = useState('');

  const guide = useMemo(() => guideForRole(user?.role), [user?.role]);

  /*
   * Search filters whole sections, not lines.
   *
   * A manual answers questions in paragraphs; showing the three matching
   * sentences with their surroundings removed is how you get an answer that
   * reads as complete and is not. So a section either matches and is shown
   * intact, or it is not shown.
   */
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guide.sections;

    const haystack = (block) => [
      block.p, block.note,
      ...(block.steps || []),
      ...(block.bullets || []).map((b) => (typeof b === 'string' ? b : `${b.term} ${b.text}`)),
      ...(block.table ? [...block.table.head, ...block.table.rows.flat()] : []),
    ].filter(Boolean).join(' ').toLowerCase();

    return guide.sections.filter((s) =>
      s.title.toLowerCase().includes(q) || s.blocks.some((b) => haystack(b).includes(q)));
  }, [guide, query]);

  return (
    <>
      <div className="card" style={{ marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:12, color:'var(--subtle)', fontWeight:600, letterSpacing:'.05em', textTransform:'uppercase' }}>
              {guide.subtitle}
            </div>
            <h2 style={{ margin:'4px 0 0', fontSize:20, color:'var(--heading)' }}>{guide.title}</h2>
          </div>
        </div>

        <input
          className="form-control"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('guide.search_ph')}
          style={{ marginTop:14, maxWidth:360 }}
        />
      </div>

      <div style={{ display:'flex', gap:20, alignItems:'flex-start' }}>
        {/*
          Contents. Hidden below 900px rather than stacked: on a phone it would
          push the manual itself a full screen down, and the search box above
          does the same job in less space.
        */}
        <nav className="guide-toc card" style={{ position:'sticky', top:16, width:230, flexShrink:0, fontSize:13 }}>
          <div style={{ fontWeight:700, marginBottom:8, color:'var(--heading)' }}>{t('guide.contents')}</div>
          {guide.sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                // Clear the filter first: jumping to a section that the current
                // search has hidden would otherwise scroll to nothing.
                setQuery('');
                requestAnimationFrame(() => {
                  document.getElementById(s.id)?.scrollIntoView({ behavior:'smooth', block:'start' });
                });
              }}
              style={{ display:'block', padding:'5px 0', color:'var(--text-muted)', textDecoration:'none', lineHeight:1.45 }}
            >
              {s.title}
            </a>
          ))}
        </nav>

        <div style={{ flex:1, minWidth:0 }}>
          {!sections.length && (
            <div className="card"><div className="empty-state">{t('guide.no_match', { query })}</div></div>
          )}

          {sections.map((s) => (
            <section key={s.id} id={s.id} style={{ marginBottom:20, scrollMarginTop:16 }}>
              <div className="card">
                <h3 style={{ margin:'0 0 12px', fontSize:16, color:'var(--heading)' }}>{s.title}</h3>
                {s.blocks.map((b, i) => <Block key={i} block={b} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
