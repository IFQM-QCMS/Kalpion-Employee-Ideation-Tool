import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { usersApi } from '../services/api';
import { formatRole } from '../utils/helpers';

/*
 * Changing your own mobile number, verified by a code sent to the NEW number.
 *
 * The number is not cosmetic: sign-in codes and password-reset codes go to it,
 * so anybody who can change it unchallenged can redirect both. Proving the new
 * number is held is the point — and the server notifies the old address and old
 * number afterwards, so a change nobody made is visible to the person it was
 * made against.
 */
function PhoneChange({ current, onChanged, t }) {
  const { showToast } = useToast();
  const [open, setOpen]   = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode]   = useState('');
  const [stage, setStage] = useState('enter');   // 'enter' | 'verify'
  const [busy, setBusy]   = useState(false);

  const reset = () => { setOpen(false); setPhone(''); setCode(''); setStage('enter'); };

  async function sendCode() {
    setBusy(true);
    try {
      await usersApi.requestPhoneCode(phone.trim());
      setStage('verify');
      showToast(t('profile.phone_code_sent'), 'success');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function confirm() {
    setBusy(true);
    try {
      const r = await usersApi.confirmPhoneChange(phone.trim(), code.trim());
      showToast(r.data?.message || t('profile.phone_changed'), 'success');
      onChanged(r.data?.phone || phone.trim());
      reset();
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <>
        {current || '–'}
        <a className="link" style={{ marginLeft: 10, fontSize: 12 }} onClick={() => setOpen(true)}>
          {t('profile.phone_change')}
        </a>
      </>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 320 }}>
      {stage === 'enter' ? (
        <>
          <input className="form-control" type="tel" value={phone} autoFocus
            placeholder="+91 98765 43210" onChange={(e) => setPhone(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !phone.trim()} onClick={sendCode}>
              {busy ? t('msg.loading') : t('profile.phone_send_code')}
            </button>
            <button className="btn btn-outline btn-sm" onClick={reset}>{t('btn.cancel')}</button>
          </div>
          <span className="hint">{t('profile.phone_change_hint')}</span>
        </>
      ) : (
        <>
          <input className="form-control" inputMode="numeric" maxLength={8} value={code} autoFocus
            autoComplete="one-time-code" placeholder={t('login.otp_code_ph')}
            style={{ letterSpacing: 3, fontWeight: 700 }}
            onChange={(e) => setCode(e.target.value.replace(/D/g, ''))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || code.length < 4} onClick={confirm}>
              {busy ? t('msg.loading') : t('profile.phone_confirm')}
            </button>
            <button className="btn btn-outline btn-sm" onClick={reset}>{t('btn.cancel')}</button>
          </div>
          <span className="hint">{t('profile.phone_code_to', { phone: phone.trim() })}</span>
        </>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const { t }    = useLang();

  if (!user) return null;

  return (
    <div style={{ maxWidth:600 }}>
      <div className="card" style={{ textAlign:'center',padding:32 }}>
        <div id="profile-avatar" className="avatar" style={{ width:64,height:64,fontSize:24,margin:'0 auto 12px',background:'linear-gradient(135deg,var(--primary),#6366f1)' }}>
          {user.avatar_initials || user.name?.[0] || '?'}
        </div>
        <div id="profile-name" style={{ fontSize:20,fontWeight:700,color:'var(--heading)' }}>{user.name}</div>
        <div style={{ fontSize:13,color:'var(--subtle)',marginTop:2 }} id="profile-empid">{user.employee_id}</div>
        <span id="profile-role-badge" className="badge" style={{ marginTop:8,display:'inline-block',background:'var(--chip-bg)',color:'var(--text)',border:'1px solid var(--border)' }}>
          {formatRole(user.role, t)}
        </span>

        <div id="profile-stats" style={{ display:'flex',justifyContent:'center',gap:32,marginTop:20 }}>
          <div className="mini-stat">
            <div className="mini-stat-val">{user.points || 0}</div>
            <div className="mini-stat-label">{t('profile.total_pts')}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop:16 }}>
        <div style={{ fontWeight:700,fontSize:13,marginBottom:14,color:'var(--heading)' }}>{t('profile.details')}</div>
        <table className="table" id="profile-table">
          <tbody>
            <tr><td style={{ color:'var(--subtle)',padding:'5px 0' }}>{t('profile.dept')}</td><td>{user.department||'–'}</td></tr>
            <tr><td style={{ color:'var(--subtle)',padding:'5px 0' }}>{t('profile.email_lbl')}</td><td>{user.email}</td></tr>
            <tr><td style={{ color:'var(--subtle)',padding:'5px 0' }}>{t('profile.phone')}</td><td>
              <PhoneChange current={user.phone} t={t}
                onChanged={(p) => setUser && setUser({ ...user, phone: p })} />
            </td></tr>
            <tr><td style={{ color:'var(--subtle)',padding:'5px 0' }}>{t('profile.reports_to')}</td><td>{user.manager_name||'–'}</td></tr>
            <tr><td style={{ color:'var(--subtle)',padding:'5px 0' }}>{t('profile.bu')}</td><td>{user.business_unit||'–'}</td></tr>
            <tr><td style={{ color:'var(--subtle)',padding:'5px 0' }}>{t('profile.loc')}</td><td>{user.location||'–'}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
