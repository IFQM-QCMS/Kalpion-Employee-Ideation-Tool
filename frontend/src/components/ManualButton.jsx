import { useState } from 'react';
import { useLang } from '../context/LangContext';
import { useToast } from '../context/ToastContext';
import { exportApi } from '../services/api';

/*
 * "Download user manual", on every dashboard.
 *
 * One component rather than three copies, because the three dashboards want
 * identical behaviour and the thing that differs — WHICH manual arrives — is
 * decided by the server from the session role. A component that took the role
 * as a prop would be one careless `role="platform_admin"` away from handing an
 * employee the vendor console's manual.
 *
 * It cannot be a plain <a href>: the endpoint is behind requireAuth, so a bare
 * link would fetch without the token and download a 401 as a file.
 */
export default function ManualButton({ variant = 'outline', size = 'sm' }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      await exportApi.userGuide();
    } catch (e) {
      showToast(
        e?.response?.status === 404 ? t('manual.missing') : t('manual.failed'),
        'danger'
      );
    }
    setBusy(false);
  }

  return (
    <button className={`btn btn-${variant} btn-${size}`} disabled={busy} onClick={download}>
      {busy ? t('manual.preparing') : t('manual.download')}
    </button>
  );
}
