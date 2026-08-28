import { useState, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { platformApi } from '../services/api';
import { fmtDate } from '../utils/helpers';
import { STATUS_STYLE, PRIORITY_COLOR } from './SupportPage';
import BulkArchivePanel from '../components/BulkArchivePanel';
import OrgPicker from '../components/OrgPicker';

/*
 * Platform → Support Tickets. IFQM's queue across every organisation.
 *
 * This is the one screen where a tenant user's name and words appear in the
 * vendor console — because they wrote them to IFQM. It still shows nothing else
 * about them: no directory, no ideas, no files.
 *
 * Internal notes are marked unmistakably. A reply that the customer will read
 * and a note only IFQM sees must never look alike; the cost of confusing them is
 * saying something to a customer you meant to say about them.
 */
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

export default function PlatformTicketsPage() {
  const { t }         = useLang();
  const { showToast } = useToast();

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [status,  setStatus]  = useState('');
  const [priority, setPriority] = useState('');
  const [q,       setQ]       = useState('');
  const [openId,  setOpenId]  = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [archived, setArchived] = useState('');   // '' = live only, '1' = archived only
  /*
   * Tickets ticked by hand.
   *
   * The bulk panel could take everything on screen or everything before a date,
   * which are both all-or-nothing against a filter. Clearing three specific
   * tickets out of a list of forty meant opening each one — the thing bulk
   * archiving was added to stop.
   */
  const [picked, setPicked] = useState(new Set());
  // Which statuses a one-click sweep should take.
  const [sweepStatuses, setSweepStatuses] = useState([]);
  const [sweeping, setSweeping] = useState(false);
  const [includeOpen, setIncludeOpen] = useState(false);

  useEffect(() => { load(); }, [status, priority, archived]);
  // A tick means "this row"; when the rows change, the ticks are meaningless.
  useEffect(() => { setPicked(new Set()); }, [status, priority, archived]);

  async function load() {
    setLoading(true); setError('');
    try {
      const params = {};
      if (status) params.status = status;
      if (priority) params.priority = priority;
      if (q.trim()) params.q = q.trim();
      if (archived) params.archived = archived;
      const res = await platformApi.tickets(params);
      if (res.data.success) setData(res.data);
      else setError(res.data.error || t('msg.fail_load'));
    } catch (err) { setError(err?.response?.data?.error || t('msg.fail_load')); }
    setLoading(false);
  }

  const counts = data?.counts || { total:0, open:0, in_progress:0, urgent:0 };
  const tickets = data?.tickets || [];

  return (
    <>
      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap',marginBottom:18 }}>
        <div>
          <h1 style={{ fontSize:26,fontWeight:800,color:'var(--heading)',margin:0,letterSpacing:'-.5px' }}>{t('pt.title')}</h1>
          <div style={{ fontSize:13,color:'var(--subtle)',marginTop:4 }}>{t('pt.sub')}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>{t('pt.new')}</button>
      </div>

      <div className="kpi-grid">
        {[
          [t('pt.kpi_total'), counts.total, 'var(--primary)'],
          [t('pt.kpi_open'), counts.open, 'var(--info)'],
          [t('pt.kpi_in_progress'), counts.in_progress, 'var(--warning)'],
          [t('pt.kpi_urgent'), counts.urgent, 'var(--danger)'],
        ].map(([label, val, color]) => (
          <div key={label} className="kpi-card" style={{ borderLeftColor:color }}>
            <div className="kpi-body">
              <div className="kpi-val" style={{ color }}>{val}</div>
              <div className="kpi-label">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop:18,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap' }}>
        <input className="form-control" style={{ flex:'1 1 220px',minWidth:180 }} placeholder={t('pt.search_ph')}
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <select className="form-control" style={{ width:160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('sup.all_statuses')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t('sup.status_' + s)}</option>)}
        </select>
        <select className="form-control" style={{ width:150 }} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">{t('pt.all_priorities')}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{t('sup.pri_' + p)}</option>)}
        </select>
        <label style={{ display:'flex',alignItems:'center',gap:6,fontSize:12.5,color:'var(--text-muted)',cursor:'pointer' }}>
          <input type="checkbox" checked={archived === '1'}
            onChange={(e) => setArchived(e.target.checked ? '1' : '')}
            style={{ accentColor:'var(--primary)' }} />
          {t('pt.show_archived')}
        </label>
        <button className="btn btn-outline" onClick={load}>{t('pt.search')}</button>
      </div>

      {/* Clearing out an old queue in one go, rather than opening each ticket.
          Resolved and closed tickets only, unless the operator opts in. */}
      <BulkArchivePanel
        visibleIds={tickets.map((tk) => tk.id)}
        onRun={(payload) => platformApi.bulkArchiveTickets({ ...payload, include_open: includeOpen })}
        onDone={load}
        labelKey="bulk.tickets"
        extra={
          <label style={{ display:'flex',alignItems:'center',gap:8,fontSize:12.5,color:'var(--text-muted)' }}>
            <input type="checkbox" checked={includeOpen} onChange={(e) => setIncludeOpen(e.target.checked)} />
            {t('bulk.include_open')}
          </label>
        } />

      {/*
        Archive by status.
        The question at the end of a quarter is "clear out everything resolved",
        and answering it with the date option means choosing a date that happens
        to separate them — a guess. Naming the status says what is meant.
      */}
      <div className="card" style={{ marginTop:12,padding:'14px 16px' }}>
        <div style={{ fontSize:13,fontWeight:650,color:'var(--heading)',marginBottom:8 }}>
          {t('pt.sweep_title')}
        </div>
        <div style={{ display:'flex',gap:14,flexWrap:'wrap',alignItems:'center' }}>
          {/* Same vocabulary and same labels as the filter above, so the
              status someone filtered by is the status they can sweep. */}
          {STATUSES.map((value) => (
            <label key={value} style={{ display:'flex',alignItems:'center',gap:6,fontSize:12.5 }}>
              <input
                type="checkbox"
                checked={sweepStatuses.includes(value)}
                onChange={(e) => setSweepStatuses(prev =>
                  e.target.checked ? [...prev, value] : prev.filter(v => v !== value))}
              />
              {t('sup.status_' + value)}
            </label>
          ))}
          <button
            className="btn btn-outline btn-sm"
            disabled={!sweepStatuses.length || sweeping}
            onClick={async () => {
              /*
               * Confirmed by count before anything moves. "Archive every open
               * ticket" is a sentence somebody can tick their way into without
               * meaning it, and archiving an unanswered ticket is how a
               * customer gets forgotten.
               */
              const names = sweepStatuses.map(v => t('sup.status_' + v)).join(', ');
              if (!window.confirm(t('pt.sweep_confirm', { statuses: names }))) return;
              setSweeping(true);
              try {
                const res = await platformApi.bulkArchiveTickets({
                  statuses: sweepStatuses, archived: true,
                });
                showToast(res.data?.message || t('bulk.done'), 'success');
                setSweepStatuses([]);
                load();
              } catch (e) {
                showToast(e.response?.data?.error || t('msg.server_error'), 'danger');
              }
              setSweeping(false);
            }}
          >
            {sweeping ? t('msg.loading') : t('pt.sweep_run')}
          </button>
        </div>
      </div>

      {/* Acting on the rows that were ticked. Only shown once something is. */}
      {picked.size > 0 && (
        <div className="card" style={{ marginTop:12,padding:'12px 16px',display:'flex',
          alignItems:'center',gap:12,flexWrap:'wrap' }}>
          <span style={{ fontSize:13,fontWeight:600 }}>
            {t('pt.n_selected', { n: picked.size })}
          </span>
          <button className="btn btn-primary btn-sm" onClick={async () => {
            /*
             * Archiving an unanswered ticket is how a customer gets forgotten,
             * so the server leaves open ones alone by default. Ticking a row is
             * a clear enough choice to override that — but not silently: if
             * some of the ticked tickets are still awaiting an answer, say so
             * and let the operator decide, rather than either dropping them
             * from the count or filing them away without a word.
             */
            const unanswered = tickets.filter(
              (tk) => picked.has(tk.id) && !['resolved', 'closed'].includes(tk.status));
            if (unanswered.length && !window.confirm(
              t('pt.archive_open_confirm', { n: unanswered.length }))) return;
            try {
              const res = await platformApi.bulkArchiveTickets({
                ids: [...picked], archived: archived !== '1', include_open: true,
              });
              showToast(res.data?.message || t('bulk.done'), 'success');
              setPicked(new Set());
              load();
            } catch (e) {
              showToast(e.response?.data?.error || t('msg.server_error'), 'danger');
            }
          }}>
            {archived === '1' ? t('pt.restore_selected') : t('pt.archive_selected')}
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setPicked(new Set())}>
            {t('bulk.clear')}
          </button>
        </div>
      )}

      {loading && <div className="empty-state"><div className="spinner"></div></div>}
      {error   && <div className="alert alert-danger">{error}</div>}

      {!loading && !error && (
        <div className="card" style={{ marginTop:18,overflowX:'auto' }}>
          {!tickets.length ? <div className="empty-state">{t('pt.none')}</div> : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width:34 }}>
                    <input
                      type="checkbox"
                      title={t('review.select_all')}
                      checked={tickets.length > 0 && picked.size === tickets.length}
                      onChange={(e) => setPicked(e.target.checked
                        ? new Set(tickets.map(x => x.id))
                        : new Set())}
                    />
                  </th>
                  <th>{t('sup.col_ticket')}</th>
                  <th>{t('pa.col_company')}</th>
                  <th>{t('sup.col_subject')}</th>
                  <th>{t('sup.col_raised_by')}</th>
                  <th>{t('sup.col_priority')}</th>
                  <th>{t('table.status')}</th>
                  <th>{t('sup.col_updated')}</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((tk) => (
                  <tr key={tk.id} style={{ cursor:'pointer' }} onClick={() => setOpenId(tk.id)}>
                    {/* stopPropagation: the row opens the ticket, and ticking
                        the box must not do that as well. */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={picked.has(tk.id)}
                        onChange={(e) => setPicked(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(tk.id); else next.delete(tk.id);
                          return next;
                        })}
                      />
                    </td>
                    <td style={{ fontWeight:700,whiteSpace:'nowrap' }}>{tk.ticket_code}</td>
                    <td style={{ fontSize:12 }}>{tk.tenant_slug || '—'}</td>
                    <td>
                      {tk.subject}
                      {tk.raised_by === 'platform' && (
                        <span style={{ marginLeft:8,fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:20,background:'var(--primary-light)',color:'var(--primary)' }}>
                          {t('pt.outbound')}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize:12 }}>
                      {tk.requester_name}
                      {tk.requester_email && <div style={{ fontSize:11,color:'var(--subtle)' }}>{tk.requester_email}</div>}
                    </td>
                    <td style={{ color:PRIORITY_COLOR[tk.priority],fontWeight:600,fontSize:12 }}>{t('sup.pri_' + tk.priority)}</td>
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

      {openId && <PlatformThread id={openId} t={t} showToast={showToast} onClose={() => { setOpenId(null); load(); }} />}
      {showNew && <OutboundModal t={t} onClose={() => setShowNew(false)} onCreated={(c) => { setShowNew(false); showToast(`${t('sup.raised_ok')} ${c}`,'success'); load(); }} />}
    </>
  );
}

function PlatformThread({ id, onClose, t, showToast }) {
  const [data, setData]     = useState(null);
  const [reply, setReply]   = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy]     = useState(false);

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      const res = await platformApi.ticket(id);
      if (res.data.success) setData(res.data);
    } catch { showToast(t('msg.fail_load'), 'danger'); }
  }

  async function send() {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      const res = await platformApi.ticketReply(id, reply, internal);
      if (res.data.success) { setReply(''); setInternal(false); await load(); }
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  async function patch(body) {
    setBusy(true);
    try {
      const res = await platformApi.ticketUpdate(id, body);
      if (res.data.success) await load();
      else showToast(res.data.error || t('msg.server_error'), 'danger');
    } catch (err) { showToast(err?.response?.data?.error || t('msg.network_error'), 'danger'); }
    setBusy(false);
  }

  const tk = data?.ticket;

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:680 }}>
        <div className="modal-header">
          <span>{tk ? `${tk.ticket_code} · ${tk.subject}` : '…'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!data ? <div className="empty-state"><div className="spinner"></div></div> : (
            <>
              <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:12 }}>
                {t('pt.from')} <strong>{tk.requester_name}</strong>
                {tk.requester_email ? ` (${tk.requester_email})` : ''} · {tk.tenant_slug} · {fmtDate(tk.created_at)}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>{t('table.status')}</label>
                  <select className="form-control" value={tk.status} disabled={busy}
                    onChange={(e) => patch({ status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{t('sup.status_' + s)}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>{t('sup.col_priority')}</label>
                  <select className="form-control" value={tk.priority} disabled={busy}
                    onChange={(e) => patch({ priority: e.target.value })}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{t('sup.pri_' + p)}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ maxHeight:300,overflowY:'auto',margin:'10px 0 14px' }}>
                {data.messages.map((m) => (
                  <div key={m.id} style={{
                    marginBottom:10,padding:'10px 12px',borderRadius:'var(--r)',
                    background: m.is_internal ? 'var(--warning-light)' : (m.author_type === 'platform' ? 'var(--primary-light)' : 'var(--bg)'),
                    border: m.is_internal ? '1px dashed var(--warning)' : '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize:11,fontWeight:700,color:'var(--heading)',marginBottom:4 }}>
                      {m.author_name}
                      {m.is_internal && (
                        <span style={{ marginLeft:8,fontSize:9,fontWeight:800,padding:'2px 6px',borderRadius:4,background:'var(--warning)',color:'#fff',textTransform:'uppercase' }}>
                          {t('pt.internal')}
                        </span>
                      )}
                      <span style={{ fontWeight:400,color:'var(--subtle)',marginLeft:8 }}>{fmtDate(m.created_at)}</span>
                    </div>
                    <div style={{ fontSize:13,whiteSpace:'pre-wrap',lineHeight:1.6 }}>{m.body}</div>
                  </div>
                ))}
              </div>

              <div className="form-group">
                <label>{internal ? t('pt.internal_note') : t('pt.public_reply')}</label>
                <textarea className="form-control" rows={3} value={reply} onChange={(e) => setReply(e.target.value)}
                  style={internal ? { borderColor:'var(--warning)',background:'var(--warning-light)' } : undefined} />
              </div>
              <label style={{ display:'flex',alignItems:'center',gap:8,fontSize:12,marginBottom:12,cursor:'pointer' }}>
                <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)}
                  style={{ accentColor:'var(--warning)' }} />
                {t('pt.mark_internal')}
              </label>
              <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={send}>
                {internal ? t('pt.save_note') : t('sup.send')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OutboundModal({ onClose, onCreated, t }) {
  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody]       = useState('');
  const [priority, setPriority] = useState('normal');
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    platformApi.tenants()
      .then((r) => setTenants(r.data.tenants || []))
      .catch(() => setError(t('msg.fail_load')));
  }, []);

  async function submit() {
    if (!tenantId || !subject.trim() || !body.trim()) { setError(t('sup.required')); return; }
    setSaving(true); setError('');
    try {
      const res = await platformApi.ticketCreate({ tenant_id: Number(tenantId), subject, body, priority });
      if (res.data.success) onCreated(res.data.ticket_code);
      else setError(res.data.error || t('msg.server_error'));
    } catch (err) { setError(err?.response?.data?.error || t('msg.server_error')); }
    setSaving(false);
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth:520 }}>
        <div className="modal-header">
          <span>{t('pt.new')}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <div style={{ fontSize:12,color:'var(--subtle)',marginBottom:12 }}>{t('pt.new_hint')}</div>
          <div className="form-group">
            <label>{t('pt.to_org')} *</label>
            {/* A typeahead, not a <select>. The dropdown listed every
                organisation at once, which is fine at five and unusable at a
                thousand — there is no way to search a native option list. */}
            <OrgPicker orgs={tenants} value={tenantId} onChange={setTenantId}
              placeholder={t('pt.to_org_ph')} />
          </div>
          <div className="form-group">
            <label>{t('sup.col_subject')} *</label>
            <input className="form-control" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="form-group">
            <label>{t('sup.col_priority')}</label>
            <select className="form-control" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{t('sup.pri_' + p)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{t('sup.message')} *</label>
            <textarea className="form-control" rows={5} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>{t('btn.cancel')}</button>
          <button className="btn btn-primary" disabled={saving} onClick={submit}>{saving ? t('admin.saving') : t('sup.send')}</button>
        </div>
      </div>
    </div>
  );
}
