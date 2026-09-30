import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authApi } from '../services/api';
import { useToast } from '../context/ToastContext';

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
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);

// Also where the phone-verification activation flow (LoginPage) finishes: it hands off a
// server-issued reset token here exactly the same way an emailed link does, distinguished
// only by ?activation=1 so the copy can say "create" instead of "reset".
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const token = params.get('token') || params.get('reset_token') || '';
  const orgSlug = params.get('org') || params.get('org_slug') || '';
  const isActivation = params.get('activation') === '1';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // The real rule this deployment enforces (config.minPasswordLength), not a guessed number -
  // the deployment default is 12, and this page used to say 8.
  const [minLen, setMinLen] = useState(12);
  useEffect(() => {
    let cancelled = false;
    authApi.passwordPolicy()
      .then((r) => { if (!cancelled && r.data?.min_length) setMinLen(Number(r.data.min_length)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!token) {
      setError('Invalid or expired reset link. Please request a new one.');
    }
  }, [token]);

  const lengthOk = password.length >= minLen;
  const matchOk = confirmPassword.length > 0 && password === confirmPassword;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) {
      setError('Missing reset token. Please request a new one.');
      return;
    }
    if (!lengthOk) {
      setError(`Password must be at least ${minLen} characters long.`);
      return;
    }
    if (!matchOk) {
      setError('Passwords do not match. Please retype your password.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await authApi.resetPassword({ token, password, org_slug: orgSlug });

      if (res.data?.success) {
        setSuccess(true);
      } else {
        setError(res.data?.error || 'That did not work. The link or code may have expired.');
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Server error. Please try again.');
    }
    setLoading(false);
  }

  function continueToLogin() {
    showToast('Password updated successfully. Please sign in with your new password.', 'success');
    navigate('/login');
  }

  return (
    <div style={{
      position: 'relative', minHeight: '100vh', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    }}>
      <style>{`
        .reset-card {
          width: 100%; max-width: 400px;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 16px; padding: 32px 28px;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.08);
          display: flex; flex-direction: column; gap: 16px;
        }
        .reset-card .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; margin-bottom: 4px; }
        .reset-card .brand img { height: 42px; background: #fff; border-radius: 10px; padding: 6px 10px; object-fit: contain; }
        .reset-card .brand span { font-size: 19px; font-weight: 800; color: var(--heading); }
        .reset-card h1 { font-size: 22px; font-weight: 800; color: var(--heading); margin: 0; }
        .reset-card p.sub { font-size: 13.5px; color: var(--text-muted); margin: 0; }
        .reset-card form { display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
        .reset-card .fld { position: relative; }
        .reset-card .fld .ic { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-muted); display: flex; }
        .reset-card .fld input {
          width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
          padding: 12px 42px; font-size: 14px; color: var(--text); outline: none;
          transition: border-color .16s, box-shadow .16s;
        }
        .reset-card .fld input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-dim); }
        .reset-card .eye { position: absolute; right: 6px; top: 0; height: 100%; width: 40px; display: flex; align-items: center; justify-content: center; background: none; border: none; cursor: pointer; color: var(--text-muted); }
        .reset-card .btn-go {
          width: 100%; padding: 12px; border: none; border-radius: 10px; cursor: pointer;
          background: var(--primary); color: #fff; font-size: 14px; font-weight: 700;
          transition: filter .16s; text-decoration: none; display: inline-flex; align-items: center; justify-content: center;
        }
        .reset-card .btn-go:hover { filter: brightness(1.08); }
        .reset-card .btn-go:disabled { opacity: 0.6; cursor: not-allowed; }
        .reset-card .btn-go:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
        .reset-card .err { background: var(--danger-light); color: var(--danger); border: 1px solid var(--danger); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
        .reset-card .ok { background: var(--success-light); color: var(--success); border: 1px solid var(--success); border-radius: 8px; padding: 10px 14px; font-size: 13px; line-height: 1.55; }
      `}</style>

      <div className="reset-card">
        <Link to="/" className="brand">
          <img src="/assets/ifqm-logo.png" alt="IFQM" onError={e => { e.target.style.display = 'none'; }} />
          <span>Kalpion</span>
        </Link>

        {success ? (
          <>
            <div>
              <h1>{isActivation ? 'Your account is ready' : 'Password updated'}</h1>
              <p className="sub">
                {isActivation
                  ? 'Your Kalpion account has been successfully activated.'
                  : 'Your password has been updated successfully.'}
              </p>
            </div>
            <div className="ok" role="status">
              {isActivation
                ? 'You can now sign in using your phone number and password.'
                : 'Please sign in with your new password.'}
            </div>
            <button type="button" className="btn-go" onClick={continueToLogin}>
              Continue to Kalpion
            </button>
          </>
        ) : (
          <>
            <div>
              <h1>{isActivation ? 'Create your password' : 'Reset Password'}</h1>
              <p className="sub">
                {isActivation
                  ? 'Your phone number has been verified. Choose a password for your account.'
                  : 'Enter your new password for your Kalpion account.'}
              </p>
            </div>

            {error && <div className="err" role="alert">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="fld">
                <span className="ic"><LockIcon /></span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isActivation ? 'New password' : `New password (min ${minLen} chars)`}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoFocus
                  aria-label="New password"
                  aria-describedby="pw-rules"
                />
                <button
                  type="button"
                  className="eye"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              {/* Real-time feedback on the one rule that is meaningfully checkable before
                  submitting - length. The blocklist / repeated-character rules are the
                  server's own call and surface as a normal form error if either is tripped,
                  rather than being duplicated (and risking drifting out of sync) here. */}
              <div className="pw-rules" id="pw-rules" aria-live="polite">
                <div className={`pw-rule${lengthOk ? ' ok' : ''}`}>
                  <span className="pw-dot" aria-hidden="true"><CheckIcon /></span>
                  At least {minLen} characters
                </div>
                <div className={`pw-rule${matchOk ? ' ok' : ''}`}>
                  <span className="pw-dot" aria-hidden="true"><CheckIcon /></span>
                  Passwords match
                </div>
              </div>

              <div className="fld">
                <span className="ic"><LockIcon /></span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  aria-label="Confirm new password"
                />
              </div>

              <button type="submit" className="btn-go" disabled={loading || !token || !lengthOk || !matchOk}>
                {loading
                  ? (isActivation ? 'Creating...' : 'Updating...')
                  : (isActivation ? 'Create password' : 'Reset Password')}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: 6, fontSize: 13 }}>
              <Link to="/login" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
                ← Back to Sign In
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
