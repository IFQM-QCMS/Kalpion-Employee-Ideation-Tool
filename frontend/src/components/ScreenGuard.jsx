import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { loadOrgSettings } from '../utils/orgSettings';

/*
  Screen guard — wraps every screen that puts idea text on display: All Ideas,
  the Review Queue, Rejected Ideas and the Idea Board.

  ── What it actually does ──────────────────────────────────────────────────
    • Blanks the idea content the moment the window loses focus or the tab is
      hidden. That is the part that bites: Snipping Tool, Win+Shift+S, macOS
      Cmd+Shift+4 and most capture utilities take focus away from the browser
      first, so what they capture is the covered screen, not the ideas.
    • Lays the reader's own name, employee number and the current time over the
      content, tiled, so anything that does get captured is attributable.
    • Suppresses right-click, text selection, copy, cut and drag inside the
      guarded area, and intercepts Ctrl/Cmd+C, +X, +S, +P and +U.
    • Blanks the content for printing and print-to-PDF.
    • Clears the clipboard after PrintScreen.

  ── What it cannot do ──────────────────────────────────────────────────────
  No web page can truly prevent a screenshot. A phone camera pointed at the
  monitor, a capture card, a screen recorder started before the page loaded, or
  a second machine mirroring the display are all outside anything a browser can
  reach. Treat this as a strong deterrent that makes casual capture awkward and
  any leak traceable — not as a guarantee.

  The real protection is that the server never sends idea text to people who are
  not entitled to read it. See redactSolution() in ideaService: that is
  enforcement. This is discouragement layered on top.

  On by default. An organisation can switch it off with the
  `idea_screen_protection` setting in the admin panel.
*/

export default function ScreenGuard({ children }) {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(true);   // guard first, relax later
  const [hidden, setHidden]   = useState(false);

  useEffect(() => {
    if (!user || user.role === 'platform_admin') { setEnabled(false); return; }
    let cancelled = false;
    loadOrgSettings().then((s) => {
      if (!cancelled) setEnabled(s.idea_screen_protection !== '0');
    });
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!enabled) { setHidden(false); return undefined; }

    const conceal = () => setHidden(true);
    const reveal  = () => setHidden(false);
    const onVisibility = () => setHidden(document.visibilityState !== 'visible');

    // Form fields are exempt. Blocking selection everywhere inside the guard
    // also blocked selecting text in the search box and the date pickers, which
    // made the filters unusable — and nobody leaks an idea by selecting their
    // own search term.
    const isFormField = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
    const inGuarded = (e) => e.target?.closest?.('[data-guard]') && !isFormField(e.target);
    const block = (e) => { if (inGuarded(e)) { e.preventDefault(); return false; } return true; };

    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      if (k === 'printscreen') {
        // The image is already taken by the time this fires — the operating
        // system does not ask the page. Blanking the screen and wiping the
        // clipboard is the whole of what is left to do.
        setHidden(true);
        navigator.clipboard?.writeText(' ').catch(() => {});
        setTimeout(() => setHidden(false), 1400);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['c', 'x', 's', 'p', 'u'].includes(k)
          && document.querySelector('[data-guard]') && !isFormField(e.target)) {
        e.preventDefault();
      }
    };

    window.addEventListener('blur', conceal);
    window.addEventListener('focus', reveal);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    document.addEventListener('dragstart', block);
    document.addEventListener('selectstart', block);
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeprint', conceal);
    window.addEventListener('afterprint', reveal);

    return () => {
      window.removeEventListener('blur', conceal);
      window.removeEventListener('focus', reveal);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
      document.removeEventListener('dragstart', block);
      document.removeEventListener('selectstart', block);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeprint', conceal);
      window.removeEventListener('afterprint', reveal);
    };
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  const stamp = [user?.name, user?.employee_id, new Date().toLocaleString('en-IN')]
    .filter(Boolean).join('  ·  ').replace(/"/g, '');

  return (
    <div data-guard className={hidden ? 'screen-guard is-concealed' : 'screen-guard'}>
      <style>{`
        .screen-guard{
          position:relative;
          -webkit-user-select:none; -moz-user-select:none; user-select:none;
          -webkit-touch-callout:none;
        }
        .screen-guard input, .screen-guard textarea, .screen-guard select{
          -webkit-user-select:text; -moz-user-select:text; user-select:text;
        }
        /* Tiled attribution across the whole area, faint enough to read through. */
        .screen-guard::before{
          content:""; position:absolute; inset:0; z-index:4; pointer-events:none;
          background-image:repeating-linear-gradient(
            -24deg, transparent 0 58px,
            color-mix(in srgb, var(--text) 4%, transparent) 58px 59px);
        }
        .screen-guard .guard-stamp{
          position:absolute; inset:0; z-index:5; pointer-events:none;
          display:flex; flex-wrap:wrap; align-content:space-around;
          justify-content:space-around; overflow:hidden;
        }
        .screen-guard .guard-stamp span{
          font-size:12px; font-weight:700; letter-spacing:.05em; white-space:nowrap;
          color:var(--text); opacity:.06; transform:rotate(-24deg);
        }
        /* The cover. Opaque, above everything on the page including overlays. */
        .screen-guard .guard-cover{
          position:fixed; inset:0; z-index:9000;
          display:none; align-items:center; justify-content:center;
          background:var(--bg, #fff); text-align:center; padding:24px;
        }
        .screen-guard.is-concealed .guard-cover{ display:flex }
        .screen-guard.is-concealed > *:not(.guard-cover){ visibility:hidden }
        .guard-cover-inner{ max-width:420px }
        .guard-cover-inner strong{ display:block; font-size:15px; margin-bottom:6px }
        .guard-cover-inner span{ font-size:13px; color:var(--text-muted) }
        /* Printing and print-to-PDF get the notice, never the ideas. */
        @media print{
          .screen-guard > *:not(.guard-cover){ visibility:hidden !important }
          .screen-guard .guard-cover{ display:flex !important; position:static }
        }
      `}</style>

      <div className="guard-stamp" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => <span key={i}>{stamp}</span>)}
      </div>

      <div className="guard-cover" aria-hidden={!hidden}>
        <div className="guard-cover-inner">
          <strong>Content hidden</strong>
          <span>
            Ideas on this page are confidential and are not shown while the window
            is out of focus, being printed or being captured. Return to this window
            to continue reading.
          </span>
        </div>
      </div>

      {children}
    </div>
  );
}
