import { useState, useEffect, useCallback } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import { fmtDateTime } from '../utils/helpers';
import InfoDot from './InfoDot';

/*
 * Platform → Settings → Messaging.
 *
 * One screen for everything that leaves the building as a message: the SMS
 * gateway, the one-time-code policy that rides on it, and the state of the
 * email queue.
 *
 * ── Two things this screen is careful about ────────────────────────────────
 *
 * The gateway API key is never sent to the browser. The field therefore starts
 * empty even when a key is stored, and an empty field on save means "keep the
 * one you have". That is the same contract as the SMTP password elsewhere in
 * this console, and the reason is the same: a screen that has to round-trip a
 * credential to avoid erasing it is a screen that puts the credential in a
 * response body, a browser cache and a devtools panel.
 *
 * "Test Connection" sends a real message and says so. A test that only checked
 * the fields parse would pass on a template ID the carrier has never approved —
 * which is the exact failure this button exists to find, because that failure
 * has no error, no delivery report, and no symptom other than a user saying
 * nothing arrived.
 */

const PROVIDERS = [
  ['jio_dlt', 'Jio DLT gateway'],
  ['log', 'Mock — write to server log'],
  ['msg91', 'MSG91 (from environment)'],
  ['twilio', 'Twilio (from environment)'],
];

/** A labelled on/off switch. */
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 46, height: 26, borderRadius: 999, flex: '0 0 auto',
        border: '1px solid ' + (checked ? 'var(--primary)' : 'var(--border-strong)'),
        background: checked ? 'var(--primary)' : 'var(--surface-2)',
        position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, transition: 'background .15s, border-color .15s', padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 22 : 2,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)', transition: 'left .15s',
      }} />
    </button>
  );
}

function Row({ label, hint, term, children }) {
  return (
    <div className="form-group">
      <label>{label}{term ? <InfoDot term={term} /> : null}</label>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 5, lineHeight: 1.5 }}>{hint}</div> : null}
    </div>
  );
}

export default function MessagingConnector() {
  const { t } = useLang();
  const { showToast } = useToast();

  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await platformApi.messaging();
      setData(r.data);
      setForm({
        otp_enabled: r.data.otp.enabled,
        otp_provider: r.data.otp.provider,
        otp_length: r.data.otp.length,
        otp_ttl_seconds: r.data.otp.ttl_seconds,
        otp_max_attempts: r.data.otp.max_attempts,
        otp_resend_seconds: r.data.otp.resend_seconds,
        sms_dlt_enabled: r.data.dlt.enabled,
        sms_dlt_entity_id: r.data.dlt.entity_id,
        sms_dlt_sender_id: r.data.dlt.sender_id,
        sms_dlt_template_id: r.data.dlt.template_id,
        sms_dlt_template_text: r.data.dlt.template_text,
        sms_dlt_endpoint: r.data.dlt.endpoint,
        mail_provider: r.data.mail.provider,
        mail_zepto_enabled: r.data.mail.zepto_enabled,
        mail_zepto_endpoint: r.data.mail.endpoint,
        mail_zepto_from: r.data.mail.from,
        mail_zepto_from_name: r.data.mail.from_name,
        otp_email_enabled: r.data.mail.otp_email_enabled,
      });
      // Never prefilled — the server does not send it back.
      setApiKey('');
      setClearKey(false);
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.fail_load'), 'danger');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!form || !data) return <div className="empty-state"><div className="spinner"></div></div>;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * `extra` carries the secrets, which are never held in `form` — they are not
   * part of the loaded state and must not survive a reload. The mail panel
   * hands its token through here so both panels save in one request.
   */
  async function save(extra = {}) {
    setBusy(true);
    try {
      const payload = { ...form, ...extra };
      if (clearKey) payload.sms_dlt_api_key_clear = true;
      else if (apiKey.trim()) payload.sms_dlt_api_key = apiKey.trim();

      const res = await platformApi.updateMessaging(payload);
      if (res.data.success) {
        showToast(t('msgg.saved'), 'success');
        await load();
      } else {
        showToast(res.data.error || t('msg.server_error'), 'danger');
      }
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await platformApi.testSms({ phone: testPhone, provider: form.otp_provider });
      setTestResult(res.data);
      showToast(res.data.sent ? t('msgg.test_accepted') : t('msgg.test_refused'),
        res.data.sent ? 'success' : 'danger');
      await load();
    } catch (err) {
      const detail = err?.response?.data?.error || t('msg.network_error');
      setTestResult({ sent: false, detail });
      showToast(detail, 'danger');
    }
    setTesting(false);
  }

  const dlt = data.dlt;
  const ready = data.readiness || {};
  const usingDlt = form.otp_provider === 'jio_dlt';

  // Three states, not two: configured-and-off is a real and useful position to
  // be in, and showing it as "not configured" would send somebody to re-enter
  // credentials that are already correct.
  const status = !dlt.enabled ? { label: t('msgg.st_off'), cls: 'badge-draft' }
    : dlt.missing.length ? { label: t('msgg.st_incomplete'), cls: 'badge-rejected' }
      : { label: t('msgg.st_connected'), cls: 'badge-approved' };

  return (
    <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>

      {/* ── Connector ─────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flex: '0 0 auto',
            background: 'var(--primary-light)', color: 'var(--primary)',
            display: 'grid', placeItems: 'center', fontSize: 19,
          }} aria-hidden="true">✆</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--heading)' }}>{t('msgg.connector')}</span>
              <span className={`badge ${status.cls}`}>{status.label}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 3 }}>{t('msgg.connector_sub')}</div>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '14px 0', borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)', margin: '14px 0 18px',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('msgg.enable_connector')}</div>
            <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 3, lineHeight: 1.5 }}>
              {t('msgg.enable_connector_hint')}
            </div>
          </div>
          <Toggle checked={form.sms_dlt_enabled} onChange={(v) => set('sms_dlt_enabled', v)} />
        </div>

        <div className="card-title" style={{ marginBottom: 14 }}>{t('msgg.params')}</div>

        <div className="form-row">
          <Row label={t('msgg.entity_id')} hint={t('msgg.entity_id_hint')}>
            <input className="form-control" value={form.sms_dlt_entity_id}
              placeholder="1101234567890123456"
              onChange={(e) => set('sms_dlt_entity_id', e.target.value)} />
          </Row>
          <Row label={t('msgg.sender_id')} hint={t('msgg.sender_id_hint')}>
            <input className="form-control" value={form.sms_dlt_sender_id} maxLength={11}
              placeholder="IFQMOT" style={{ textTransform: 'uppercase' }}
              onChange={(e) => set('sms_dlt_sender_id', e.target.value.toUpperCase())} />
          </Row>
        </div>

        <div className="form-row">
          <Row label={t('msgg.template_id')} hint={t('msgg.template_id_hint')}>
            <input className="form-control" value={form.sms_dlt_template_id}
              placeholder="1107161234567890123"
              onChange={(e) => set('sms_dlt_template_id', e.target.value)} />
          </Row>
          <Row
            label={t('msgg.api_key')}
            hint={clearKey ? t('msgg.api_key_clearing')
              : dlt.api_key_set ? t('msgg.api_key_stored') : t('msgg.api_key_none')}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="form-control" type={showKey ? 'text' : 'password'}
                value={apiKey} disabled={clearKey} autoComplete="new-password"
                placeholder={dlt.api_key_set ? '••••••••••••••••' : t('msgg.api_key_ph')}
                onChange={(e) => setApiKey(e.target.value)} />
              <button type="button" className="btn" onClick={() => setShowKey((s) => !s)}
                title={showKey ? t('msgg.hide') : t('msgg.show')} style={{ flex: '0 0 auto' }}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
            {dlt.api_key_set && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={clearKey} style={{ accentColor: 'var(--danger)' }}
                  onChange={(e) => { setClearKey(e.target.checked); if (e.target.checked) setApiKey(''); }} />
                {t('msgg.api_key_clear')}
              </label>
            )}
          </Row>
        </div>

        <Row label={t('msgg.endpoint')} hint={t('msgg.endpoint_hint')}>
          <input className="form-control" value={form.sms_dlt_endpoint}
            placeholder="https://api.jiodlt.com/sms/v1/send"
            onChange={(e) => set('sms_dlt_endpoint', e.target.value)} />
        </Row>

        <Row label={t('msgg.template_text')} hint={t('msgg.template_text_hint')}>
          <textarea className="form-control" rows={3} value={form.sms_dlt_template_text}
            onChange={(e) => set('sms_dlt_template_text', e.target.value)} />
        </Row>

        {dlt.missing.length > 0 && (
          <div style={{
            background: 'var(--warning-light)', color: 'var(--warning)',
            border: '1px solid var(--warning)', borderRadius: 8,
            padding: '10px 12px', fontSize: 12, lineHeight: 1.6, marginBottom: 14,
          }}>
            <b>{t('msgg.incomplete')}</b> {dlt.missing.join(' · ')}
          </div>
        )}

        <button className="btn btn-primary" disabled={busy} onClick={() => save()}>
          {busy ? t('msgg.saving') : t('msgg.save')}
        </button>
      </div>

      {/* ── Test ──────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">{t('msgg.test_title')}</div>
        <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 14, lineHeight: 1.6 }}>
          {t('msgg.test_hint')}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <input className="form-control" style={{ maxWidth: 260 }} value={testPhone}
            placeholder="+91 98765 43210" inputMode="tel"
            onChange={(e) => setTestPhone(e.target.value)} />
          <button className="btn" disabled={testing || !testPhone.trim()} onClick={runTest}>
            {testing ? t('msgg.testing') : t('msgg.test_btn')}
          </button>
        </div>

        {testResult && (
          <div style={{
            marginTop: 14, borderRadius: 8, padding: '11px 13px', fontSize: 12.5, lineHeight: 1.65,
            background: testResult.sent ? 'var(--success-light)' : 'var(--danger-light)',
            color: testResult.sent ? 'var(--success)' : 'var(--danger)',
            border: `1px solid ${testResult.sent ? 'var(--success)' : 'var(--danger)'}`,
          }}>
            <b>{testResult.sent ? t('msgg.test_accepted') : t('msgg.test_refused')}</b>
            {testResult.detail ? <> — {testResult.detail}</> : null}
            {testResult.reference ? <div style={{ marginTop: 4, opacity: .85 }}>{t('msgg.gateway_ref')}: <code>{testResult.reference}</code></div> : null}
            {testResult.note ? <div style={{ marginTop: 6, opacity: .9 }}>{testResult.note}</div> : null}
          </div>
        )}

        {data.last_test?.at && !testResult && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--subtle)' }}>
            {t('msgg.last_tested')}: {fmtDateTime(data.last_test.at)} — {data.last_test.ok ? t('msgg.passed') : t('msgg.failed')}
            {data.last_test.note ? ` (${data.last_test.note})` : ''}
          </div>
        )}
      </div>

      {/* ── One-time-code policy ──────────────────────────────────── */}
      <div className="card">
        <div className="card-title">{t('msgg.otp_title')}</div>
        <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 16, lineHeight: 1.6 }}>
          {t('msgg.otp_hint')}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '13px 0', borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)', marginBottom: 18,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('msgg.otp_enable')}</div>
            <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 3, lineHeight: 1.5 }}>
              {ready.deliverable ? t('msgg.otp_enable_ok') : t('msgg.otp_enable_blocked')}
              {ready.reason ? ` ${ready.reason}` : ''}
            </div>
          </div>
          <Toggle checked={form.otp_enabled} onChange={(v) => set('otp_enabled', v)} />
        </div>

        <div className="form-row">
          <Row label={t('msgg.provider')} hint={usingDlt ? t('msgg.provider_dlt') : t('msgg.provider_other')}>
            <select className="form-control" value={form.otp_provider}
              onChange={(e) => set('otp_provider', e.target.value)}>
              {PROVIDERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </Row>
          <Row label={t('msgg.code_length')} hint={t('msgg.code_length_hint')}>
            <input className="form-control" type="number" min="4" max="8" value={form.otp_length}
              onChange={(e) => set('otp_length', e.target.value)} />
          </Row>
        </div>

        <div className="form-row">
          <Row label={t('msgg.ttl')} hint={t('msgg.ttl_hint')}>
            <input className="form-control" type="number" min="60" max="3600" step="30"
              value={form.otp_ttl_seconds}
              onChange={(e) => set('otp_ttl_seconds', e.target.value)} />
          </Row>
          <Row label={t('msgg.attempts')} hint={t('msgg.attempts_hint')}>
            <input className="form-control" type="number" min="3" max="10" value={form.otp_max_attempts}
              onChange={(e) => set('otp_max_attempts', e.target.value)} />
          </Row>
        </div>

        <Row label={t('msgg.resend')} hint={t('msgg.resend_hint')}>
          <input className="form-control" style={{ maxWidth: 200 }} type="number" min="0" max="600"
            value={form.otp_resend_seconds}
            onChange={(e) => set('otp_resend_seconds', e.target.value)} />
        </Row>

        <button className="btn btn-primary" disabled={busy} onClick={() => save()}>
          {busy ? t('msgg.saving') : t('msgg.save')}
        </button>
      </div>

      {/* ── Email provider ────────────────────────────────────────── */}
      <MailProvider data={data} form={form} set={set} busy={busy} onSave={save} onReload={load} />

      {/* ── Email queue ───────────────────────────────────────────── */}

      {/* ── Recent sends ──────────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">{t('msgg.recent')}</div>
        <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 12, lineHeight: 1.6 }}>
          {t('msgg.recent_hint')}
        </div>
        {data.recent.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 0' }}>{t('msgg.recent_none')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th>{t('msgg.col_when')}</th><th>{t('msgg.col_to')}</th>
                  <th>{t('msgg.col_provider')}</th><th>{t('msgg.col_purpose')}</th>
                  <th>{t('msgg.col_result')}</th><th>{t('msgg.col_detail')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</td>
                    <td><code>{r.recipient}</code></td>
                    <td>{r.provider}</td>
                    <td>{r.purpose}</td>
                    <td>
                      <span className={`badge ${r.ok ? 'badge-approved' : 'badge-rejected'}`}>
                        {r.ok ? t('msgg.accepted') : t('msgg.refused')}
                      </span>
                    </td>
                    <td style={{ fontSize: 11.5, color: 'var(--subtle)' }}>
                      {r.detail || ''}{r.http_status ? ` (${r.http_status})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The platform-wide email provider.
 *
 * Per-tenant SMTP is unchanged and still wins where a customer has set it up —
 * mail that appears to come from the customer's own domain is a feature. This
 * covers the two cases SMTP cannot: mail with no tenant behind it (a code to an
 * email address, a registration acknowledgement) and hosts that block outbound
 * SMTP ports, where a perfectly correct mail server simply cannot be reached.
 */
function MailProvider({ data, form, set, busy, onSave, onReload }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [clearToken, setClearToken] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const mail = data.mail;
  const status = !mail.zepto_enabled ? { label: t('msgg.st_off'), cls: 'badge-draft' }
    : mail.missing.length ? { label: t('msgg.st_incomplete'), cls: 'badge-rejected' }
      : { label: t('msgg.st_connected'), cls: 'badge-approved' };

  async function save() {
    // Handed to the parent so both panels write in one request — two separate
    // saves would let the enable check see a half-applied configuration.
    await onSave(clearToken
      ? { mail_zepto_token_clear: true }
      : token.trim() ? { mail_zepto_token: token.trim() } : {});
    setToken('');
    setClearToken(false);
  }

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await platformApi.testMail({ to: testTo });
      setResult(res.data);
      showToast(res.data.sent ? t('msgg.mail_test_ok') : t('msgg.mail_test_fail'),
        res.data.sent ? 'success' : 'danger');
      await onReload();
    } catch (err) {
      const detail = err?.response?.data?.error || t('msg.network_error');
      setResult({ sent: false, detail });
      showToast(detail, 'danger');
    }
    setTesting(false);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--heading)' }}>{t('msgg.mail_title')}</span>
        <span className={`badge ${status.cls}`}>{status.label}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--subtle)', marginBottom: 16, lineHeight: 1.6 }}>
        {t('msgg.mail_sub')}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0',
        borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: 18,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('msgg.mail_enable')}</div>
          <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 3, lineHeight: 1.5 }}>
            {t('msgg.mail_enable_hint')}
          </div>
        </div>
        <Toggle checked={form.mail_zepto_enabled} onChange={(v) => set('mail_zepto_enabled', v)} />
      </div>

      <div className="form-row">
        <Row label={t('msgg.mail_from')} hint={t('msgg.mail_from_hint')}>
          <input className="form-control" value={form.mail_zepto_from} placeholder="noreply@yourdomain.in"
            onChange={(e) => set('mail_zepto_from', e.target.value)} />
        </Row>
        <Row label={t('msgg.mail_from_name')} hint={t('msgg.mail_from_name_hint')}>
          <input className="form-control" value={form.mail_zepto_from_name}
            onChange={(e) => set('mail_zepto_from_name', e.target.value)} />
        </Row>
      </div>

      <div className="form-row">
        <Row label={t('msgg.mail_endpoint')} hint={t('msgg.mail_endpoint_hint')}>
          <select className="form-control" value={form.mail_zepto_endpoint}
            onChange={(e) => set('mail_zepto_endpoint', e.target.value)}>
            <option value="https://api.zeptomail.in/v1.1/email">India — api.zeptomail.in</option>
            <option value="https://api.zeptomail.com/v1.1/email">Global — api.zeptomail.com</option>
            <option value="https://api.zeptomail.eu/v1.1/email">Europe — api.zeptomail.eu</option>
          </select>
        </Row>
        <Row
          label={t('msgg.mail_token')}
          hint={clearToken ? t('msgg.mail_token_clearing')
            : mail.token_set ? t('msgg.mail_token_stored') : t('msgg.mail_token_none')}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="form-control" type={showToken ? 'text' : 'password'}
              value={token} disabled={clearToken} autoComplete="new-password"
              placeholder={mail.token_set ? '••••••••••••' : 'Zoho-enczapikey …'}
              onChange={(e) => setToken(e.target.value)} />
            <button type="button" className="btn" onClick={() => setShowToken((v) => !v)}
              title={showToken ? t('msgg.hide') : t('msgg.show')} style={{ flex: '0 0 auto' }}>
              {showToken ? 'Hide' : 'Show'}
            </button>
          </div>
          {mail.token_set && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={clearToken} style={{ accentColor: 'var(--danger)' }}
                onChange={(e) => { setClearToken(e.target.checked); if (e.target.checked) setToken(''); }} />
              {t('msgg.mail_token_clear')}
            </label>
          )}
        </Row>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0',
        borderTop: '1px solid var(--border)', marginBottom: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('msgg.mail_otp')}</div>
          <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 3, lineHeight: 1.5 }}>
            {t('msgg.mail_otp_hint')}
          </div>
        </div>
        <Toggle checked={form.otp_email_enabled} onChange={(v) => set('otp_email_enabled', v)} />
      </div>

      {mail.missing.length > 0 && (
        <div style={{
          background: 'var(--warning-light)', color: 'var(--warning)', border: '1px solid var(--warning)',
          borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.6, marginBottom: 14,
        }}>
          <b>{t('msgg.incomplete')}</b> {mail.missing.join(' · ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? t('msgg.saving') : t('msgg.save')}
        </button>
        <input className="form-control" style={{ maxWidth: 240 }} value={testTo} type="email"
          placeholder="you@yourdomain.in" onChange={(e) => setTestTo(e.target.value)} />
        <button className="btn" disabled={testing || !testTo.trim()} onClick={runTest}>
          {testing ? t('msgg.testing') : t('msgg.mail_test_btn')}
        </button>
      </div>

      {result && (
        <div style={{
          marginTop: 14, borderRadius: 8, padding: '11px 13px', fontSize: 12.5, lineHeight: 1.65,
          background: result.sent ? 'var(--success-light)' : 'var(--danger-light)',
          color: result.sent ? 'var(--success)' : 'var(--danger)',
          border: `1px solid ${result.sent ? 'var(--success)' : 'var(--danger)'}`,
        }}>
          <b>{result.sent ? t('msgg.mail_test_ok') : t('msgg.mail_test_fail')}</b>
          {result.detail ? <> — {result.detail}</> : null}
        </div>
      )}

      {mail.last_test?.at && !result && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--subtle)' }}>
          {t('msgg.last_tested')}: {fmtDateTime(mail.last_test.at)} — {mail.last_test.ok ? t('msgg.passed') : t('msgg.failed')}
        </div>
      )}
    </div>
  );
}

/**
 * Email, reported as two separate questions.
 *
 * "Is SMTP configured" and "is anything actually sending" are different, and
 * the second is the one that was silently false: notifications were queued for
 * months with nothing draining them, which no settings screen would ever show.
 * A backlog with a stale oldest-pending timestamp is the symptom, so it is what
 * this panel leads with.
 */
