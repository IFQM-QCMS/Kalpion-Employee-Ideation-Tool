import { useLang } from '../context/LangContext';

// "In QC" - the mark that separates an idea the organisation has APPROVED from one that
// has been handed to the QC tool as tracked work.
export default function QcBadge({ status }) {
  const { t } = useLang();

  // 'duplicate' means QCMS answered 409: it is already there.
  const inQc = status === 'imported' || status === 'duplicate';
  const failed = status === 'failed';
  if (!inQc && !failed) return null;

  const style = inQc
    ? { background:'var(--info-light)', color:'var(--info)', border:'1px solid var(--info-dim)' }
    : { background:'var(--danger-light)', color:'var(--danger)', border:'1px solid var(--danger-dim)' };

  return (
    <span className="badge" style={{ ...style, marginLeft:6, whiteSpace:'nowrap' }}
      title={t(inQc ? 'qc.in_qc_hint' : 'qc.failed_hint')}>
      {t(inQc ? 'qc.in_qc' : 'qc.failed')}
    </span>
  );
}
