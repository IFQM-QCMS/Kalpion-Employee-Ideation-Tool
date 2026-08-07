import { useState, useRef, useEffect, useId } from 'react';
import { useLang } from '../context/LangContext';

/**
 * The small "i" that explains a term.
 *
 * Most of this product's settings are named in the vocabulary of the people who
 * built it — SLA, escalation, threshold, engagement index, slug. An org admin at
 * a 40-person workshop is not obliged to know any of those, and a field whose
 * meaning has to be guessed gets set wrong or left alone. Neither is what the
 * number is for.
 *
 * Behaviour, and why:
 *   • opens on HOVER for a mouse user, so reading a form costs no clicks;
 *   • opens on CLICK/tap as well, because hover does not exist on a touch
 *     device — a hover-only tooltip is invisible to every phone user;
 *   • opens on FOCUS, so it is reachable by keyboard;
 *   • a `title` attribute would have done none of the above reliably, which is
 *     why this is a real element rather than a native tooltip.
 *
 * A click "pins" the bubble open until it is clicked again or focus leaves, so a
 * long explanation cannot vanish because the pointer drifted a few pixels.
 *
 * Usage:  <InfoDot term="sla_days" />          — text from the glossary
 *         <InfoDot text="Anything at all." />  — one-off text
 */
export default function InfoDot({ term, text, label }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Flip the bubble to the right edge when the dot sits near the viewport edge,
  // otherwise the explanation is clipped off screen exactly when it is needed.
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);
  const id = useId();

  const body = text || (term ? t(`info.${term}`) : '');

  // A glossary key that has not been written yet must render nothing rather
  // than an "i" that opens an empty box or, worse, prints the raw key.
  const missing = !body || body === `info.${term}`;

  useEffect(() => {
    if (!pinned) return undefined;
    const onDocClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) { setPinned(false); setOpen(false); }
    };
    const onEsc = (e) => { if (e.key === 'Escape') { setPinned(false); setOpen(false); } };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [pinned]);

  function reposition() {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setAlignRight(r.left + 270 > window.innerWidth);
  }

  if (missing) return null;

  return (
    <span
      ref={wrapRef}
      className="ifqm-infodot"
      onMouseEnter={() => { reposition(); setOpen(true); }}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
    >
      <style>{`
        .ifqm-infodot{position:relative;display:inline-flex;vertical-align:middle;margin-left:5px}
        .ifqm-infodot > button{
          width:15px;height:15px;flex:none;border-radius:50%;cursor:help;padding:0;line-height:1;
          border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text-muted);
          font-size:10px;font-weight:800;font-family:inherit;
          display:inline-flex;align-items:center;justify-content:center;
          transition:background .15s,color .15s,border-color .15s;
        }
        .ifqm-infodot > button:hover,
        .ifqm-infodot > button[aria-expanded="true"]{
          background:var(--primary);color:var(--on-primary);border-color:var(--primary);
        }
        .ifqm-infodot > button:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
        .ifqm-infodot .bubble{
          position:absolute;top:calc(100% + 7px);z-index:60;width:265px;
          background:var(--surface);border:1px solid var(--border);border-radius:10px;
          box-shadow:0 14px 34px -12px rgba(12,14,20,.42);padding:10px 12px;
          font-size:11.8px;line-height:1.55;color:var(--text);
          /* A bubble inherits from whatever label it sits in — which is usually
             bold, uppercase and letter-spaced. Reset all of it. */
          font-weight:400;text-transform:none;letter-spacing:0;text-align:left;white-space:normal;
          animation:ifqm-info-in .13s ease-out;
        }
        .ifqm-infodot .bubble.l{left:0}
        .ifqm-infodot .bubble.r{right:0}
        @keyframes ifqm-info-in{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){.ifqm-infodot .bubble{animation:none}}
        @media (max-width:520px){ .ifqm-infodot .bubble{width:min(265px,78vw)} }
      `}</style>

      <button
        type="button"
        aria-label={label || t('info.explain')}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          // Labels wrap their control: without this, clicking the "i" also
          // focuses (and for a checkbox, toggles) the field being explained.
          e.preventDefault();
          e.stopPropagation();
          reposition();
          setPinned((p) => !p);
          setOpen((o) => (pinned ? false : true) || !o);
        }}
        onFocus={() => { reposition(); setOpen(true); }}
        onBlur={() => { if (!pinned) setOpen(false); }}
      >
        i
      </button>

      {open && (
        <span id={id} role="tooltip" className={`bubble ${alignRight ? 'r' : 'l'}`}>
          {body}
        </span>
      )}
    </span>
  );
}
