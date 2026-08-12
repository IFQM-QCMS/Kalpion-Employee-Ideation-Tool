import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { settingsApi } from '../services/api';
import { fmtDate } from '../utils/helpers';

/*
 * What the customer sees about their own account.
 *
 * Two states worth interrupting somebody for:
 *
 *   The trial is nearly over. A quiet strip at the top of the screen, from a
 *   few days out. Silence until the morning access stops is how a customer ends
 *   up angry at the vendor rather than at their own purchase order.
 *
 *   Access has paused. A full panel that replaces the page, because at that
 *   point every other screen would be empty anyway and an unexplained empty
 *   screen reads as the product being broken.
 *
 * Deliberately not a nag: nothing is shown while there is plenty of time left,
 * and the strip can be dismissed for the session.
 */

const WARN_FROM_DAYS = 7;

export default function BillingBanner() {
  const { user } = useAuth();
  const [sub, setSub] = useState(null);
  const [plan, setPlan] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user || user.role === 'platform_admin') return undefined;
    let cancelled = false;
    settingsApi.subscription()
      .then((res) => {
        if (cancelled || !res.data?.success) return;
        setSub(res.data.subscription || null);
        setPlan(res.data.plan || null);
      })
      .catch(() => { /* a billing read must never break the shell */ });
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  if (!sub || sub.state === 'exempt') return null;

  const days = sub.days_left;
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  // ── Access paused ─────────────────────────────────────────────────────────
  if (sub.blocked) {
    return (
      <div style={{
        background: 'var(--danger-light)', border: '1px solid var(--danger)',
        borderRadius: 12, padding: '18px 20px', marginBottom: 18,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--danger)', marginBottom: 6 }}>
          {sub.state === 'expired' && sub.billing_status === 'trial'
            ? 'Your free trial has ended'
            : 'Your subscription has ended'}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6, maxWidth: 640 }}>
          {sub.ends_at && <>It ran out on <strong>{fmtDate(sub.ends_at)}</strong>. </>}
          Your ideas, your people and your history are all still here and nothing has been deleted.
          Access resumes as soon as payment is recorded.
          {isAdmin
            ? ' You can settle it on the billing page, or raise a support ticket — Support stays open.'
            : ' Please ask your organisation administrator to arrange payment with IFQM.'}
        </div>
        {/* Billing stays reachable while everything else is paused, so this is a
            live route rather than an invitation to send an email. */}
        {isAdmin && (
          <Link className="btn btn-primary btn-sm" to="/billing" style={{ marginTop: 12 }}>
            Go to billing
          </Link>
        )}
        {plan && (
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10 }}>
            Your plan: <strong>{plan.name}</strong> — ₹
            {Number(plan.total_rupees).toLocaleString('en-IN')} {plan.cycle_label.toLowerCase()}
          </div>
        )}
      </div>
    );
  }

  // ── Ending soon ───────────────────────────────────────────────────────────
  if (dismissed || days == null || days > WARN_FROM_DAYS) return null;

  const trial = sub.billing_status === 'trial';
  return (
    <div style={{
      background: 'var(--warning-light)', border: '1px solid var(--warning)',
      borderRadius: 10, padding: '10px 14px', marginBottom: 14,
      display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <div style={{ fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 240 }}>
        <strong>
          {trial ? 'Your free trial' : 'Your subscription'} ends in {days} day{days === 1 ? '' : 's'}
        </strong>
        {sub.ends_at && <> — on {fmtDate(sub.ends_at)}.</>}
        {isAdmin
          ? ' Renew on the billing page to keep access running.'
          : ' Your organisation administrator has been notified.'}
      </div>
      {isAdmin && <Link className="btn btn-sm btn-primary" to="/billing">Billing</Link>}
      <button className="btn btn-sm btn-outline" onClick={() => setDismissed(true)}>Dismiss</button>
    </div>
  );
}
