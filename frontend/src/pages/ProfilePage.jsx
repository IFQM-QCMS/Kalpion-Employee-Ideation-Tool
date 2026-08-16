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

const EDITABLE = [
  ['department', 'profile.dept'],
  ['business_unit', 'profile.bu'],
  ['location', 'profile.loc'],
];

const CELL = { padding:'11px 13px',borderRadius:10,background:'var(--surface-2,var(--chip-bg))',border:'1px solid var(--border)' };
const CAP  = { fontSize:11,fontWeight:700,color:'var(--subtle)',textTransform:'uppercase',letterSpacing:.4 };

/* A read-only fact, with a line saying why where that is not obvious. A field
   nobody can edit and nobody explains reads as broken. */
function Detail({ label, value, note }) {
  return (
    <div style={CELL}>
      <div style={CAP}>{label}</div>
      <div style={{ marginTop:5,fontSize:13.5,fontWeight:600,color:value?'var(--text)':'var(--subtle)',overflowWrap:'anywhere' }}>
        {value || '—'}
      </div>
      {note && <div style={{ marginTop:4,fontSize:10.5,color:'var(--subtle)' }}>{note}</div>}
    </div>
  );
}

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const { t }    = useLang();

  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [form, setForm] = useState({ department:'', business_unit:'', location:'' });

  async function save() {
    setSaving(true);
    try {
      const res = await usersApi.updateProfile(form);
      if (res.data?.success) {
        setUser && setUser({ ...user, ...form });
        showToast(res.data.message || t('profile.saved'), 'success');
        setEditing(false);
      } else showToast(res.data?.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setSaving(false);
  }

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

      {/* Details as labelled cards, not a bare two-column table.
          The table put a grey label against a dash for every empty field, so a
          profile with nothing filled in read as broken rather than as new — and
          offered no way to fix any of it.

          The three descriptive fields are editable. Role, points and reporting
          line are not: they decide what an idea can reach and who judges it,
          and the server ignores them whatever this form sends. */}
      <div className="card" style={{ marginTop:16 }}>
        <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,gap:12,flexWrap:'wrap' }}>
          <div style={{ fontWeight:700,fontSize:13,color:'var(--heading)' }}>{t('profile.details')}</div>
          {!editing ? (
            <button className="btn btn-outline btn-sm" onClick={() => {
              setForm({ department:user.department||'', business_unit:user.business_unit||'', location:user.location||'' });
              setEditing(true);
            }}>{t('profile.edit')}</button>
          ) : (
            <div style={{ display:'flex',gap:8 }}>
              <button className="btn btn-outline btn-sm" disabled={saving} onClick={() => setEditing(false)}>{t('btn.cancel')}</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
                {saving ? t('btn.saving') : t('profile.save')}
              </button>
            </div>
          )}
        </div>

        <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(215px,1fr))',gap:12 }}>
          <Detail label={t('profile.email_lbl')} value={user.email} />

          <div style={CELL}>
            <div style={CAP}>{t('profile.phone')}</div>
            <div style={{ marginTop:5 }}>
              <PhoneChange current={user.phone} t={t}
                onChanged={(p) => setUser && setUser({ ...user, phone: p })} />
            </div>
          </div>

          {EDITABLE.map(([key, labelKey]) => (
            <div key={key} style={CELL}>
              <div style={CAP}>{t(labelKey)}</div>
              {editing ? (
                <input className="form-control" style={{ marginTop:6,fontSize:13 }} maxLength={100}
                  value={form[key]} placeholder={t('profile.not_set')}
                  onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} />
              ) : (
                <div style={{ marginTop:5,fontSize:13.5,fontWeight:600,color:user[key]?'var(--text)':'var(--subtle)' }}>
                  {user[key] || t('profile.not_set')}
                </div>
              )}
            </div>
          ))}

          <Detail label={t('profile.reports_to')} value={user.manager_name} note={t('profile.managed_note')} />
          <Detail label={t('profile.role_lbl')} value={formatRole(user.role, t)} note={t('profile.managed_note')} />
        </div>
      </div>
    </div>
  );
}
