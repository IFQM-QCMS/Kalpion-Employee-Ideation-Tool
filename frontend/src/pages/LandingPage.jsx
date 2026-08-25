import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/*
  Public marketing page — the first thing an unauthenticated visitor sees at "/".
  Sign-in moved to /login so this page can do the selling.

  Audience: the owner or plant/ops head of an Indian MSME, who has 20–300 staff,
  no IT department, and a suggestion box nobody has opened in a year. Every
  section answers one of their four objections in order: "we already tried
  this", "my people won't use software", "what does it actually cost me", and
  "is my data safe". The claims are all things the product genuinely does —
  there are no invented customers, logos or statistics on this page, because a
  fake testimonial is the fastest way to lose a buyer who checks.

  Styling follows LoginPage: one scoped <style> block, existing CSS variables
  only, so the page inherits light/dark theming and needs no new dependency.
*/

/* ── Icons (inline so the page ships no icon dependency) ──────────────────── */
const Ico = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const IcoBulb   = () => <Ico d={<><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></>} />;
const IcoRoute  = () => <Ico d={<><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h5a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5"/></>} />;
const IcoTrophy = () => <Ico d={<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></>} />;
const IcoChart  = () => <Ico d={<><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></>} />;
const IcoGlobe  = () => <Ico d={<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></>} />;
const IcoShield = () => <Ico d={<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>} />;
const IcoSpark  = () => <Ico d={<><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></>} />;
const IcoUsers  = () => <Ico d={<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></>} />;
const IcoClip   = () => <Ico d={<><path d="M15 2H9a1 1 0 0 0-1 1v2h8V3a1 1 0 0 0-1-1z"/><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><path d="m9 14 2 2 4-4"/></>} />;
const IcoArrow  = () => <Ico d={<><path d="M5 12h14M13 6l6 6-6 6"/></>} size={18} />;

/* Fade sections in as they enter the viewport. Disabled outright when the
   visitor has asked for reduced motion — a marketing page is not a reason to
   ignore that. */
function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll('.rv');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // The hidden-until-revealed state is applied here rather than in the
    // stylesheet, so a visitor whose JS never runs (or an IntersectionObserver
    // that never fires) gets a fully visible page instead of a blank one.
    root.classList.add('reveal-on');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    nodes.forEach((n) => io.observe(n));
    return () => { io.disconnect(); root.classList.remove('reveal-on'); };
  }, [rootRef]);
}

const inr = (n) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));

/* Savings estimator.

   Deliberately built out of the visitor's OWN numbers, with every assumption
   named on screen. An MSME owner has been shown enough vendor ROI charts built
   on invented industry averages to distrust one more; letting them move the
   sliders and watch the arithmetic is both more persuasive and more honest. */
function Estimator() {
  const [staff, setStaff]   = useState(60);
  const [part,  setPart]    = useState(40);   // % of staff who submit at least one idea a year
  const [value, setValue]   = useState(15000); // ₹ saved by one implemented idea

  const IDEAS_PER_PARTICIPANT = 2;   // stated on screen, not hidden in the maths
  const IMPLEMENT_RATE = 0.25;

  const out = useMemo(() => {
    const contributors = staff * (part / 100);
    const ideas = contributors * IDEAS_PER_PARTICIPANT;
    const implemented = ideas * IMPLEMENT_RATE;
    return { ideas: Math.round(ideas), implemented: Math.round(implemented), saving: implemented * value };
  }, [staff, part, value]);

  return (
    <div className="calc">
      <div className="calc-in">
        <label>
          <span>People in your organisation<b>{staff}</b></span>
          <input type="range" min="10" max="500" step="5" value={staff}
            onChange={(e) => setStaff(+e.target.value)} />
        </label>
        <label>
          <span>Share who contribute at least one idea a year<b>{part}%</b></span>
          <input type="range" min="5" max="100" step="5" value={part}
            onChange={(e) => setPart(+e.target.value)} />
        </label>
        <label>
          <span>Value of one implemented idea<b>{inr(value)}</b></span>
          <input type="range" min="2000" max="200000" step="1000" value={value}
            onChange={(e) => setValue(+e.target.value)} />
        </label>
      </div>

      <div className="calc-out">
        <div className="co">
          <span className="co-n">{out.ideas}</span>
          <span className="co-l">ideas captured a year</span>
        </div>
        <div className="co">
          <span className="co-n">{out.implemented}</span>
          <span className="co-l">reach implementation</span>
        </div>
        <div className="co hero-n">
          <span className="co-n">{inr(out.saving)}</span>
          <span className="co-l">annual value, on your own numbers</span>
        </div>
        <p className="calc-note">
          Assumes each contributor raises {IDEAS_PER_PARTICIPANT} ideas a year and{' '}
          {Math.round(IMPLEMENT_RATE * 100)}% survive review. These are your inputs,
          not our claims — the platform's job is to make the first two numbers
          measurable instead of anecdotal.
        </p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef(null);
  useReveal(rootRef);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="ifqm-lp" ref={rootRef}>
      <style>{`
        /*
         * ── The marketing page wears IFQM's brand, not the product's theme ──
         *
         * This page is the front door, and it sits next to ifqm.org.in in a
         * visitor's mind — the same organisation, reached two ways. It looked
         * like neither: it inherited the APP's palette, which is a light
         * working surface designed to be stared at for eight hours, and next to
         * the corporate site it read as an unrelated product.
         *
         * Every rule below this block already draws its colour from a token, so
         * the whole page is restyled by redefining the tokens for .ifqm-lp
         * alone. Nothing outside this component changes, and none of the 600
         * lines of layout underneath had to be touched to do it.
         *
         * ── Why it does not follow dark mode ───────────────────────────────
         *
         * The tokens are set unconditionally, so this page is navy in both
         * themes. That is deliberate: a brand does not have a light variant,
         * and the signed-in app on the other side of the Sign In button still
         * honours the visitor's preference completely. Only the front door is
         * fixed, the way the corporate site is fixed.
         */
        .ifqm-lp{
          min-height:100vh;overflow-x:hidden;
          font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
          --lp-max:1120px;

          /* Ground. The gradient is what stops a large flat navy reading as a
             blank browser window on a big monitor. */
          --bg:#0b2545;
          --panel-bg:#0e2c53;
          --surface:#12325c;
          --surface-3:#1d4173;

          /* Type. Pure white for headings and a desaturated blue for body: on a
             navy this dark, white body text at 17px vibrates, and pulling it
             down to #c5d3e4 costs nothing legible and settles the page. */
          --heading:#ffffff;
          --text:#dbe5f1;
          --subtext:#c5d3e4;
          --text-muted:#9db1cb;
          --subtle:#7f95b3;

          /* Edges, at low contrast — a navy panel on a navy ground needs a
             seam, not a frame. */
          --border:rgba(255,255,255,.13);
          --border-strong:rgba(255,255,255,.26);

          /* The accent is IFQM's gold, and it is the ONLY warm thing here, so
             it takes the eye wherever it is put. Which means it is put only on
             the thing the page is asking the visitor to do. */
          --primary:#c9a961;
          --primary-light:rgba(201,169,97,.14);
          --primary-dim:rgba(201,169,97,.38);
          --primary-glow:rgba(201,169,97,.34);
          /* Dark ink on gold. Gold is a light colour: white text on it fails
             contrast badly, and it is the most-clicked element on the page. */
          --on-primary:#0b2545;

          --topbar-bg:rgba(9,31,58,.86);
          --topbar-border:rgba(255,255,255,.10);

          /* Status colours lifted for a dark ground. The originals are chosen
             against white and go muddy here. */
          --info:#6ba7e8;
          --success:#5fcf94;
          --warning:#e8b563;
          --danger:#f08a86;

          background:
            radial-gradient(1200px 620px at 72% -10%,#164079 0%,transparent 62%),
            linear-gradient(180deg,#0b2545 0%,#0a2140 58%,#081c37 100%);
          background-attachment:fixed;
          color:var(--text);
        }

        .ifqm-lp *{box-sizing:border-box}
        .ifqm-lp section{position:relative}
        .ifqm-lp .wrap{max-width:var(--lp-max);margin:0 auto;padding:0 22px}
        .ifqm-lp h1,.ifqm-lp h2,.ifqm-lp h3{color:var(--heading);letter-spacing:-.025em;margin:0}
        .ifqm-lp p{margin:0}
        .ifqm-lp a{text-decoration:none;color:inherit}

        /* ── reveal ───────────────────────────────────────────────────────── */
        .ifqm-lp .rv{transition:opacity .6s cubic-bezier(.16,.84,.44,1),transform .6s cubic-bezier(.16,.84,.44,1)}
        .ifqm-lp.reveal-on .rv{opacity:0;transform:translateY(18px)}
        .ifqm-lp.reveal-on .rv.in{opacity:1;transform:none}
        @media (prefers-reduced-motion:reduce){.ifqm-lp .rv{transition:none}}
        @media print{.ifqm-lp.reveal-on .rv{opacity:1;transform:none}}

        /* ── nav ──────────────────────────────────────────────────────────── */
        .ifqm-lp .nav{position:sticky;top:0;z-index:40;transition:background .2s,border-color .2s,backdrop-filter .2s;
          border-bottom:1px solid transparent}
        .ifqm-lp .nav.on{background:var(--topbar-bg);backdrop-filter:blur(12px);border-bottom-color:var(--topbar-border)}
        .ifqm-lp .nav-in{max-width:var(--lp-max);margin:0 auto;padding:12px 22px;display:flex;align-items:center;gap:26px}
        .ifqm-lp .logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;color:var(--heading)}
        .ifqm-lp .logo img{height:34px;background:#fff;border-radius:9px;padding:5px 8px;object-fit:contain;
          box-shadow:0 6px 18px rgba(79,70,229,.16)}
        .ifqm-lp .logo small{display:block;font-size:10.5px;font-weight:500;color:var(--text-muted);letter-spacing:0}
        .ifqm-lp .nav-links{display:flex;gap:22px;margin-left:auto;font-size:13.5px;color:var(--text-muted);font-weight:500}
        .ifqm-lp .nav-links a:hover{color:var(--text)}
        .ifqm-lp .nav-cta{display:flex;align-items:center;gap:10px}

        /* ── buttons ──────────────────────────────────────────────────────── */
        .ifqm-lp .btn-lp{display:inline-flex;align-items:center;justify-content:center;gap:8px;
          border-radius:11px;font-weight:650;font-size:14px;cursor:pointer;border:1px solid transparent;
          padding:11px 18px;transition:filter .16s,transform .16s,box-shadow .16s,background .16s,border-color .16s;white-space:nowrap}
        .ifqm-lp .btn-lp:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
        .ifqm-lp .b-primary{background:var(--primary);color:var(--on-primary)}
        .ifqm-lp .b-primary:hover{filter:brightness(1.06);transform:translateY(-1px);box-shadow:0 12px 26px -8px var(--primary-glow)}
        .ifqm-lp .b-ghost{background:var(--surface);color:var(--text);border-color:var(--border)}
        .ifqm-lp .b-ghost:hover{border-color:var(--border-strong);transform:translateY(-1px)}
        .ifqm-lp .b-sm{padding:8px 14px;font-size:13px;border-radius:10px}
        .ifqm-lp .b-lg{padding:14px 24px;font-size:15px;border-radius:12px}

        /* ── hero ─────────────────────────────────────────────────────────── */
        .ifqm-lp .hero{padding:74px 0 64px}
        .ifqm-lp .glow{position:absolute;pointer-events:none;z-index:0;filter:blur(12px)}
        .ifqm-lp .glow-a{top:-260px;left:58%;width:760px;height:900px;transform:translateX(-50%) rotate(-38deg);
          background:radial-gradient(50% 50% at 50% 50%,rgba(99,102,241,.13),transparent 78%)}
        .ifqm-lp .glow-b{top:-160px;left:20%;width:420px;height:820px;transform:translateX(-50%) rotate(-38deg);
          background:radial-gradient(50% 50% at 50% 50%,rgba(168,85,247,.10),transparent 78%)}
        .ifqm-lp .hero-grid{position:relative;z-index:1;display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
        .ifqm-lp .pill{display:inline-flex;align-items:center;gap:8px;background:var(--primary-light);color:var(--primary);
          border:1px solid var(--primary-dim);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:650}
        .ifqm-lp .pill .dot{width:6px;height:6px;border-radius:50%;background:var(--primary)}
        .ifqm-lp h1{font-size:clamp(34px,4.6vw,53px);line-height:1.06;margin:20px 0 0;font-weight:820}
        .ifqm-lp h1 .em{background:linear-gradient(96deg,var(--primary),#a855f7);-webkit-background-clip:text;
          background-clip:text;color:transparent}
        .ifqm-lp .lede{font-size:17px;line-height:1.62;color:var(--subtext);margin-top:18px;max-width:37em}
        .ifqm-lp .hero-cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
        .ifqm-lp .hero-note{margin-top:16px;font-size:12.5px;color:var(--text-muted)}
        .ifqm-lp .ticks{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:26px;font-size:13px;color:var(--subtext)}
        .ifqm-lp .ticks span{display:inline-flex;align-items:center;gap:7px}
        .ifqm-lp .ticks svg{color:var(--success)}

        /* ── hero pipeline mock ───────────────────────────────────────────── */
        .ifqm-lp .mock{background:var(--surface);border:1px solid var(--border);border-radius:18px;
          box-shadow:0 26px 60px -30px rgba(12,14,20,.32);padding:16px;position:relative;overflow:hidden}
        .ifqm-lp .mock-bar{display:flex;align-items:center;gap:6px;padding:0 2px 13px}
        .ifqm-lp .mock-bar i{width:9px;height:9px;border-radius:50%;background:var(--surface-3);display:block}
        .ifqm-lp .mock-bar span{margin-left:8px;font-size:11.5px;color:var(--subtle);font-weight:600}
        .ifqm-lp .lanes{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
        .ifqm-lp .lane{background:var(--panel-bg);border:1px solid var(--border);border-radius:13px;padding:10px;min-height:186px}
        .ifqm-lp .lane h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);
          margin:0 0 9px;font-weight:750;display:flex;align-items:center;gap:6px}
        .ifqm-lp .lane h4 i{width:6px;height:6px;border-radius:50%;display:block}
        .ifqm-lp .l1 i{background:var(--info)} .ifqm-lp .l2 i{background:var(--warning)} .ifqm-lp .l3 i{background:var(--success)}
        .ifqm-lp .card-m{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:9px 10px;
          margin-bottom:8px;box-shadow:0 2px 6px -3px rgba(12,14,20,.16)}
        .ifqm-lp .card-m b{display:block;font-size:11.5px;color:var(--heading);font-weight:650;line-height:1.35}
        .ifqm-lp .card-m u{display:block;text-decoration:none;font-size:10px;color:var(--subtle);margin-top:5px}
        .ifqm-lp .score{display:inline-flex;align-items:center;gap:5px;margin-top:7px;font-size:9.5px;font-weight:700;
          background:var(--primary-light);color:var(--primary);border-radius:999px;padding:2px 7px}
        /* one card walks the pipeline, on a loop — it shows the product's core
           promise (idea → review → done) without a video or a screenshot that
           would go stale */
        .ifqm-lp .travel{animation:lp-travel 9s ease-in-out infinite}
        @keyframes lp-travel{
          0%,26%{transform:translate(0,0);opacity:1}
          33%,59%{transform:translate(calc(100% + 10px),0)}
          66%,92%{transform:translate(calc(200% + 20px),0)}
          97%,100%{transform:translate(calc(200% + 20px),0);opacity:0}
        }
        @media (prefers-reduced-motion:reduce){.ifqm-lp .travel{animation:none}}

        /* ── generic section furniture ────────────────────────────────────── */
        .ifqm-lp .sec{padding:72px 0}
        .ifqm-lp .sec.alt{background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
        .ifqm-lp .kicker{font-size:12px;font-weight:750;letter-spacing:.1em;text-transform:uppercase;color:var(--primary)}
        .ifqm-lp h2{font-size:clamp(25px,3vw,35px);line-height:1.16;margin-top:11px;font-weight:800}
        .ifqm-lp .sec-sub{font-size:15.5px;color:var(--text-muted);margin-top:13px;max-width:60ch;line-height:1.62}
        .ifqm-lp .head-c{text-align:center}
        .ifqm-lp .head-c .sec-sub{margin-left:auto;margin-right:auto}

        /* ── problem cards ────────────────────────────────────────────────── */
        .ifqm-lp .grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(258px,1fr));gap:18px;margin-top:38px}
        .ifqm-lp .prob{background:var(--surface);border:1px solid var(--border);border-radius:15px;padding:22px}
        .ifqm-lp .sec.alt .prob{background:var(--panel-bg)}
        .ifqm-lp .prob .x{font-size:12px;font-weight:750;color:var(--danger);letter-spacing:.02em}
        .ifqm-lp .prob h3{font-size:16.5px;margin:9px 0 8px;font-weight:720}
        .ifqm-lp .prob p{font-size:13.8px;color:var(--text-muted);line-height:1.6}
        .ifqm-lp .prob .fix{margin-top:13px;padding-top:13px;border-top:1px dashed var(--border);
          font-size:13.3px;color:var(--subtext);display:flex;gap:8px}
        .ifqm-lp .prob .fix b{color:var(--success);font-weight:700;flex:none}

        /* ── steps ────────────────────────────────────────────────────────── */
        .ifqm-lp .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(212px,1fr));gap:16px;margin-top:40px;counter-reset:s}
        .ifqm-lp .step{position:relative;padding:22px 18px;background:var(--surface);border:1px solid var(--border);border-radius:15px}
        .ifqm-lp .sec.alt .step{background:var(--panel-bg)}
        .ifqm-lp .step .n{width:31px;height:31px;border-radius:9px;background:var(--primary-light);color:var(--primary);
          display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
        .ifqm-lp .step h3{font-size:15.5px;margin:13px 0 7px;font-weight:720}
        .ifqm-lp .step p{font-size:13.4px;color:var(--text-muted);line-height:1.58}

        /* ── features ─────────────────────────────────────────────────────── */
        .ifqm-lp .feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:16px;margin-top:40px}
        .ifqm-lp .feat{background:var(--surface);border:1px solid var(--border);border-radius:15px;padding:22px;
          transition:transform .18s,box-shadow .18s,border-color .18s}
        .ifqm-lp .feat:hover{transform:translateY(-3px);border-color:var(--border-strong);box-shadow:0 18px 38px -24px rgba(12,14,20,.4)}
        .ifqm-lp .sec.alt .feat{background:var(--panel-bg)}
        .ifqm-lp .feat .ic{width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;
          background:var(--primary-light);color:var(--primary)}
        .ifqm-lp .feat h3{font-size:15.5px;margin:14px 0 7px;font-weight:720}
        .ifqm-lp .feat p{font-size:13.4px;color:var(--text-muted);line-height:1.6}

        /* ── estimator ────────────────────────────────────────────────────── */
        .ifqm-lp .calc{display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-top:38px;background:var(--surface);
          border:1px solid var(--border);border-radius:18px;padding:26px;box-shadow:0 22px 50px -34px rgba(12,14,20,.34)}
        .ifqm-lp .sec.alt .calc{background:var(--panel-bg)}
        .ifqm-lp .calc-in{display:flex;flex-direction:column;gap:22px;justify-content:center}
        .ifqm-lp .calc-in label{display:block}
        .ifqm-lp .calc-in span{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
          font-size:13.4px;color:var(--subtext);margin-bottom:10px}
        .ifqm-lp .calc-in b{font-size:15px;font-weight:750;color:var(--heading);font-variant-numeric:tabular-nums}
        .ifqm-lp .calc-in input[type=range]{width:100%;accent-color:var(--primary);cursor:pointer}
        .ifqm-lp .calc-out{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start}
        .ifqm-lp .co{background:var(--panel-bg);border:1px solid var(--border);border-radius:13px;padding:16px}
        .ifqm-lp .sec.alt .co{background:var(--surface)}
        .ifqm-lp .co-n{display:block;font-size:26px;font-weight:820;color:var(--heading);font-variant-numeric:tabular-nums;letter-spacing:-.03em}
        .ifqm-lp .co-l{display:block;font-size:12px;color:var(--text-muted);margin-top:5px;line-height:1.45}
        .ifqm-lp .hero-n{grid-column:1/-1;background:var(--primary-light);border-color:var(--primary-dim)}
        .ifqm-lp .hero-n .co-n{color:var(--primary);font-size:32px}
        .ifqm-lp .calc-note{grid-column:1/-1;font-size:11.8px;color:var(--subtle);line-height:1.55}

        /* ── security strip ───────────────────────────────────────────────── */
        .ifqm-lp .sec-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-top:32px}
        .ifqm-lp .sl{display:flex;gap:11px;font-size:13.5px;color:var(--subtext);line-height:1.55}
        .ifqm-lp .sl svg{color:var(--primary);flex:none;margin-top:2px}
        .ifqm-lp .sl b{display:block;color:var(--heading);font-weight:700;font-size:13.8px;margin-bottom:3px}

        /* ── faq ──────────────────────────────────────────────────────────── */
        .ifqm-lp .faq{margin-top:34px;display:flex;flex-direction:column;gap:10px;max-width:790px}
        .ifqm-lp details{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:0 18px}
        .ifqm-lp .sec.alt details{background:var(--panel-bg)}
        .ifqm-lp summary{cursor:pointer;list-style:none;padding:16px 0;font-size:14.6px;font-weight:650;color:var(--heading);
          display:flex;justify-content:space-between;align-items:center;gap:16px}
        .ifqm-lp summary::-webkit-details-marker{display:none}
        .ifqm-lp summary::after{content:'+';font-size:20px;font-weight:400;color:var(--text-muted);flex:none;line-height:1}
        .ifqm-lp details[open] summary::after{content:'−'}
        .ifqm-lp details p{padding:0 0 17px;font-size:13.8px;color:var(--text-muted);line-height:1.68;max-width:70ch}

        /* ── final cta ────────────────────────────────────────────────────── */
        .ifqm-lp .cta{background:linear-gradient(135deg,var(--primary),#7c3aed);border-radius:22px;padding:52px 40px;
          text-align:center;position:relative;overflow:hidden}
        .ifqm-lp .cta h2{color:#fff;max-width:19ch;margin:0 auto}
        .ifqm-lp .cta p{color:rgba(255,255,255,.9);font-size:15.5px;margin:15px auto 0;max-width:56ch;line-height:1.6}
        .ifqm-lp .cta .row{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:28px}
        .ifqm-lp .cta .b-white{background:#fff;color:var(--primary)}
        .ifqm-lp .cta .b-white:hover{filter:brightness(.97);transform:translateY(-1px)}
        .ifqm-lp .cta .b-line{background:transparent;color:#fff;border-color:rgba(255,255,255,.5)}
        .ifqm-lp .cta .b-line:hover{background:rgba(255,255,255,.12)}
        .ifqm-lp .cta small{display:block;margin-top:18px;color:rgba(255,255,255,.78);font-size:12.5px}

        /* ── footer ───────────────────────────────────────────────────────── */
        .ifqm-lp footer{border-top:1px solid var(--border);margin-top:72px;padding:30px 0 40px}
        .ifqm-lp .foot{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;
          font-size:12.5px;color:var(--subtle)}
        .ifqm-lp .foot a:hover{color:var(--text)}

        /* ── responsive ───────────────────────────────────────────────────── */
        @media (max-width:900px){
          .ifqm-lp .hero-grid{grid-template-columns:1fr;gap:40px}
          .ifqm-lp .calc{grid-template-columns:1fr;padding:20px}
          .ifqm-lp .nav-links{display:none}
        }
        @media (max-width:560px){
          .ifqm-lp .hero{padding:48px 0 44px}
          .ifqm-lp .sec{padding:54px 0}
          .ifqm-lp .cta{padding:38px 22px}
          .ifqm-lp .logo small{display:none}
          .ifqm-lp .calc-out{grid-template-columns:1fr}
        }

        /* ── Brand overrides ───────────────────────────────────────────────
           These come LAST on purpose. The token block at the top of this sheet
           works from anywhere, because a custom property is resolved where it
           is used. These are ordinary declarations competing with rules of the
           same specificity further up, so the only thing that decides them is
           document order. Put them next to the tokens and they lose. */
        /*
         * Sizes, matched to the corporate site.
         *
         * Its hero runs considerably larger than this page's did, and on a dark
         * ground that is not decoration: light type on dark carries less
         * apparent weight, so the same size reads smaller and thinner than it
         * does on white. The headline and lede both go up a step to compensate.
         */
        .ifqm-lp h1{font-size:clamp(38px,5.4vw,62px);line-height:1.08;font-weight:750;letter-spacing:-.02em}
        .ifqm-lp .lede{font-size:18.5px;line-height:1.66}
        .ifqm-lp .nav-links{font-size:14.5px}
        .ifqm-lp h2{font-size:clamp(26px,3.2vw,38px);font-weight:720}

        /*
         * The headline's gradient span.
         *
         * It was indigo-to-purple, which on navy is nearly invisible — two dark
         * blues on a dark blue. Gold against white type is the contrast the
         * corporate site uses, so it is what the emphasis uses here.
         */
        .ifqm-lp h1 .em{
          background:linear-gradient(96deg,#e0c383,#c9a961);
          -webkit-background-clip:text;background-clip:text;color:transparent;
        }

        /* The two indigo glows behind the hero were tuned for a white page and
           are invisible on navy. Warmed and lifted so they read as light. */
        .ifqm-lp .glow-a{background:radial-gradient(50% 50% at 50% 50%,rgba(201,169,97,.16),transparent 78%)}
        .ifqm-lp .glow-b{background:radial-gradient(50% 50% at 50% 50%,rgba(90,140,210,.20),transparent 78%)}

        /* The secondary button was a light surface with light text — invisible
           on both counts once the surface went dark. Outlined instead. */
        .ifqm-lp .b-ghost{background:rgba(255,255,255,.06);color:var(--heading);border-color:var(--border-strong)}
        .ifqm-lp .b-ghost:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.4)}

        /* The logo keeps its white plate: the mark is navy-and-magenta and
           disappears against this background without one. */
        .ifqm-lp .logo img{box-shadow:0 6px 20px rgba(0,0,0,.35)}

        /*
         * The closing call-to-action band.
         *
         * It was a white-on-indigo panel: an indigo-to-purple gradient, white
         * heading, and a white button with --primary text. Swapping --primary
         * to gold broke all three at once — the gradient ran gold into purple,
         * the white heading sat on gold at roughly 1.9:1, and the white button
         * had gold text on it at about the same. Contrast that low is not a
         * matter of taste; it is unreadable in daylight on a phone, which is
         * where this button gets pressed.
         *
         * So the band becomes what it should be on this palette: a deeper navy
         * panel, edged in gold, with the gold saved for the one button that
         * matters. White type stays — it was always right, just on the wrong
         * ground.
         */
        .ifqm-lp .cta{
          background:linear-gradient(135deg,#0e2c53 0%,#164079 100%);
          border:1px solid var(--primary-dim);
          box-shadow:0 24px 60px -30px rgba(0,0,0,.7);
        }
        .ifqm-lp .cta h2{color:#fff}
        .ifqm-lp .cta p{color:rgba(255,255,255,.86)}
        /* The one gold thing in the band, so it is the thing you see. */
        .ifqm-lp .cta .b-white{background:var(--primary);color:var(--on-primary)}
        .ifqm-lp .cta .b-white:hover{filter:brightness(1.07)}
        .ifqm-lp .cta .b-line{color:#fff;border-color:rgba(255,255,255,.45)}
        .ifqm-lp .cta small{color:rgba(255,255,255,.74)}
      `}</style>

      {/* ── NAV ──────────────────────────────────────────────────────────── */}
      <nav className={`nav${scrolled ? ' on' : ''}`}>
        <div className="nav-in">
          <Link to="/" className="logo">
            <img src="/assets/ifqm-logo.png" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
            <span>IFQM<small>Employee Ideation Tool</small></span>
          </Link>
          <div className="nav-links">
            <a href="#problem">Why</a>
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#value">Value</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="nav-cta">
            <Link to="/login" className="btn-lp b-ghost b-sm">Sign in</Link>
            <Link to="/signup" className="btn-lp b-primary b-sm">Get started</Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="glow glow-a" aria-hidden="true" />
        <div className="glow glow-b" aria-hidden="true" />
        <div className="wrap hero-grid">
          <div className="rv in">
            <span className="pill"><i className="dot" />Built for Indian MSMEs</span>
            <h1>The best ideas in your business are already <span className="em">inside your team</span>.</h1>
            <p className="lede">
              Your machine operator knows which changeover wastes an hour. Your billing
              clerk knows which step is done twice. IFQM gives them one place to say so —
              and gives you a scored, routed, tracked pipeline instead of a dusty
              suggestion box.
            </p>
            <div className="hero-cta">
              <Link to="/signup" className="btn-lp b-primary b-lg">Start free <IcoArrow /></Link>
              <Link to="/login" className="btn-lp b-ghost b-lg">Sign in to your workspace</Link>
            </div>
            <div className="ticks">
              <span><Ico size={15} d={<path d="m5 12 5 5L20 7" />} /> No IT team needed</span>
              <span><Ico size={15} d={<path d="m5 12 5 5L20 7" />} /> Works on any phone</span>
              <span><Ico size={15} d={<path d="m5 12 5 5L20 7" />} /> 7 Indian languages</span>
            </div>
            <p className="hero-note">Free while in preview — no card, no commitment.</p>
          </div>

          <div className="rv in mock" aria-hidden="true">
            <div className="mock-bar"><i /><i /><i /><span>Idea pipeline — live</span></div>
            <div className="lanes">
              <div className="lane l1">
                <h4><i />Submitted</h4>
                <div className="card-m travel">
                  <b>Cut die-change time with a pre-staged trolley</b>
                  <span className="score"><IcoSpark />Score 82</span>
                  <u>Ravi · Production</u>
                </div>
                <div className="card-m"><b>Reuse packing cartons for internal transfers</b><u>Sunita · Stores</u></div>
              </div>
              <div className="lane l2">
                <h4><i />In review</h4>
                <div className="card-m"><b>Second QR scan point at dispatch</b><u>Supervisor · 2 of 3 approvals</u></div>
              </div>
              <div className="lane l3">
                <h4><i />Implemented</h4>
                <div className="card-m"><b>Shift-handover checklist on the floor</b><u>Saved 40 min/day</u></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROBLEM ──────────────────────────────────────────────────────── */}
      <section className="sec alt" id="problem">
        <div className="wrap">
          <div className="head-c rv">
            <span className="kicker">Why suggestion boxes die</span>
            <h2>You didn't have an idea problem. You had a follow-up problem.</h2>
            <p className="sec-sub">
              Most MSMEs have already tried this once — a box on the wall, a WhatsApp
              group, a form nobody filled twice. They fail for the same three reasons,
              and each one is a workflow gap, not a motivation gap.
            </p>
          </div>
          <div className="grid3">
            <div className="prob rv">
              <span className="x">The silence problem</span>
              <h3>Nobody hears back</h3>
              <p>
                An idea goes in and nothing visible happens. After two of those, the
                most useful person on your floor stops bothering.
              </p>
              <p className="fix"><b>Fixed</b> Every idea has a status the submitter can see, with the reviewer and the clock on it.</p>
            </div>
            <div className="prob rv">
              <span className="x">The pile problem</span>
              <h3>Everything lands on one desk</h3>
              <p>
                Fifty suggestions arrive at the owner's desk unsorted — half duplicates,
                half impossible — so none get read properly.
              </p>
              <p className="fix"><b>Fixed</b> Ideas are scored on six dimensions, deduplicated on entry, and routed to whoever should actually decide.</p>
            </div>
            <div className="prob rv">
              <span className="x">The proof problem</span>
              <h3>No one can show it worked</h3>
              <p>
                Improvements happen, but nothing links them back to the person who
                suggested it — so the programme feels like goodwill, not a result.
              </p>
              <p className="fix"><b>Fixed</b> Implementation and savings are tracked per idea, with an audit trail and exportable reports.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="sec" id="how">
        <div className="wrap">
          <div className="head-c rv">
            <span className="kicker">How it works</span>
            <h2>Four steps, and only one of them is yours</h2>
            <p className="sec-sub">
              The point is that ideas keep moving without anyone chasing them. You set
              the rules once; the platform runs the loop.
            </p>
          </div>
          <div className="steps">
            <div className="step rv"><div className="n">1</div><h3>Your team submits</h3>
              <p>A guided wizard turns a rough thought into a real proposal: the situation, the fix, the business case, photos. In their own language, from their own phone.</p></div>
            <div className="step rv"><div className="n">2</div><h3>The platform scores</h3>
              <p>Each idea gets a 0–100 quality score across six dimensions and a duplicate check, so the good ones surface instead of drowning.</p></div>
            <div className="step rv"><div className="n">3</div><h3>The right person reviews</h3>
              <p>Ideas escalate up your hierarchy or go to a review committee with your own approval threshold. Overdue reviews are flagged, not forgotten.</p></div>
            <div className="step rv"><div className="n">4</div><h3>Results come back</h3>
              <p>Approved ideas get owners and implementation tracking; contributors get points and a place on the leaderboard. Everyone sees the loop close.</p></div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="sec alt" id="features">
        <div className="wrap">
          <div className="head-c rv">
            <span className="kicker">What you get</span>
            <h2>Everything the programme needs, nothing you have to maintain</h2>
            <p className="sec-sub">
              One workspace for your organisation — your logo, your categories, your
              approval rules, your data in its own database.
            </p>
          </div>
          <div className="feats">
            <div className="feat rv"><div className="ic"><IcoBulb /></div><h3>Guided idea capture</h3>
              <p>Multi-step submission with attachments, co-suggesters and live duplicate detection — so proposals arrive complete the first time.</p></div>
            <div className="feat rv"><div className="ic"><IcoSpark /></div><h3>Automatic quality scoring</h3>
              <p>Every idea rated 0–100 on six dimensions. Works out of the box with a built-in scorer; plug in OpenAI or Gemini if you want more.</p></div>
            <div className="feat rv"><div className="ic"><IcoRoute /></div><h3>Approval workflow you configure</h3>
              <p>Hierarchy escalation or a review committee, your own stages and thresholds, SLA timers on every pending decision.</p></div>
            <div className="feat rv"><div className="ic"><IcoTrophy /></div><h3>Points, leaderboards, challenges</h3>
              <p>10 points to submit, 25 when approved, 65 when implemented. Run themed challenges when you need ideas on one specific problem.</p></div>
            <div className="feat rv"><div className="ic"><IcoGlobe /></div><h3>Seven Indian languages</h3>
              <p>English, हिन्दी, मराठी, ಕನ್ನಡ, తెలుగు, தமிழ் and മലയാളം — because your shop floor and your office rarely share one language.</p></div>
            <div className="feat rv"><div className="ic"><IcoChart /></div><h3>Analytics and ROI tracking</h3>
              <p>Participation by department, pipeline health, implementation value, and an append-only audit log. Export to Excel or PDF for your review meeting.</p></div>
            <div className="feat rv"><div className="ic"><IcoUsers /></div><h3>Onboard the whole team at once</h3>
              <p>Bulk-import staff from a spreadsheet, assign roles, and let people sign in with the email or phone number they already use.</p></div>
            <div className="feat rv"><div className="ic"><IcoClip /></div><h3>Push approved ideas onward</h3>
              <p>An integration API hands approved ideas to your quality or CAPA system, so an accepted idea becomes a tracked action item.</p></div>
            <div className="feat rv"><div className="ic"><IcoShield /></div><h3>Your data, isolated</h3>
              <p>Each organisation gets its own database, its own branding and its own admin. Even platform operators see aggregate counts, never your idea content.</p></div>
          </div>
        </div>
      </section>

      {/* ── VALUE / ESTIMATOR ────────────────────────────────────────────── */}
      <section className="sec" id="value">
        <div className="wrap">
          <div className="head-c rv">
            <span className="kicker">The business case</span>
            <h2>What is one unheard idea a month costing you?</h2>
            <p className="sec-sub">
              Move the sliders to your own numbers. No industry averages, no borrowed
              case studies — just the arithmetic you would do on paper anyway.
            </p>
          </div>
          <div className="rv"><Estimator /></div>
        </div>
      </section>

      {/* ── TRUST ────────────────────────────────────────────────────────── */}
      <section className="sec alt">
        <div className="wrap">
          <div className="rv">
            <span className="kicker">Built to be handed over</span>
            <h2>Safe enough for HR data, simple enough for a 30-person firm</h2>
            <p className="sec-sub">
              You should not need a systems administrator to run an ideation programme,
              and you should not have to trust a vendor with your staff list on faith.
            </p>
          </div>
          <div className="sec-list">
            <div className="sl rv"><IcoShield /><span><b>Separate database per organisation</b>Your ideas and your people are not in a shared table with another company's.</span></div>
            <div className="sl rv"><IcoUsers /><span><b>Roles that match a real org</b>Employee, reviewer, admin and super admin — people see what their job needs, and nothing else.</span></div>
            <div className="sl rv"><IcoClip /><span><b>Append-only audit log</b>Every status change is recorded with who did it and when. Useful for ISO and quality audits.</span></div>
            <div className="sl rv"><IcoGlobe /><span><b>Nothing to install</b>Runs in the browser your team already has. No app store, no laptops required, no rollout project.</span></div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="sec" id="faq">
        <div className="wrap">
          <div className="rv">
            <span className="kicker">Straight answers</span>
            <h2>Questions we get asked first</h2>
          </div>
          <div className="faq">
            <details className="rv"><summary>How long does setup take?</summary>
              <p>A working day is typical. You create your organisation, import your staff list from a spreadsheet, pick your categories and approval rule, and you are live. There is no server to buy and nothing to install on anyone's machine.</p></details>
            <details className="rv"><summary>Will people on the shop floor actually use it?</summary>
              <p>That is the real risk, and it is why the design pushes back on it in three ways: the interface is available in seven Indian languages, an idea can be submitted from a phone in a few minutes, and every submitter can see exactly where their idea has reached. Points, leaderboards and time-boxed challenges exist to make the first month of habit-building easier.</p></details>
            <details className="rv"><summary>What does it cost?</summary>
              <p>Every organisation starts with a 14-day free trial — the whole product, no card, nothing withheld. After that you go onto a plan sized to your business, quoted when we approve your application. Plans are priced per organisation rather than per seat, so inviting the whole shop floor does not change the bill. GST is shown separately on every quote.</p></details>
            <details className="rv"><summary>What happens when the trial ends?</summary>
              <p>We tell you before it does, not after. Access pauses if a plan is not in place, but nothing is deleted — your ideas, your people and your history stay exactly as they are, and everything resumes the moment payment is arranged. You can export your data at any point, including while access is paused.</p></details>
            <details className="rv"><summary>How quickly do you reply to support?</summary>
              <p>Within one working day for any ticket, and within four working hours for anything marked urgent — Monday to Saturday, 9am to 6pm IST. Support is raised from inside the app, so we can see which organisation is asking without you explaining it first. Support stays reachable even if your access has paused for payment.</p></details>
            <details className="rv"><summary>Who can see our ideas?</summary>
              <p>Only your own people, according to the role you give them. Each organisation runs on its own database with its own admin. IFQM's own staff can see counts — how many people, how many ideas — for support and billing, and never the content of an idea.</p></details>
            <details className="rv"><summary>Do we need an IT person to run it?</summary>
              <p>No. Everything an administrator needs — users, categories, approval stages, branding, exports — is a screen in the app. Bulk user import takes a spreadsheet.</p></details>
            <details className="rv"><summary>Can we get our data out?</summary>
              <p>Yes. Ideas, reviews and analytics export to Excel and PDF, and an integration API can push approved ideas into a quality or CAPA system you already run.</p></details>
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
      <section className="sec">
        <div className="wrap">
          <div className="cta rv">
            <h2>Start listening to your team this week</h2>
            <p>
              Set up your organisation, invite ten people, and see what comes back in
              the first fortnight. If nothing useful arrives, you have lost an afternoon.
            </p>
            <div className="row">
              <Link to="/signup" className="btn-lp b-white b-lg">Create your workspace <IcoArrow /></Link>
              <Link to="/login" className="btn-lp b-line b-lg">I already have an account</Link>
            </div>
            <small>Free while in preview · No credit card · Export your data whenever you like</small>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <span>© {new Date().getFullYear()} IFQM — Employee Ideation Tool</span>
          <span style={{ display: 'flex', gap: 18 }}>
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Get started</Link>
            <a href="#faq">FAQ</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
