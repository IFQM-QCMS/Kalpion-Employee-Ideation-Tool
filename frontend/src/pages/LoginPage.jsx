import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../services/api';

/*
  Minimal "particles" auth page (adapted from appvibed01/minimal-auth).

  Kept: the animated particle field + soft radial glows behind a slim, centred
  card with a brand mark, heading and sub-line.

  Adapted for IFQM, and why:
   • The source is OAuth-only ("Continue with Google / GitHub"). IFQM has no
     social login — so those buttons are replaced by the real email/phone +
     password form. Nothing here is a dead button.
   • The particle field is a small self-contained <canvas> (no new dependency,
     no shadcn/Tailwind), and all styles are scoped under `.ifqm-particles`.
   • Theme-aware: it reads the app's CSS variables, so it follows light/dark.
*/

const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>
  </svg>
);
const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);
const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

/* Lightweight particle field — drifting dots that link when close and gently
   part around the cursor. Pure canvas; cleans up its rAF + listeners. */
function useParticles(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const N = 110, LINK = 120;
    let w = 0, h = 0, raf = 0;
    const parts = [];
    const mouse = { x: -9999, y: -9999 };

    const ink = () => {
      const c = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
      return c || '#8b93a1';
    };
    let color = ink();

    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const seed = () => {
      parts.length = 0;
      for (let i = 0; i < N; i++) parts.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 1.5 + 0.6,
      });
    };
    const hex2rgb = (hex) => {
      const m = hex.replace('#', '');
      const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
      const int = parseInt(n, 16);
      return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      const [r, g, b] = color.startsWith('#') ? hex2rgb(color) : [139, 147, 161];
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
        if (d < 90 && d > 0) { p.x += (dx / d) * 1.1; p.y += (dy / d) * 1.1; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
        ctx.fill();
      }
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i], c2 = parts[j];
          const dx = a.x - c2.x, dy = a.y - c2.y, d = Math.hypot(dx, dy);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - d / LINK) * 0.16})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const onResize = () => { resize(); seed(); };
    const onMove = (e) => { const b = canvas.getBoundingClientRect(); mouse.x = e.clientX - b.left; mouse.y = e.clientY - b.top; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    const onTheme = () => { color = ink(); };

    resize(); seed(); tick();
    window.addEventListener('resize', onResize);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    const obs = new MutationObserver(onTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      obs.disconnect();
    };
  }, [canvasRef]);
}

export default function LoginPage() {
  const { login }   = useAuth();
  const { t }       = useLang();
  const { showToast } = useToast();
  const navigate     = useNavigate();
  const [params]     = useSearchParams();

  const [orgSlug]    = useState(params.get('org') || '');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const canvasRef = useRef(null);
  useParticles(canvasRef);

  useEffect(() => {
    // The reset email links to /reset-password?token=…&org=… (authService), while
    // older links used ?reset_token=. Accept both so neither generation of email
    // dead-ends.
    const rt = params.get('token') || params.get('reset_token');
    if (rt) handleResetPassword(rt);
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login({ email, password, org_slug: orgSlug.toLowerCase().trim() });
      if (result.success) {
        const role = result.user?.role;
        if (role === 'platform_admin') navigate('/platform');
        else if (role === 'super_admin') navigate('/super-admin');
        else navigate('/dashboard');
      } else {
        setError(result.error || t('msg.server_error'));
      }
    } catch (err) {
      setError(t('msg.server_error'));
    }
    setLoading(false);
  }

  async function handleForgotPassword(e) {
    e?.preventDefault();
    const emailPrompt = prompt(t('login.prompt_email'));
    if (!emailPrompt?.trim()) return;
    try {
      const res = await authApi.forgotPassword({ email: emailPrompt.trim(), org_slug: orgSlug });
      if (res.data.success) showToast(t('login.reset_sent'), 'success');
      else showToast(res.data.error || t('login.request_failed'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  async function handleResetPassword(token) {
    const pw1 = prompt(t('login.prompt_new_pw'));
    if (!pw1 || pw1.length < 8) { showToast(t('login.pw_too_short'), 'warning'); return; }
    const pw2 = prompt(t('login.prompt_confirm_pw'));
    if (pw1 !== pw2) { showToast(t('login.pw_mismatch'), 'warning'); return; }
    try {
      const res = await authApi.resetPassword({ token, password: pw1, org_slug: params.get('org') || '' });
      if (res.data.success) { showToast(t('login.pw_updated'), 'success'); navigate('/login'); }
      else showToast(res.data.error || t('login.reset_failed'), 'danger');
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  return (
    <div className="ifqm-particles">
      <style>{`
        .ifqm-particles{
          position:relative;min-height:100vh;width:100%;overflow:hidden;
          display:flex;align-items:center;justify-content:center;padding:24px;
          background:var(--bg);color:var(--text);
          font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;
        }
        .ifqm-particles *{box-sizing:border-box}
        .ifqm-particles .particles{position:absolute;inset:0;width:100%;height:100%;z-index:0}
        /* soft off-axis glows, like the source's radial washes */
        .ifqm-particles .glow{position:absolute;pointer-events:none;z-index:0;filter:blur(10px)}
        .ifqm-particles .glow-a{top:-18%;left:52%;width:560px;height:1300px;transform:translateX(-50%) rotate(-42deg);
          background:radial-gradient(50% 50% at 50% 50%,rgba(99,102,241,.10),transparent 80%)}
        .ifqm-particles .glow-b{top:-14%;left:38%;width:260px;height:1300px;transform:translateX(-50%) rotate(-42deg);
          background:radial-gradient(50% 50% at 50% 50%,rgba(168,85,247,.08),transparent 80%)}

        .ifqm-particles .auth-col{position:relative;z-index:1;width:100%;max-width:384px;
          display:flex;flex-direction:column;gap:18px;
          animation:ip-in .6s cubic-bezier(.16,.84,.44,1) both}
        @keyframes ip-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

        .ifqm-particles .brand{display:flex;align-items:center;gap:12px;text-decoration:none}
        .ifqm-particles .brand img{height:52px;background:#fff;border-radius:12px;padding:7px 12px;
          object-fit:contain;box-shadow:0 8px 26px rgba(79,70,229,.20)}
        .ifqm-particles .brand .wm{font-size:20px;font-weight:800;letter-spacing:-.02em;color:var(--heading)}
        .ifqm-particles .brand .wm small{display:block;font-size:11.5px;font-weight:500;letter-spacing:.02em;color:var(--text-muted)}

        .ifqm-particles h1{font-size:26px;font-weight:800;letter-spacing:-.02em;color:var(--heading);margin:6px 0 2px}
        .ifqm-particles .sub{font-size:14px;color:var(--text-muted);line-height:1.5}

        .ifqm-particles form{display:flex;flex-direction:column;gap:12px;margin-top:2px}
        .ifqm-particles .fld{position:relative}
        .ifqm-particles .fld .ic{position:absolute;left:14px;top:50%;transform:translateY(-50%);display:flex;color:var(--text-muted)}
        .ifqm-particles .fld input{
          width:100%;background:var(--surface);border:1px solid var(--border);border-radius:12px;
          padding:13px 44px;font-size:14px;color:var(--text);outline:none;
          transition:border-color .16s,box-shadow .16s;
        }
        .ifqm-particles .fld input::placeholder{color:var(--subtle)}
        .ifqm-particles .fld input:focus{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-dim)}
        .ifqm-particles .eye{position:absolute;right:6px;top:0;height:100%;width:40px;display:flex;align-items:center;
          justify-content:center;background:none;border:none;cursor:pointer;color:var(--text-muted)}
        .ifqm-particles .eye:hover{color:var(--text)}

        .ifqm-particles .go{
          width:100%;margin-top:4px;padding:13px;border:none;border-radius:12px;cursor:pointer;
          background:var(--primary);color:var(--on-primary,#fff);font-size:14px;font-weight:700;letter-spacing:.02em;
          transition:filter .16s,transform .16s,box-shadow .16s;
        }
        .ifqm-particles .go:hover{filter:brightness(1.05);transform:translateY(-1px);box-shadow:0 10px 24px -6px var(--primary-glow)}
        .ifqm-particles .go:disabled{opacity:.65;cursor:default;transform:none;box-shadow:none}

        .ifqm-particles .row{display:flex;justify-content:flex-end;margin-top:-2px}
        .ifqm-particles .link{font-size:12.5px;color:var(--primary);text-decoration:none;cursor:pointer}
        .ifqm-particles .link:hover{text-decoration:underline}
        .ifqm-particles .err{background:var(--danger-light);color:var(--danger);border:1px solid var(--danger);
          border-radius:10px;padding:9px 13px;font-size:12.5px}
        .ifqm-particles .alt-cta{margin-top:2px;font-size:12.5px;color:var(--text-muted);text-align:center}
        .ifqm-particles .foot{margin-top:12px;font-size:11px;color:var(--subtle)}
      `}</style>

      <canvas ref={canvasRef} className="particles" aria-hidden="true" />
      <div className="glow glow-a" aria-hidden="true" />
      <div className="glow glow-b" aria-hidden="true" />

      <div className="auth-col">
        <Link to="/" className="brand" aria-label="IFQM home">
          <img src="/assets/ifqm-logo.png" alt="IFQM" onError={e => { e.target.style.display='none'; }} />
          <span className="wm">IFQM<small>{t('login.app_title')}</small></span>
        </Link>

        <div>
          <h1>{t('login.btn')}</h1>
          <p className="sub">{t('login.subtitle')}</p>
        </div>

        {error && <div className="err">{error}</div>}

        <form onSubmit={handleLogin}>
          <div className="fld">
            <span className="ic"><MailIcon /></span>
            <input type="text" value={email} onChange={e => setEmail(e.target.value)}
              placeholder={t('login.id_short')} autoComplete="username" required />
          </div>
          <div className="fld">
            <span className="ic"><LockIcon /></span>
            <input type={showPassword ? 'text' : 'password'} value={password}
              onChange={e => setPassword(e.target.value)} placeholder={t('login.password_ph')}
              autoComplete="current-password" required />
            <button type="button" className="eye"
              aria-label={showPassword ? t('login.hide_pw') : t('login.show_pw')}
              onClick={() => setShowPassword(v => !v)}>
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <div className="row">
            <a className="link" onClick={handleForgotPassword}>{t('login.forgot')}</a>
          </div>
          <button type="submit" className="go" disabled={loading}>
            {loading ? t('login.signing_in') : t('login.btn')}
          </button>
        </form>

        <p className="alt-cta">
          {t('login.new_here')} <Link className="link" to="/signup">{t('login.request_access')}</Link>
        </p>

        <p className="foot">{t('login.powered_by')}</p>
      </div>
    </div>
  );
}
