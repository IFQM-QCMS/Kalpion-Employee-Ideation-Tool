import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../services/api';

export default function LoginPage() {
  const { login }   = useAuth();
  const { t }       = useLang();
  const { showToast } = useToast();
  const navigate     = useNavigate();
  const [params]     = useSearchParams();

  const [orgSlug,  setOrgSlug]  = useState(params.get('org') || '');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Handle reset_token in URL
  useEffect(() => {
    const rt = params.get('reset_token');
    if (rt) handleResetPassword(rt);
  }, []);

  async function handleLogin(e) {
    e?.preventDefault();
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
        // result.error carries the server's own message — "3 attempt(s)
        // remaining", "Too many failed attempts…", "Unknown organization code."
        // Only fall back to a generic message when there genuinely wasn't one
        // (i.e. the request never reached the server).
        setError(result.error || t('msg.server_error'));
      }
    } catch(err) {
      setError(t('msg.server_error'));
    }
    setLoading(false);
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const emailPrompt = prompt(t('login.prompt_email'));
    if (!emailPrompt?.trim()) return;
    try {
      const res = await authApi.forgotPassword({ email: emailPrompt.trim(), org_slug: orgSlug });
      if (res.data.success) {
        showToast(t('login.reset_sent'), 'success');
      } else {
        showToast(res.data.error || t('login.request_failed'), 'danger');
      }
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  async function handleResetPassword(token) {
    const pw1 = prompt(t('login.prompt_new_pw'));
    if (!pw1 || pw1.length < 8) { showToast(t('login.pw_too_short'), 'warning'); return; }
    const pw2 = prompt(t('login.prompt_confirm_pw'));
    if (pw1 !== pw2) { showToast(t('login.pw_mismatch'), 'warning'); return; }
    try {
      const res = await authApi.resetPassword({ token, password: pw1, org_slug: params.get('org') || '' });
      if (res.data.success) {
        showToast(t('login.pw_updated'), 'success');
        navigate('/');
      } else {
        showToast(res.data.error || t('login.reset_failed'), 'danger');
      }
    } catch { showToast(t('msg.network_error'), 'danger'); }
  }

  return (
    <div className="login-wrap" style={{ display:'flex' }}>
      <div className="login-left">
        <div className="bubble bubble-1"></div>
        <div className="bubble bubble-2"></div>
        <div style={{ textAlign:'center', marginBottom:36 }}>
          <img src="/assets/ifqm-logo.png" alt="IFQM"
            style={{ height:56,marginBottom:14,background:'#fff',borderRadius:10,padding:'6px 12px',objectFit:'contain',boxShadow:'0 2px 8px rgba(0,0,0,.12)' }}
            onError={e => { e.target.style.display='none'; }} />
          <h2 style={{ fontSize:21,color:'#ffffff',fontWeight:800,marginTop:10 }}>{t('login.app_title')}</h2>
          <p style={{ fontSize:13,color:'rgba(255,255,255,.65)',marginTop:6,lineHeight:1.5 }}>{t('login.tagline')}</p>
        </div>

        <div className="login-feature">
          <div className="login-feature-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21h6M12 3a6 6 0 016 6c0 2.2-1.1 3.8-2.5 5L15 16H9l-.5-2C7 12.8 6 11.2 6 9a6 6 0 016-6z"/>
            </svg>
          </div>
          <div>
            <div className="login-feature-title">{t('login.feat1_title')}</div>
            <div className="login-feature-sub">{t('login.feat1_sub')}</div>
          </div>
        </div>
        <div className="login-feature" style={{ animationDelay:'.12s' }}>
          <div className="login-feature-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div>
            <div className="login-feature-title">{t('login.feat2_title')}</div>
            <div className="login-feature-sub">{t('login.feat2_sub')}</div>
          </div>
        </div>
        <div className="login-feature" style={{ animationDelay:'.22s' }}>
          <div className="login-feature-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </div>
          <div>
            <div className="login-feature-title">{t('login.feat3_title')}</div>
            <div className="login-feature-sub">{t('login.feat3_sub')}</div>
          </div>
        </div>
      </div>

      <div className="login-right">
        <div className="login-card">
          <div className="login-logo">
            <img src="/assets/ifqm-logo.png" alt="IFQM"
              style={{ height:40,marginBottom:10,background:'#fff',borderRadius:8,padding:'4px 10px',objectFit:'contain',boxShadow:'0 1px 4px rgba(0,0,0,.1)' }}
              onError={e => { e.target.style.display='none'; }} />
            <h2>{t('login.welcome')}</h2>
            <p>{t('login.subtitle')}</p>
          </div>

          {error && (
            <div className="alert alert-danger" style={{ animation:'fadeInDown .25s ease' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            {/* Organisation code is gone — the platform identifies the org from
                the email or the registered phone number itself. Any ?org= in the
                URL (e.g. an old reset link) is still honoured silently. */}
            <div className="form-group">
              <label>{t('login.identifier')}</label>
              <input
                className="form-control"
                type="text"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('login.identifier_ph')}
                autoComplete="username"
                required
              />
            </div>

            <div className="form-group">
              <label>{t('login.password')}</label>
              <input
                className="form-control"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('login.password_ph')}
                autoComplete="current-password"
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width:'100%',justifyContent:'center',padding:'11px',fontSize:14 }}
            >
              {loading ? t('login.signing_in') : t('login.btn')}
            </button>
          </form>

          <div className="separator"></div>
          <p style={{ fontSize:11,color:'#aaa',textAlign:'center' }}>
            {t('login.powered_by')}
          </p>
          <div style={{ textAlign:'center',marginTop:4 }}>
            <a href="#" onClick={handleForgotPassword} style={{ fontSize:11,color:'#888',textDecoration:'none' }}>
              {t('login.forgot')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
