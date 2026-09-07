import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

// Content protection - MOM 29 Jul 2026 §7.2.

export default function ContentProtection({ enabled }) {
  const { user } = useAuth();

  // Separate from the opt-in protection below, and unconditional: the block above applies
  // only inside [data-protect] and only when an organisation has switched it on, whereas
  // this covers every screen for everybody signed in.
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
      // PrintScreen cannot be prevented - the OS has already taken the image by the time this
      // fires.
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
