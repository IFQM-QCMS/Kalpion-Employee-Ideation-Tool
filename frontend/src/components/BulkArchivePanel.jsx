import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';

/*
 * Bulk archive.
 *
 * Filtering a list only changes what one person is looking at. Archiving takes
 * the records out of everybody's default view, and until now had to be done one
 * at a time — which is why nobody did it and the lists kept growing.
 *
 * Two ways to choose: everything currently on screen (whatever filters produced
 * it), or everything older than a date. Both are reversible from the same
 * panel, because an archive you cannot undo is a delete wearing a nicer name.
 *
 * Used by All Ideas for an organisation admin, and by the platform support
 * queue. The caller supplies the request function and the ids on screen; this
 * component owns nothing but the confirmation.
 */
export default function BulkArchivePanel({
  visibleIds = [],
  onRun,                       // ({ ids?, before_date?, archived }) => Promise<{affected}>
  onDone,
  labelKey = 'bulk.ideas',
  extra = null,                // optional extra controls (e.g. include-open tick)
}) {
  const { t } = useLang();
  const { showToast } = useToast();

  const [open, setOpen]     = useState(false);
  const [mode, setMode]     = useState('visible');   // 'visible' | 'before'
  const [before, setBefore] = useState('');
  const [busy, setBusy]     = useState(false);

  async function run(archive) {
    if (mode === 'visible' && !visibleIds.length) {
      showToast(t('bulk.nothing_on_screen'), 'warning');
      return;
    }
    if (mode === 'before' && !before) {
      showToast(t('bulk.pick_date'), 'warning');
      return;
    }

    const count = mode === 'visible' ? visibleIds.length : null;
    const msg = archive
      ? (count !== null
          ? t('bulk.confirm_archive_n').replace('{n}', count)
          : t('bulk.confirm_archive_before').replace('{date}', before))
      : (count !== null
          ? t('bulk.confirm_restore_n').replace('{n}', count)
          : t('bulk.confirm_restore_before').replace('{date}', before));
    if (!window.confirm(msg)) return;

    setBusy(true);
    try {
      const payload = mode === 'visible'
        ? { ids: visibleIds, archived: archive }
        : { before_date: before, archived: archive };
      const res = await onRun(payload);
      const n = res?.data?.affected ?? 0;
      if (res?.data?.success) {
        showToast(res.data.message || t('bulk.done').replace('{n}', n), n ? 'success' : 'info');
        setOpen(false);
        onDone?.();
      } else {
        showToast(res?.data?.error || t('msg.server_error'), 'danger');
      }
    } catch (err) {
      showToast(err?.response?.data?.error || t('msg.network_error'), 'danger');
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        {t('bulk.open')}
      </button>
    );
  }

  return (
    <div className="card" style={{
      marginTop: 12, padding: 14, border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 13.5, color: 'var(--heading)' }}>{t('bulk.title')}</strong>
        <button className="btn btn-sm" onClick={() => setOpen(false)} aria-label={t('btn.close')}>×</button>
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
        {t(labelKey === 'bulk.tickets' ? 'bulk.help_tickets' : 'bulk.help_ideas')}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="radio" name="bulk-mode" checked={mode === 'visible'}
          onChange={() => setMode('visible')} />
        {t('bulk.mode_visible').replace('{n}', visibleIds.length)}
      </label>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
        <input type="radio" name="bulk-mode" checked={mode === 'before'}
          onChange={() => setMode('before')} />
        {t('bulk.mode_before')}
        <input type="date" className="form-control" style={{ width: 170 }}
          value={before} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => { setBefore(e.target.value); setMode('before'); }} />
      </label>

      {extra}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(true)}>
          {busy ? t('msg.loading') : t('bulk.archive_btn')}
        </button>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(false)}>
          {t('bulk.restore_btn')}
        </button>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--subtle)' }}>{t('bulk.reversible_note')}</div>
    </div>
  );
}
