import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { supportApi } from '../services/api';
import { isAdmin, isSuperAdmin, fmtDate } from '../utils/helpers';

// Support - the tenant's side of the channel to IFQM.
export const STATUS_STYLE = {
  open:        { background:'var(--info-light)',    color:'var(--info)' },
  in_progress: { background:'var(--warning-light)', color:'var(--warning)' },
  waiting:     { background:'var(--warning-light)', color:'var(--warning)' },
  resolved:    { background:'var(--success-light)', color:'var(--success)' },
  closed:      { background:'var(--bg)',            color:'var(--subtle)' },
};

export const PRIORITY_COLOR = {
  urgent:'var(--danger)', high:'var(--warning)', normal:'var(--subtext)', low:'var(--subtle)',
};

export default function SupportPage() {
  const { user }      = useAuth();
  const { t }         = useLang();
  const { showToast } = useToast();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [status,  setStatus]  = useState('');
  const [openId,  setOpenId]  = useState(null);
  const [showNew, setShowNew] = useState(false);

  const orgWide = isAdmin(user?.role) || isSuperAdmin(user?.role);

  useEffect(() => { load(); }, [status]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await supportApi.list(status ? { status } : undefined);
      if (res.data.success) setTickets(res.data.tickets || []);
      else setError(res.data.error || t('msg.fail_load'));
    } catch (err) { setError(err?.response?.data?.error || t('msg.fail_load')); }
    setLoading(false);
  }

  return (
    <>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap',marginBottom:18 }}>
        <div>
          <h1 style={{ fontSize:22,fontWeight:800,color:'var(--heading)',margin:0 }}>{t('sup.title')}</h1>
          <div style={{ fontSize:12,color:'var(--subtle)',marginTop:4 }}>
            {orgWide ? t('sup.sub_admin') : t('sup.sub_user')}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>{t('sup.raise')}</button>
      </div>

      <div className="card" style={{ display:'flex',gap:10,alignItems:'center',flexWrap:'wrap' }}>
        <select className="form-control" style={{ width:180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('sup.all_statuses')}</option>
          {['open','in_progress','waiting','resolved','closed'].map((s) => (
            <option key={s} value={s}>{t('sup.status_' + s)}</option>
          ))}
        </select>
      </div>

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && (
        <div className="card" style={{ marginTop:16,overflowX:'auto' }}>
          {!tickets.length ? (
            <div className="empty-state">{t('sup.none')}</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t('sup.col_ticket')}</th>
                  <th>{t('sup.col_subject')}</th>
                  {orgWide && <th>{t('sup.col_raised_by')}</th>}
                  <th>{t('sup.col_priority')}</th>
                  <th>{t('table.status')}</th>
                  <th>{t('sup.col_updated')}</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((tk) => (
                  <tr key={tk.id} style={{ cursor:'pointer' }} onClick={() => setOpenId(tk.id)}>
                    <td style={{ fontWeight:700,whiteSpace:'nowrap' }}>{tk.ticket_code}</td>
                    <td>
                      {tk.subject}
                      {tk.raised_by === 'platform' && (
                        <span style={{ marginLeft:8,fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:20,background:'var(--primary-light)',color:'var(--primary)' }}>
                          {t('sup.from_ifqm')}
                        </span>
                      )}
                      <span style={{ marginLeft:8,fontSize:11,color:'var(--subtle)' }}>· {tk.message_count}</span>
                    </td>
                    {orgWide && <td style={{ fontSize:12 }}>{tk.requester_name}</td>}
                    <td style={{ color:PRIORITY_COLOR[tk.priority],fontWeight:600,fontSize:12 }}>
                      {t('sup.pri_' + tk.priority)}
                    </td>
                    <td>
                      <span style={{ ...STATUS_STYLE[tk.status],fontSize:10,padding:'3px 9px',borderRadius:20,fontWeight:700,textTransform:'uppercase' }}>
                        {t('sup.status_' + tk.status)}
                      </span>
                    </td>
                    <td style={{ fontSize:12,color:'var(--subtext)',whiteSpace:'nowrap' }}>{fmtDate(tk.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showNew && (
        <NewTicketModal
          t={t}
          onClose={() => setShowNew(false)}
          onCreated={(code) => { setShowNew(false); showToast(`${t('sup.raised_ok')} ${code}`, 'success'); load(); }}
        />
      )}
      {openId && (
        <TicketThreadModal id={openId} t={t} showToast={showToast} onClose={() => { setOpenId(null); load(); }} />
      )}
    </>
  );
}

function NewTicketModal({ onClose, onCreated, t }) {
  const [subject, setSubject]   = useState('');
  const [body, setBody]         = useState('');
  const [category, setCategory] = useState('question');
  const [priority, setPriority] = useState('normal');
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);

  async function submit() {
    if (!subject.trim() || !body.trim()) { setError(t('sup.required')); return; }
    setSaving(true); setError('');
    try {
      const res = await supportApi.create({ subject, body, category, priority });
      if (res.data.success) onCreated(res.data.ticket_code);
      else setError(res.data.error || t('msg.server_error'));
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.server_error'));
    }
    setSaving(false);
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:520 }}>
        <div className="modal-header">
          <span>{t('sup.raise')}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-group">
            <label>{t('sup.col_subject')} *</label>
            <input className="form-control" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t('sup.category')}</label>
              <select className="form-control" value={category} onChange={(e) => setCategory(e.target.value)}>
                {['question','bug','access','feature','other'].map((c) => (
                  <option key={c} value={c}>{t('sup.cat_' + c)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{t('sup.col_priority')}</label>
              <select className="form-control" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {['low','normal','high','urgent'].map((p) => (
                  <option key={p} value={p}>{t('sup.pri_' + p)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>{t('sup.message')} *</label>
            <textarea className="form-control" rows={6} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div style={{ fontSize:11,color:'var(--subtle)',lineHeight:1.6 }}>{t('sup.disclosure')}</div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>
            {saving ? t('admin.saving') : t('sup.send')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TicketThreadModal({ id, onClose, t, showToast }) {
  const [data, setData]   = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy]   = useState(false);

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      const res = await supportApi.get(id);
      if (res.data.success) setData(res.data);
    } catch { showToast(t('msg.fail_load'), 'danger'); }
  }

  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const res = await supportApi.reply(id, reply);
      if (res.data.success) { setReply(''); await load(); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  async function close() {
    setBusy(true);
    try {
      await supportApi.close(id);
      showToast(t('sup.closed_ok'), 'success');
      await load();
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  const tk = data?.ticket;

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:640 }}>
        <div className="modal-header">
          <span>{tk ? `${tk.ticket_code} · ${tk.subject}` : '...'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!data ? <div className="empty-state"><div className="spinner"></div></div> : (
            <>
              <div style={{ display:'flex',gap:8,alignItems:'center',marginBottom:14,flexWrap:'wrap' }}>
                <span style={{ ...STATUS_STYLE[tk.status],fontSize:10,padding:'3px 9px',borderRadius:20,fontWeight:700,textTransform:'uppercase' }}>
                  {t('sup.status_' + tk.status)}
                </span>
                <span style={{ fontSize:12,color:PRIORITY_COLOR[tk.priority],fontWeight:600 }}>{t('sup.pri_' + tk.priority)}</span>
                <span style={{ fontSize:12,color:'var(--subtle)' }}>· {t('sup.cat_' + tk.category)}</span>
              </div>

              <div style={{ maxHeight:320,overflowY:'auto',marginBottom:14 }}>
                {data.messages.map((m) => (
                  <div key={m.id} style={{
                    marginBottom:10,padding:'10px 12px',borderRadius:'var(--r)',
                    background: m.author_type === 'platform' ? 'var(--primary-light)' : 'var(--bg)',
                    border:'1px solid var(--border)',
                  }}>
                    <div style={{ fontSize:11,fontWeight:700,color:'var(--heading)',marginBottom:4 }}>
                      {m.author_type === 'platform' ? `${t('sup.ifqm_support')} · ${m.author_name}` : m.author_name}
                      <span style={{ fontWeight:400,color:'var(--subtle)',marginLeft:8 }}>{fmtDate(m.created_at)}</span>
                    </div>
                    <div style={{ fontSize:13,whiteSpace:'pre-wrap',lineHeight:1.6 }}>{m.body}</div>
                  </div>
                ))}
              </div>

              {tk.status === 'closed' ? (
                <div style={{ fontSize:12,color:'var(--subtle)' }}>{t('sup.closed_note')}</div>
              ) : (
                <>
                  <div className="form-group">
                    <label>{t('sup.your_reply')}</label>
                    <textarea className="form-control" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
                  </div>
                  <div style={{ display:'flex',gap:8 }}>
                    <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={send}>{t('sup.send')}</button>
                    <button className="btn btn-outline" disabled={busy} onClick={close}>{t('sup.close_ticket')}</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
