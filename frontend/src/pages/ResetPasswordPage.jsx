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

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const token = params.get('token') || params.get('reset_token') || '';
  const orgSlug = params.get('org') || params.get('org_slug') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!token) {
      setError('Invalid or expired password reset link. Please request a new link.');
    }
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) {
      setError('Missing reset token. Please request a new password reset link.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please retype your password.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await authApi.resetPassword({
        token,
        password,
        org_slug: orgSlug,
      });

      if (res.data?.success) {
        setSuccess('Your password has been updated successfully! Redirecting to login...');
        showToast('Password updated successfully. Please sign in with your new password.', 'success');
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      } else {
        setError(res.data?.error || 'Failed to reset password. Link may have expired.');
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Server error. Please try again.');
    }
    setLoading(false);
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
          transition: filter .16s;
        }
        .reset-card .btn-go:hover { filter: brightness(1.08); }
        .reset-card .btn-go:disabled { opacity: 0.6; cursor: not-allowed; }
        .reset-card .err { background: var(--danger-light); color: var(--danger); border: 1px solid var(--danger); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
        .reset-card .ok { background: var(--success-light); color: var(--success); border: 1px solid var(--success); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
      `}</style>

      <div className="reset-card">
        <Link to="/" className="brand">
          <img src="/assets/ifqm-logo.png" alt="IFQM" onError={e => { e.target.style.display = 'none'; }} />
          <span>IFQM</span>
        </Link>

        <div>
          <h1>Reset Password</h1>
          <p className="sub">Enter your new password for your IFQM account.</p>
        </div>

        {error && <div className="err">{error}</div>}
        {success && <div className="ok">{success}</div>}

        {!success && (
          <form onSubmit={handleSubmit}>
            <div className="fld">
              <span className="ic"><LockIcon /></span>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="New Password (min 8 chars)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
              />
              <button
                type="button"
                className="eye"
                onClick={() => setShowPassword(v => !v)}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>

            <div className="fld">
              <span className="ic"><LockIcon /></span>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm New Password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            <button type="submit" className="btn-go" disabled={loading || !token}>
              {loading ? 'Updating Password...' : 'Reset Password'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 6, fontSize: 13 }}>
          <Link to="/login" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
            ← Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
