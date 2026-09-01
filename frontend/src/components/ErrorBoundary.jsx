import { Component } from 'react';

/*
 * A render crash must not become a blank white page.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * React unmounts the entire tree when a render throws. Without a boundary the
 * user gets a white void: no message, no error, nothing to report back beyond
 * "the page went blank" — which is exactly how the admin screen was described
 * when an out-of-scope identifier crashed the user form. The bug took one line
 * to fix and was invisible from the outside, because a blank page looks
 * identical whatever caused it.
 *
 * The linter now catches that particular class before it ships. This is for
 * everything it cannot: a null field a component did not expect, a response
 * shaped differently by an older server, a browser API missing on somebody's
 * phone. Those will keep happening, and when they do the person in front of
 * the screen should be told something true and be given a way out.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * It does not phone home. There is no error-reporting service wired into this
 * product, and inventing one here would send whatever happened to be on screen
 * — an unpublished idea, an employee's details — to a third party nobody
 * agreed to. The message goes to the console, where a developer looking at a
 * reported problem will find it, and no further.
 *
 * It does not try to recover the failed subtree. A component that threw is in
 * an unknown state, and re-rendering it hoping for better is how you get a
 * loop. "Reload" is honest, and it works.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Grouped so the stack and the component trace read together rather than
    // as two unrelated console entries.
    console.error('[Kalpion] A screen failed to render.', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        <div className="card" style={{ maxWidth: 520, padding: '28px 30px', textAlign: 'left' }}>
          <div style={{
            fontSize: 18, fontWeight: 750, color: 'var(--heading)', marginBottom: 10,
          }}>
            This screen could not be displayed
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Something in the page failed while it was being drawn. Your work is not
            affected — nothing was saved or changed by this.
          </p>
          {/*
            The message is shown, not hidden behind a "details" toggle. It is
            usually the only thing that distinguishes one crash from another,
            and the person reporting it is the one who has to relay it.
          */}
          <p style={{
            fontSize: 12.5, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            background: 'var(--surface-2, rgba(127,127,127,.08))', borderRadius: 8,
            padding: '10px 12px', color: 'var(--text)', margin: '0 0 18px',
            wordBreak: 'break-word',
          }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload the page
            </button>
            {/*
              A way out that is not the page that just broke. Going "back" would
              often land on the same screen and break again.
            */}
            <button className="btn btn-outline" onClick={() => { window.location.href = '/dashboard'; }}>
              Go to the dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
