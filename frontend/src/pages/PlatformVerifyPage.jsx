import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../services/api';

/*
 * A new platform administrator proving they hold the address and the number.
 *
 * ── Why this screen exists at all ──────────────────────────────────────────
 *
 * This account reaches every tenant on the platform. It used to be created by
 * typing a name, an address and a password into a form, and nothing checked
 * that the address existed or that anybody read it. A typo produced a fully
 * working account whose intended owner could never receive a password reset.
 *
 * ── Why both, and why neither can be skipped ───────────────────────────────
 *
 * Two independent channels. An address alone can be taken by whoever holds that
 * mailbox; a number alone leaves nobody to send a reset to. The server refuses
 * every other endpoint until both timestamps are recorded, so this screen is
 * not a suggestion — it is the only thing the session can do. That gate lives
 * in the middleware precisely because a gate in React is bypassed by anybody
 * who calls the API with the token they were just handed.
 */

const CHANNELS = [
  { key: 'email', labelKey: 'pv.email', sentKey: 'pv.sent_email' },
  { key: 'phone', labelKey: 'pv.phone', sentKey: 'pv.sent_phone' },
];

export default function PlatformVerifyPage() {
  const { user, refreshUser, logout } = useAuth();
  const { t } = useLang();
  const { showToast } = useToast();

  const [state, setState] = useState(null);
  const [codes, setCodes] = useState({ email: '', phone: '' });
  const [busy, setBusy] = useState('');
  const [sentTo, setSentTo] = useState({});

  const load = useCallback(async () => {
    try {
      const r = await authApi.platformVerifyStatus();
      if (r.data.success) setState(r.data);
    } catch {
      /* The gate itself allows this endpoint; a failure here is a real outage,
         and the buttons below will report it in terms the operator can act on. */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async (channel) => {
    setBusy(`send:${channel}`);
    try {
      const r = await authApi.platformVerifySend({ channel });
      if (r.data.success) {
        setSentTo((s) => ({ ...s, [channel]: true }));
        showToast(t(channel === 'email' ? 'pv.sent_email' : 'pv.sent_phone'), 'success');
        setState((s) => ({ ...s, ...r.data }));
      } else showToast(r.data.error || t('msg.server_error'), 'danger');
    } catch (e) {
      showToast(e?.response?.data?.error || t('msg.server_error'), 'danger');
    }
    setBusy('');
  };

  const confirm = async (channel) => {
    setBusy(`confirm:${channel}`);
    try {
      const r = await authApi.platformVerifyConfirm({ channel, code: codes[channel] });
      if (r.data.success) {
        setState((s) => ({ ...s, ...r.data }));
        setCodes((c) => ({ ...c, [channel]: '' }));
        if (r.data.verified) {
          /*
           * Both done. The session is re-read rather than reloaded blindly:
           * the middleware checks the row on every request, so the gate opens
           * the moment the second code lands — no new sign-in needed.
           */
          showToast(t('pv.all_done'), 'success');
          await refreshUser?.();
          window.location.href = '/platform';
        } else {
          showToast(t('pv.one_done'), 'success');
        }
      } else showToast(r.data.error || t('msg.server_error'), 'danger');
    } catch (e) {
      showToast(e?.response?.data?.error || t('msg.server_error'), 'danger');
    }
    setBusy('');
  };

  const doneFor = (k) => (k === 'email' ? state?.email_verified : state?.phone_verified);
  const destFor = (k) => (k === 'email' ? user?.verify_email : user?.verify_phone);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <h1 style={{ fontSize: 22, fontWeight: 780, color: 'var(--heading)', margin: '0 0 6px' }}>
          {t('pv.title')}
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          {t('pv.intro')}
        </p>

        {CHANNELS.map(({ key, labelKey }) => {
          const done = doneFor(key);
          return (
            <div key={key} className="card" style={{ padding: '18px 20px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--heading)' }}>
                  {t(labelKey)}
                </span>
                {/* The masked destination, so somebody can tell at a glance that
                    the code is going somewhere they can actually open. */}
                {destFor(key) && (
                  <span style={{ fontSize: 12, color: 'var(--subtle)' }}>{destFor(key)}</span>
                )}
                <span style={{ marginLeft: 'auto' }}>
                  {done
                    ? <span className="chip chip-success">{t('pv.verified')}</span>
                    : <span className="chip chip-warning">{t('pv.pending')}</span>}
                </span>
              </div>

              {!done && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-outline btn-sm" disabled={!!busy}
                    onClick={() => send(key)}>
                    {busy === `send:${key}` ? t('msg.loading')
                      : (sentTo[key] ? t('pv.resend') : t('pv.send'))}
                  </button>
                  <input
                    className="form-control"
                    style={{ maxWidth: 160, letterSpacing: '.18em', fontWeight: 700 }}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    placeholder={t('pv.code_ph')}
                    value={codes[key]}
                    onChange={(e) => setCodes((c) => ({ ...c, [key]: e.target.value.replace(/\D/g, '') }))}
                  />
                  <button className="btn btn-primary btn-sm"
                    disabled={!!busy || codes[key].length < 4}
                    onClick={() => confirm(key)}>
                    {busy === `confirm:${key}` ? t('msg.loading') : t('pv.confirm')}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <p style={{ fontSize: 12, color: 'var(--subtle)', lineHeight: 1.6, marginTop: 4 }}>
          {t('pv.note')}
        </p>
        {/*
          A way out. Somebody who cannot receive either code — a wrong address
          typed by whoever created the account — must be able to leave rather
          than sit on a screen that cannot complete.
        */}
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={logout}>
          {t('nav.logout')}
        </button>
      </div>
    </div>
  );
}
