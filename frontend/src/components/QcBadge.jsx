import { useLang } from '../context/LangContext';

/*
 * "In QC" — the mark that separates an idea the organisation has APPROVED from
 * one that has been handed to the QC tool as tracked work.
 *
 * They were indistinguishable on every screen. Both showed a single green
 * "Approved" badge, so the only way to find out whether an approved idea had
 * actually been forwarded was to open the org admin's Approved Ideas tab, which
 * ordinary reviewers cannot reach. That is the difference between "we said yes"
 * and "it is now somebody's job", and it is the question people were asking of
 * the list.
 *
 * Deliberately a SECOND badge rather than a replacement status. Approval is a
 * workflow decision; forwarding is a delivery fact about the same idea, and it
 * can fail and be retried without the approval changing. Folding it into
 * `status` would have meant a new enum value that the review queue, the
 * analytics status split and the QCMS push filter would each have to special-
 * case — and an idea whose push failed would have lost its Approved state.
 *
 * Renders nothing at all unless the idea reached QCMS, so it can be dropped
 * beside a status badge anywhere without disturbing rows that predate the
 * integration or belong to organisations that do not use it.
 */
export default function QcBadge({ status }) {
  const { t } = useLang();

  // 'duplicate' means QCMS answered 409: it is already there. That is the same
  // end state as 'imported' from the reader's point of view, and showing it as
  // anything else would send somebody chasing a problem that does not exist.
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
