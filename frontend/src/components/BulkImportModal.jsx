import { useState, useRef, useEffect } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { userImportApi } from '../services/api';

// Mirrors COLUMNS in backend/src/services/userImportService.js: which sheet columns a NEW
// account needs. The legend under the template button is built from this.
const REQUIRED_COLS = ['employee_id', 'salutation', 'first_name', 'last_name', 'username', 'role', 'phone', 'manager_employee_id'];
const OPTIONAL_COLS = ['email', 'department', 'business_unit', 'location'];

/**
 * Bulk employee import - or, with mode="update", a bulk update of people who already exist:
 * rows matched on employee_id, only the filled cells applied, and nothing done to passwords.
 */
export default function BulkImportModal({ onClose, onImported, mode = 'create' }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const isUpdate = mode === 'update';
  const [result, setResult] = useState(null);   // finished bulk update

  const [file, setFile]       = useState(null);
  const [preview, setPreview] = useState(null);   // dry-run result
  const [job, setJob]         = useState(null);   // running/finished job
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const pollRef = useRef(null);
  const fileRef = useRef(null);

  // Stop polling if the modal closes mid-import (the job keeps running server-side).
  useEffect(() => () => clearInterval(pollRef.current), []);

  async function handleTemplate() {
    try { await userImportApi.downloadTemplate(); }
    catch { showToast(t('msg.network_error'), 'danger'); }
  }

  async function handleFile(f) {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setJob(null);
    setError('');
    setBusy(true);
    try {
      const res = isUpdate ? await userImportApi.previewUpdate(f) : await userImportApi.preview(f);
      setPreview(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.server_error'));
      setFile(null);
    }
    setBusy(false);
  }

  async function handleCommit() {
    if (!file || !preview?.valid_count) return;
    setBusy(true);
    setError('');
    if (isUpdate) {
      // Synchronous: a few hundred UPDATEs, no hashing, no email - there is no job to poll.
      try {
        const res = await userImportApi.applyUpdate(file);
        setResult(res.data);
        showToast(t('import.update_done', { n: res.data.updated, u: res.data.unchanged, e: res.data.invalid_count }), 'success');
        onImported?.();
      } catch (err) {
        setError(err?.response?.data?.error || t('msg.server_error'));
      }
      setBusy(false);
      return;
    }
    try {
      const res = await userImportApi.start(file);
      const id = res.data.job_id;
      setJob({ id, status: 'running', processed_rows: 0, total_rows: preview.valid_count });
      poll(id);
    } catch (err) {
      setError(err?.response?.data?.error || t('msg.server_error'));
      setBusy(false);
    }
  }

  function poll(id) {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await userImportApi.job(id);
        const j = res.data.job;
        setJob({ ...j, id });
        if (j.status === 'completed' || j.status === 'failed') {
          clearInterval(pollRef.current);
          setBusy(false);
          if (j.status === 'completed') {
            showToast(t('imp.done_toast', { n: j.created_count }), 'success');
            onImported?.();
          } else {
            setError(j.error_message || t('msg.server_error'));
          }
        }
      } catch {
        clearInterval(pollRef.current);
        setBusy(false);
        setError(t('msg.network_error'));
      }
    }, 1200);
  }

  const done    = job?.status === 'completed';
  const failed  = job?.status === 'failed';
  const running = job && !done && !failed;
  const pct = running && job.total_rows
    ? Math.min(99, Math.round((job.processed_rows / job.total_rows) * 100))
    : (done ? 100 : 0);

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" style={{ maxWidth:720 }}>
        <div className="modal-header">
          <span>{isUpdate ? t('import.update_title') : t('imp.title')}</span>
          <button className="modal-close" onClick={onClose} disabled={running}>✕</button>
        </div>

        <div className="modal-body" style={{ minHeight:280 }}>
          {error && <div className="alert alert-danger">{error}</div>}

          {/* Step 1: template */}
          {!job && !result && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontSize:13,fontWeight:700,color:'var(--heading)',marginBottom:6 }}>
                {t('imp.step1')}
              </div>
              <p style={{ fontSize:12,color:'var(--subtle)',marginBottom:10,lineHeight:1.6 }}>
                {isUpdate ? t('import.update_sub') : t('imp.step1_desc')}
              </p>
              <button className="btn btn-outline btn-sm" onClick={handleTemplate}>
                ⬇ {t('imp.download_template')}
              </button>
              {/* Which columns matter, said once, next to the template they describe. */}
              {!isUpdate && (
                <div style={{ fontSize:11.5,color:'var(--subtle)',marginTop:8,lineHeight:1.7 }}>
                  <div>{t('import.required_note')}</div>
                  <div><strong>{t('import.required_cols', { cols: REQUIRED_COLS.map(c => `${c} *`).join(', ') })}</strong></div>
                  <div>{t('import.optional_cols', { cols: OPTIONAL_COLS.join(', ') })}</div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: file */}
          {!job && !result && (
            <div style={{ marginBottom:18 }}>
              <div style={{ fontSize:13,fontWeight:700,color:'var(--heading)',marginBottom:6 }}>
                {t('imp.step2')}
              </div>
              <input
                ref={fileRef}
                className="form-control"
                type="file"
                accept=".xlsx,.csv"
                disabled={busy}
                onChange={e => handleFile(e.target.files?.[0] || null)}
              />
              {busy && !preview && (
                <div style={{ marginTop:8,fontSize:12,color:'var(--subtle)' }}>
                  <span className="spinner" style={{ width:12,height:12,display:'inline-block',verticalAlign:'-2px',marginRight:6 }}></span>
                  {t('imp.checking')}
                </div>
              )}
            </div>
          )}

          {/* Result of a bulk update */}
          {result && (
            <div style={{ textAlign:'center',padding:'10px 0' }}>
              <div style={{ fontSize:38,marginBottom:6 }}>✓</div>
              <div style={{ fontSize:15,fontWeight:700,color:'var(--heading)' }}>
                {t('import.update_done', { n: result.updated, u: result.unchanged, e: result.invalid_count })}
              </div>
              {result.errors?.length > 0 && (
                <div style={{ maxHeight:170,overflowY:'auto',border:'1px solid var(--border)',borderRadius:8,marginTop:12,textAlign:'left' }}>
                  <table className="table" style={{ fontSize:11,margin:0 }}>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={i}>
                          <td style={{ width:50,color:'var(--subtle)' }}>#{e.row_number}</td>
                          <td style={{ width:120 }}>{e.employee_id || '-'}</td>
                          <td>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Step 3: preview */}
          {preview && !job && !result && (
            <div>
              <div style={{ fontSize:13,fontWeight:700,color:'var(--heading)',marginBottom:8 }}>
                {t('imp.step3')}
              </div>

              <div style={{ display:'flex',gap:10,marginBottom:12,flexWrap:'wrap' }}>
                <Stat label={isUpdate ? t('import.update_changes') : t('imp.will_create')} value={preview.valid_count} color="#10b981" />
                {isUpdate && <Stat label={t('import.update_unchanged')} value={preview.unchanged_count || 0} color="#94a3b8" />}
                <Stat label={t('imp.will_skip')}   value={preview.invalid_count} color={preview.invalid_count ? '#ef4444' : '#94a3b8'} />
                <Stat label={t('imp.rows_read')}   value={preview.total_rows} color="#4b5563" />
              </div>

              {preview.valid_count > 0 && !isUpdate && (
                <div className="alert alert-warning" style={{ fontSize:12,lineHeight:1.6,marginBottom:12 }}>
                  {t('imp.password_notice')}
                </div>
              )}

              {/* A bulk update's sample lists exactly which details each row changes. */}
              {isUpdate && preview.sample?.length > 0 && (
                <div style={{ overflowX:'auto',marginBottom:12 }}>
                  <table className="table" style={{ fontSize:12 }}>
                    <thead>
                      <tr><th>{t('table.emp_id')}</th><th>{t('import.update_changes')}</th></tr>
                    </thead>
                    <tbody>
                      {preview.sample.map(s => (
                        <tr key={s.employee_id}>
                          <td>{s.employee_id}</td>
                          <td>{Object.entries(s.changes).map(([k, v]) => `${k} → ${v}`).join('; ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!isUpdate && preview.sample?.length > 0 && (
                <div style={{ overflowX:'auto',marginBottom:12 }}>
                  <table className="table" style={{ fontSize:12 }}>
                    <thead>
                      <tr>
                        <th>{t('table.emp_id')}</th><th>{t('table.title')}</th>
                        <th>{t('table.role')}</th><th>{t('imp.temp_password')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map(s => (
                        <tr key={s.employee_id}>
                          <td>{s.employee_id}</td>
                          <td>{s.name}</td>
                          <td>{s.role}</td>
                          {/* Two different things can be in this column, and conflating them would mislead in the worst direction: an admin who sees a blank where a password should be assumes the import is broken, and an admin shown a password for a row that was emailed one goes and reads out a string that was never set. */}
                          <td>
                            {s.password_emailed
                              ? <span style={{ fontSize:11,color:'var(--text-muted)' }}>{t('imp.pw_emailed')}</span>
                              : <code>{s.temp_password}</code>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.invalid_count > 0 && (
                <div>
                  <div style={{ fontSize:12,fontWeight:700,color:'#ef4444',marginBottom:6 }}>
                    {t('imp.skipped_rows')}
                  </div>
                  <div style={{ maxHeight:170,overflowY:'auto',border:'1px solid var(--border)',borderRadius:8 }}>
                    <table className="table" style={{ fontSize:11,margin:0 }}>
                      <tbody>
                        {preview.errors.map((e, i) => (
                          <tr key={i}>
                            <td style={{ width:50,color:'var(--subtle)' }}>#{e.row_number}</td>
                            <td style={{ width:120 }}>{e.employee_id || '-'}</td>
                            <td>{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ fontSize:11,color:'var(--subtle)',marginTop:6 }}>
                    {t('imp.skipped_note')}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4: progress / result */}
          {job && (
            <div style={{ textAlign:'center',padding:'10px 0' }}>
              {running && (
                <>
                  <div style={{ fontSize:13,fontWeight:600,color:'var(--heading)',marginBottom:12 }}>
                    {job.phase === 'inserting' ? t('imp.phase_inserting') : t('imp.phase_hashing')}
                  </div>
                  <div className="progress-bar" style={{ marginBottom:10 }}>
                    <div className="progress-fill" style={{ width:`${pct}%`,transition:'width .4s ease' }}></div>
                  </div>
                  <div style={{ fontSize:12,color:'var(--subtle)' }}>
                    {job.processed_rows || 0} / {job.total_rows || 0} · {pct}%
                  </div>
                  <div style={{ fontSize:11,color:'var(--subtle)',marginTop:10 }}>
                    {t('imp.keep_open')}
                  </div>
                </>
              )}

              {done && (
                <>
                  <div style={{ fontSize:38,marginBottom:6 }}>✓</div>
                  <div style={{ fontSize:15,fontWeight:700,color:'var(--heading)' }}>
                    {t('imp.done', { n: job.created_count })}
                  </div>
                  {job.skipped_count > 0 && (
                    <div style={{ fontSize:12,color:'var(--subtle)',marginTop:8 }}>
                      {t('imp.done_skipped', { n: job.skipped_count })}
                      <div style={{ marginTop:8 }}>
                        <button className="btn btn-outline btn-sm"
                          onClick={() => userImportApi.downloadErrors(job.id)}>
                          ⬇ {t('imp.download_errors')}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="alert alert-warning" style={{ fontSize:12,marginTop:14,textAlign:'left',lineHeight:1.6 }}>
                    {t('imp.tell_employees')}
                  </div>
                </>
              )}

              {failed && (
                <>
                  <div style={{ fontSize:32,marginBottom:6 }}>⚠</div>
                  <div style={{ fontSize:14,fontWeight:700,color:'#ef4444' }}>{t('imp.failed')}</div>
                  <div style={{ fontSize:12,color:'var(--subtle)',marginTop:6 }}>{t('imp.failed_note')}</div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose} disabled={running}>
            {done || failed || result ? t('btn.close') : t('btn.cancel')}
          </button>
          {preview && !job && !result && (
            <button className="btn btn-primary" disabled={busy || !preview.valid_count} onClick={handleCommit}>
              {isUpdate ? t('import.update_apply', { n: preview.valid_count }) : t('imp.create_n', { n: preview.valid_count })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ flex:1,minWidth:120,border:'1px solid var(--border)',borderRadius:8,padding:'10px 12px' }}>
      <div style={{ fontSize:20,fontWeight:800,color }}>{value}</div>
      <div style={{ fontSize:11,color:'var(--subtle)' }}>{label}</div>
    </div>
  );
}
