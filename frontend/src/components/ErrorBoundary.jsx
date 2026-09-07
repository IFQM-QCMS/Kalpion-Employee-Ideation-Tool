import { Component } from 'react';

// A render crash must not become a blank white page.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Grouped so the stack and the component trace read together rather than as two unrelated
    // console entries.
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
            affected - nothing was saved or changed by this.
          </p>
          {/* The message is shown, not hidden behind a "details" toggle. */}
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
            {/* A way out that is not the page that just broke. */}
            <button className="btn btn-outline" onClick={() => { window.location.href = '/dashboard'; }}>
              Go to the dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
