import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

/*
  Content protection — MOM 29 Jul 2026 §7.2.

  ── What this does ─────────────────────────────────────────────────────────
  When an organisation switches it on:
    • right-click, text selection, copy, cut and drag are suppressed on idea
      content;
    • Ctrl/Cmd+C, +X, +S, +P and PrintScreen are intercepted on those elements;
    • a faint diagonal watermark carrying the reader's own name, employee id and
      the date is laid over the idea text;
    • printing the page produces the watermark rather than clean text.

  ── What this does NOT do, and cannot ──────────────────────────────────────
  It does not stop a screenshot. Nothing running in a browser can: the operating
  system's own capture, a second device, or a phone camera pointed at the
  monitor are all outside the page's reach. Developer tools and "view source"
  read the text regardless.

  So this is a deterrent against casual copying, not a control. It is off by
  default, and the thing that actually protects an idea is the server never
  sending its text to people who are not entitled to it — see redactSolution in
  ideaService, which is enforcement rather than discouragement.

  The watermark is the part that earns its place: it does not prevent a
  screenshot, it makes one attributable. A leaked screenshot with somebody's
  name across it is traceable in a way that clean text is not.
*/

export default function ContentProtection({ enabled }) {
  const { user } = useAuth();

  /*
   * ── Right-click, off across the whole platform ─────────────────────────
   *
   * Separate from the opt-in protection below, and unconditional: the block
   * above applies only inside [data-protect] and only when an organisation has
   * switched it on, whereas this covers every screen for everybody signed in.
   *
   * Form fields are deliberately exempt. The context menu is how people paste -
   * an API key, a GSTIN, a long template - and taking it away from an input
   * does nothing for content protection while making the console painful to
   * operate. Nothing is being protected inside a box the user is typing into.
   *
   * Worth being straight about what this is: a deterrent against the casual
   * right-click-and-copy, not a control. The keyboard shortcut still copies,
   * developer tools still read the DOM, and no page can stop a screenshot or a
   * phone camera. What actually keeps an idea from the wrong reader is the
   * server not sending it - see redactSolution in ideaService.
   */
  useEffect(() => {
    const isEditable = (el) => !!el?.closest?.(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
    );
    const blockMenu = (e) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', blockMenu);
    return () => document.removeEventListener('contextmenu', blockMenu);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    const inProtected = (el) => el?.closest?.('[data-protect]');

    const block = (e) => { if (inProtected(e.target)) { e.preventDefault(); return false; } return true; };
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      const combo = (e.ctrlKey || e.metaKey) && ['c', 'x', 's', 'p', 'u'].includes(k);
      // PrintScreen cannot be prevented — the OS has already taken the image by
      // the time this fires. Clearing the clipboard afterwards is the most a
      // page can do, and even that only helps against the clipboard route.
      if (k === 'printscreen') {
        navigator.clipboard?.writeText('').catch(() => {});
        return;
      }
      if (combo && document.querySelector('[data-protect]')) e.preventDefault();
    };

    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    document.addEventListener('dragstart', block);
    document.addEventListener('selectstart', block);
    document.addEventListener('keydown', onKey);
    document.documentElement.setAttribute('data-content-protection', 'on');

    return () => {
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
      document.removeEventListener('dragstart', block);
      document.removeEventListener('selectstart', block);
      document.removeEventListener('keydown', onKey);
      document.documentElement.removeAttribute('data-content-protection');
    };
  }, [enabled]);

  if (!enabled) return null;

  const stamp = [user?.name, user?.employee_id, new Date().toLocaleDateString()]
    .filter(Boolean).join(' · ');

  return (
    <style>{`
      [data-content-protection="on"] [data-protect]{
        -webkit-user-select:none; -moz-user-select:none; user-select:none;
        -webkit-touch-callout:none;
        position:relative;
      }
      /* Attribution, not obstruction: it has to stay readable underneath. */
      [data-content-protection="on"] [data-protect]::after{
        content:"${stamp.replace(/"/g, '')}";
        position:absolute; inset:0; pointer-events:none; z-index:5;
        display:flex; align-items:center; justify-content:center;
        font-size:13px; font-weight:700; letter-spacing:.06em; white-space:nowrap;
        color:var(--text); opacity:.055; transform:rotate(-24deg);
        overflow:hidden;
      }
      /* A print or print-to-PDF carries the watermark at full strength. */
      @media print{
        [data-content-protection="on"] [data-protect]::after{ opacity:.20; font-size:16px }
      }
    `}</style>
  );
}
