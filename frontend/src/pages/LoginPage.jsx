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

const WrenchIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);

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
const PhoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>
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
  const { login, adoptSession } = useAuth();
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

  /*
   * Forgot-password, as a dialog rather than window.prompt().
   *
   * The native prompt could not be styled, could not show a validation message
   * next to the field, and on several browsers is suppressed outright — which
   * is what "it does not work at all" turned out to mean: no dialog appeared,
   * so no request was ever sent.
   *
   * `forgotDone` deliberately keeps the panel open on success. The reply is
   * intentionally the same whether or not the address is registered (the
   * backend answers generically so this page cannot be used to discover who
   * holds an account), so the user needs to read that sentence rather than
   * have it flash past in a toast.
   */
  /*
   * Maintenance mode.
   *
   * The notice is shown, but the form is deliberately LEFT ENABLED. This screen
   * cannot know whether the person typing is a tenant user or an IFQM platform
   * admin until credentials are submitted, and staff must be able to sign in
   * precisely while this is on — they are the ones turning it off. So the
   * banner sets the expectation and the server makes the decision.
   */
  const [maint, setMaint] = useState(null);

  useEffect(() => {
    let alive = true;
    authApi.maintenance()
      .then((r) => { if (alive && r.data?.enabled) setMaint(r.data.message || ''); })
      // A failure here must never block sign-in: not knowing whether the
      // platform is on hold is not a reason to refuse a login attempt.
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotErr, setForgotErr] = useState('');
  const [forgotDone, setForgotDone] = useState(false);
  // Which of the two routes the request took, and — for the code route — the
  // masked destination the server reported.
  const [forgotVia, setForgotVia] = useState('link');
  const [forgotSentTo, setForgotSentTo] = useState('');
  // The code step. Only reached on the SMS route; the emailed link finishes in
  // the mailbox instead.
  const [forgotCode, setForgotCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);

  /*
   * MOM §4.1 / §4.2 — sign in with a one-time code.
   *
   * The option is only shown when the platform has it switched on AND a
   * provider is configured. Offering it otherwise would send people down a
   * route where no code ever arrives, which is worse than not offering it.
   */
  const [otpAvailable, setOtpAvailable] = useState(false);
  const [mode, setMode]         = useState('password');   // 'password' | 'otp'
  const [otpStage, setOtpStage] = useState('request');     // 'request' | 'verify'
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCode,  setOtpCode]  = useState('');
  const [otpNote,  setOtpNote]  = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    authApi.otpStatus()
      .then((r) => setOtpAvailable(!!r.data?.enabled && r.data?.provider !== 'unconfigured'))
      .catch(() => setOtpAvailable(false));
  }, []);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const id = setInterval(() => setResendIn((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  async function sendCode(e) {
    e?.preventDefault();
    setError(''); setOtpNote('');
    setLoading(true);
    try {
      const res = await authApi.otpRequest(otpPhone.trim());
      // Deliberately generic — the server will not say whether the number is
      // registered, and neither should this screen.
      setOtpNote(res.data?.message || t('login.otp_sent'));
      setOtpStage('verify');
      setResendIn(res.data?.resend_in ?? 60);
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.network_error'));
    }
    setLoading(false);
  }

  async function verifyCode(e) {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.otpVerify(otpPhone.trim(), otpCode.trim());
      if (res.data?.success) {
        adoptSession(res.data.user, res.data.token, res.data.user?.org_slug);
        const role = res.data.user?.role;
        if (role === 'platform_admin') navigate('/platform');
        else if (role === 'super_admin') navigate('/super-admin');
        else navigate('/dashboard');
      } else setError(res.data?.error || t('msg.server_error'));
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.network_error'));
    }
    setLoading(false);
  }

  useEffect(() => {
    /*
     * The reset email links to /reset-password?token=…&org=… (authService),
     * while older links used ?reset_token= and landed here instead.
     *
     * A token arriving on THIS page used to be collected through three
     * window.prompt() calls — new password, confirm it, hope they matched —
     * with no strength hint, no reveal toggle and no way back from a typo.
     * /reset-password is a real form that does all of that, so an old link is
     * handed to it rather than served a worse copy of it.
     */
    const rt = params.get('token') || params.get('reset_token');
    if (!rt) return;
    const org = params.get('org') || params.get('org_slug') || orgSlug || '';
    navigate(
      `/reset-password?token=${encodeURIComponent(rt)}${org ? `&org=${encodeURIComponent(org)}` : ''}`,
      { replace: true }
    );
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

  function handleForgotPassword(e) {
    e?.preventDefault();
    setForgotErr('');
    setForgotDone(false);
    // Seed it with whatever was already typed above, whatever kind of
    // identifier that is. The common case is somebody who typed who they are,
    // then found they could not remember the password — and since sign-in
    // accepts a username or a number, so must this.
    setForgotEmail(email.trim());
    setForgotOpen(true);
  }

  /*
   * Exchange the code for a reset token, then finish on /reset-password — the
   * same page the emailed link lands on.
   *
   * Deliberately NOT a second password form built into this dialog. Both routes
   * end in the same place for the same reason the server does it that way: one
   * way to actually set a password, two ways to earn the right to. A second
   * form would be a second set of strength rules to keep in step.
   */
  async function submitForgotCode(e) {
    e?.preventDefault();
    const code = forgotCode.trim();
    if (!code) return;
    setForgotErr('');
    setCodeBusy(true);
    try {
      const res = await authApi.resetCodeVerify(forgotEmail.trim(), code);
      if (res.data?.success && res.data.token) {
        const q = new URLSearchParams({ token: res.data.token });
        if (res.data.org_slug) q.set('org', res.data.org_slug);
        navigate(`/reset-password?${q.toString()}`);
      } else {
        setForgotErr(res.data?.error || t('login.request_failed'));
      }
    } catch (err) {
      setForgotErr(err?.response?.data?.error || t('msg.network_error'));
    }
    setCodeBusy(false);
  }

  async function submitForgot(e) {
    e?.preventDefault();
    /*
     * Two ways to earn a reset, chosen by what was typed.
     *
     * An address gets the emailed link, unchanged — it lands in a mailbox,
     * survives being opened on another device, and is the better experience at
     * a desk.
     *
     * A mobile number or a username gets a CODE. That route has existed on the
     * server since it was written and nothing ever called it: this dialog
     * validated an email regex and refused everything else, so the very people
     * it was built for — somebody locked out of the mailbox a link would go to,
     * somebody with no work address at all — had no way to reset a password.
     * Once accounts stopped requiring an email that was not an inconvenience
     * but a dead end.
     */
    const id = forgotEmail.trim();
    if (!id) { setForgotErr(t('login.forgot_invalid')); return; }
    const isEmailAddr = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);

    setForgotErr('');
    setForgotBusy(true);
    try {
      if (isEmailAddr) {
        const res = await authApi.forgotPassword({ email: id, org_slug: orgSlug });
        if (res.data?.success) { setForgotVia('link'); setForgotDone(true); }
        else setForgotErr(res.data?.error || t('login.request_failed'));
      } else {
        const res = await authApi.resetCodeRequest(id);
        if (res.data?.success) {
          // The server masks where it went. Somebody who typed a username has
          // no other way of knowing, and "a code has been sent" with no hint of
          // where is how a person sits waiting on the wrong device.
          setForgotSentTo(res.data.sent_to || '');
          setForgotVia('code');
          setForgotDone(true);
        } else setForgotErr(res.data?.error || t('login.request_failed'));
      }
    } catch (err) {
      setForgotErr(err?.response?.data?.error || t('msg.network_error'));
    }
    setForgotBusy(false);
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
        .ifqm-particles .note{background:var(--info-light);color:var(--info);border:1px solid var(--info);
          border-radius:10px;padding:9px 13px;font-size:12.5px;line-height:1.5}
        .ifqm-particles .switcher{display:flex;align-items:center;gap:10px;margin-top:2px}
        .ifqm-particles .switcher span{flex:1;height:1px;background:var(--border)}
        .ifqm-particles .switcher button{background:none;border:none;padding:0;cursor:pointer;
          font-size:12.5px;color:var(--primary);font-family:inherit}
        .ifqm-particles .switcher button:hover{text-decoration:underline}
        .ifqm-particles .err{background:var(--danger-light);color:var(--danger);border:1px solid var(--danger);
          border-radius:10px;padding:9px 13px;font-size:12.5px}
        .ifqm-particles .alt-cta{margin-top:2px;font-size:12.5px;color:var(--text-muted);text-align:center}
        .ifqm-particles .foot{margin-top:12px;font-size:11px;color:var(--subtle)}

        /* ── Maintenance notice ─────────────────────────────────────────
           Warning colours rather than danger: the platform is not broken and
           the reader has done nothing wrong — it is deliberately closed. */
        .ifqm-particles .maint{
          display:flex;gap:11px;align-items:flex-start;margin-bottom:16px;
          background:var(--warning-light,var(--info-light));
          color:var(--warning-dark,var(--warning,var(--info)));
          border:1px solid var(--warning,var(--info));
          border-radius:12px;padding:12px 14px;
        }
        .ifqm-particles .maint svg{flex:none;margin-top:1px}
        .ifqm-particles .maint b{display:block;font-size:13px;font-weight:700;margin-bottom:3px}
        .ifqm-particles .maint span{font-size:12.5px;line-height:1.55;opacity:.92}

        /* ── Forgot-password dialog ──────────────────────────────────────
           Replaces window.prompt(). Sits above the particle canvas and the
           two glows, all of which are z-index 0. */
        .ifqm-particles .modal-veil{
          position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
          padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px);
          animation:veil-in .16s ease-out;
        }
        @keyframes veil-in{from{opacity:0}to{opacity:1}}
        .ifqm-particles .modal{
          width:100%;max-width:400px;background:var(--card,var(--surface));
          border:1px solid var(--border);border-radius:16px;padding:22px;
          box-shadow:0 24px 60px -12px rgba(0,0,0,.45);
          animation:modal-in .18s cubic-bezier(.2,.8,.3,1);
        }
        @keyframes modal-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
        .ifqm-particles .modal h2{
          margin:0 0 4px;font-size:17px;font-weight:800;letter-spacing:-.01em;color:var(--heading);
        }
        .ifqm-particles .modal p{margin:0 0 16px;font-size:13px;line-height:1.55;color:var(--text-muted)}
        .ifqm-particles .modal form{margin-top:0}
        .ifqm-particles .modal .acts{display:flex;gap:9px;margin-top:4px}
        .ifqm-particles .modal .acts .go{margin-top:0;flex:1}
        .ifqm-particles .modal .ghost{
          padding:13px 18px;border-radius:12px;cursor:pointer;font-size:14px;font-weight:600;
          background:transparent;border:1px solid var(--border);color:var(--text-muted);
          font-family:inherit;transition:border-color .16s,color .16s;
        }
        .ifqm-particles .modal .ghost:hover{border-color:var(--text-muted);color:var(--text)}
        .ifqm-particles .modal .ok{
          background:var(--success-light,var(--info-light));color:var(--success,var(--info));
          border:1px solid var(--success,var(--info));
          border-radius:10px;padding:11px 13px;font-size:12.5px;line-height:1.55;
        }
      `}</style>

      <canvas ref={canvasRef} className="particles" aria-hidden="true" />
      <div className="glow glow-a" aria-hidden="true" />
      <div className="glow glow-b" aria-hidden="true" />

      <div className="auth-col">
        <Link to="/" className="brand" aria-label="IFQM home">
          <img src="/assets/ifqm-logo.png" alt="IFQM" onError={e => { e.target.style.display='none'; }} />
          <span className="wm">Kalpion</span>
        </Link>

        <div>
          <h1>{t('login.btn')}</h1>
          <p className="sub">{t('login.subtitle')}</p>
        </div>

        {maint !== null && (
          <div className="maint" role="status">
            <WrenchIcon />
            <div>
              <b>{t('login.maint_title')}</b>
              <span>{maint || t('login.maint_body')}</span>
            </div>
          </div>
        )}

        {error && <div className="err">{error}</div>}
        {mode === 'otp' && otpNote && <div className="note">{otpNote}</div>}

        {mode === 'otp' ? (
          otpStage === 'request' ? (
            <form onSubmit={sendCode}>
              {/*
                * Email address OR mobile number.
                *
                * This asked for a number only — type="tel", "Registered phone
                * number" — while the server has always accepted either and, with
                * no SMS gateway contracted, could only ever deliver by email. So
                * the one channel that worked was the one the screen never
                * invited anybody to use, and code sign-in looked completely
                * broken. type="text" because a tel keypad cannot type an "@".
                */}
              <div className="fld">
                <span className="ic"><PhoneIcon /></span>
                <input type="text" value={otpPhone} onChange={e => setOtpPhone(e.target.value)}
                  placeholder={t('login.otp_id_ph')} autoComplete="username" required autoFocus />
              </div>
              <button type="submit" className="go" disabled={loading || !otpPhone.trim()}>
                {loading ? t('msg.loading') : t('login.otp_send')}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode}>
              <div className="fld">
                <span className="ic"><LockIcon /></span>
                {/* inputMode numeric so a phone shows the number pad; one-time-code
                    lets both iOS and Android offer the SMS straight from the keyboard */}
                <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8}
                  value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t('login.otp_code_ph')} autoComplete="one-time-code" required autoFocus
                  style={{ letterSpacing:'.35em', fontWeight:700 }} />
              </div>
              <button type="submit" className="go" disabled={loading || otpCode.length < 4}>
                {loading ? t('login.signing_in') : t('login.otp_verify')}
              </button>
              <div className="row" style={{ justifyContent:'space-between' }}>
                <a className="link" onClick={() => { setOtpStage('request'); setOtpCode(''); setOtpNote(''); }}>
                  {t('login.otp_change_number')}
                </a>
                {resendIn > 0
                  ? <span style={{ fontSize:12.5,color:'var(--subtle)' }}>
                      {t('login.otp_resend_in').replace('{s}', resendIn)}
                    </span>
                  : <a className="link" onClick={sendCode}>{t('login.otp_resend')}</a>}
              </div>
            </form>
          )
        ) : (
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
        )}

        {/* Only offered when the platform actually has a working SMS provider —
            a route where no code ever arrives is worse than no route. */}
        {otpAvailable && (
          <div className="switcher">
            <span />
            <button type="button" className="link" onClick={() => {
              setMode(m => (m === 'otp' ? 'password' : 'otp'));
              setError(''); setOtpNote(''); setOtpStage('request'); setOtpCode('');
            }}>
              {mode === 'otp' ? t('login.use_password') : t('login.use_otp')}
            </button>
            <span />
          </div>
        )}

        <p className="alt-cta">
          {t('login.new_here')} <Link className="link" to="/signup">{t('login.request_access')}</Link>
        </p>

        <p className="foot">{t('login.powered_by')}</p>
      </div>

      {forgotOpen && (
        // Clicking the backdrop closes; clicking the panel must not, hence the
        // stopPropagation. Escape closes too, for a keyboard user who opened it
        // by accident.
        <div className="modal-veil" onClick={() => !forgotBusy && setForgotOpen(false)}
          onKeyDown={(ev) => { if (ev.key === 'Escape' && !forgotBusy) setForgotOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="forgot-title"
            onClick={(ev) => ev.stopPropagation()}>
            <h2 id="forgot-title">{t('login.forgot')}</h2>

            {forgotDone ? (
              <>
                <div className="ok">
                  {forgotVia === 'code'
                    ? (forgotSentTo
                      ? t('login.reset_code_sent_to', { where: forgotSentTo })
                      : t('login.reset_code_sent'))
                    : t('login.reset_sent')}
                </div>

                {/* The emailed link is finished in the mailbox. A code is
                    finished here, or the message would be telling somebody to
                    type it into a box that does not exist. */}
                {forgotVia === 'code' ? (
                  <form onSubmit={submitForgotCode}>
                    <div className="fld" style={{ marginTop: 14 }}>
                      <input
                        type="text" inputMode="numeric" autoComplete="one-time-code"
                        value={forgotCode} autoFocus disabled={codeBusy}
                        placeholder={t('login.otp_code_ph')}
                        style={{ letterSpacing: '4px', fontWeight: 700 }}
                        onChange={(ev) => { setForgotCode(ev.target.value); setForgotErr(''); }}
                        aria-label={t('login.otp_code_ph')}
                      />
                    </div>
                    {forgotErr && <div className="err">{forgotErr}</div>}
                    <div className="acts" style={{ marginTop: 16 }}>
                      <button type="button" className="ghost" disabled={codeBusy}
                        onClick={() => setForgotOpen(false)}>
                        {t('btn.cancel')}
                      </button>
                      <button type="submit" className="go" disabled={codeBusy || !forgotCode.trim()}>
                        {codeBusy ? t('login.signing_in') : t('login.otp_verify')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="acts" style={{ marginTop: 16 }}>
                    <button type="button" className="go" onClick={() => setForgotOpen(false)}>
                      {t('btn.close')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p>{t('login.forgot_body')}</p>
                <form onSubmit={submitForgot}>
                  <div className="fld">
                    <span className="ic"><MailIcon /></span>
                    {/* type="text", not "email". A browser refuses to submit a
                        phone number or a username from an email field, which is
                        what shut the code route out of this dialog. */}
                    <input
                      type="text" value={forgotEmail} autoFocus autoComplete="username"
                      placeholder={t('login.identifier_ph')} disabled={forgotBusy}
                      onChange={(ev) => { setForgotEmail(ev.target.value); setForgotErr(''); }}
                      aria-label={t('login.identifier')}
                    />
                  </div>
                  {forgotErr && <div className="err">{forgotErr}</div>}
                  <div className="acts">
                    <button type="button" className="ghost" disabled={forgotBusy}
                      onClick={() => setForgotOpen(false)}>
                      {t('btn.cancel')}
                    </button>
                    <button type="submit" className="go" disabled={forgotBusy}>
                      {forgotBusy ? t('login.forgot_sending') : t('login.forgot_send')}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
