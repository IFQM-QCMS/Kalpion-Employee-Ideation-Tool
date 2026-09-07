import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';

/*
 * Shown to a user who is still holding the temporary password they were given by a bulk
 * import.
 */
export default function ForcePasswordChangePage() {
  const { user, changePassword, logout } = useAuth();
  const { t } = useLang();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext]       = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (next !== confirm) { setError(t('pw.mismatch')); return; }
    if (next === current) { setError(t('pw.same_as_current')); return; }

    setBusy(true);
    const res = await changePassword({ current_password: current, new_password: next })
      .catch((err) => ({ success: false, error: err?.response?.data?.error || t('msg.server_error') }));
    setBusy(false);

    if (res.success) showToast(t('pw.changed'), 'success');
    else setError(res.error || t('msg.server_error'));
  }

  return (
    <div className="login-wrap" style={{ display:'flex' }}>
      <div className="login-right" style={{ margin:'0 auto' }}>
        <div className="login-card">
          <div className="login-logo">
            <img src="/assets/favicon.png" alt="IFQM"
              style={{ height:40,marginBottom:10,borderRadius:8,objectFit:'contain' }}
              onError={e => { e.target.style.display='none'; }} />
            <h2>{t('pw.title')}</h2>
            <p>{t('pw.subtitle')}</p>
          </div>

          <div className="alert alert-warning" style={{ marginBottom:16,fontSize:12,lineHeight:1.5 }}>
            {t('pw.why')}
          </div>

          {error && <div className="alert alert-danger">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t('pw.current')}</label>
              <input className="form-control" type="password" value={current} autoFocus
                autoComplete="current-password"
                onChange={e => setCurrent(e.target.value)} required />
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('pw.current_hint')}</div>
            </div>

            <div className="form-group">
              <label>{t('pw.new')}</label>
              <input className="form-control" type="password" value={next}
                autoComplete="new-password"
                onChange={e => setNext(e.target.value)} required />
              <div style={{ fontSize:11,color:'var(--subtle)',marginTop:4 }}>{t('pw.rule')}</div>
            </div>

            <div className="form-group">
              <label>{t('pw.confirm')}</label>
              <input className="form-control" type="password" value={confirm}
                autoComplete="new-password"
                onChange={e => setConfirm(e.target.value)} required />
            </div>

            <button type="submit" className="btn btn-primary" disabled={busy}
              style={{ width:'100%',justifyContent:'center',padding:'11px',fontSize:14 }}>
              {busy ? t('msg.loading') : t('pw.submit')}
            </button>
          </form>

          <div className="separator"></div>
          <div style={{ textAlign:'center',display:'flex',gap:8,justifyContent:'center' }}>
            <button className="btn btn-outline btn-sm" onClick={logout}>{t('topbar.logout')}</button>
            {/* The one other place a gated user may go: someone whose temporary password doesn't work needs a way to say so. */}
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/support')}>
              {t('pw.need_help')}
            </button>
          </div>
          <p style={{ fontSize:11,color:'var(--subtle)',textAlign:'center',marginTop:10 }}>
            {user?.name} · {user?.email}
          </p>
        </div>
      </div>
    </div>
  );
}
