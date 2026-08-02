import { Link } from 'react-router-dom';

/*
  Placeholder for organisation self-signup — intentionally empty for now.

  When it is built, this is where an MSME owner creates their own tenant without
  a platform admin doing it by hand: organisation name → slug → admin account,
  hitting the same provisioning path as backend/scripts/provision-tenant.js
  (see platformService.createTenant, which already does exactly this work behind
  a platform-admin login).

  Until then the page is honest about it rather than showing a form that throws.
*/
export default function SignupPage() {
  return (
    <div className="ifqm-signup">
      <style>{`
        .ifqm-signup{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
          background:var(--bg);color:var(--text);font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif}
        .ifqm-signup .box{width:100%;max-width:420px;display:flex;flex-direction:column;gap:16px;text-align:center}
        .ifqm-signup .brand{display:flex;align-items:center;justify-content:center;gap:11px}
        .ifqm-signup .brand img{height:44px;background:#fff;border-radius:11px;padding:6px 10px;object-fit:contain;
          box-shadow:0 8px 26px rgba(79,70,229,.18)}
        .ifqm-signup .brand span{font-size:18px;font-weight:800;color:var(--heading);letter-spacing:-.02em}
        .ifqm-signup h1{font-size:24px;font-weight:800;color:var(--heading);letter-spacing:-.02em;margin:6px 0 0}
        .ifqm-signup p{font-size:14px;color:var(--text-muted);line-height:1.6;margin:0}
        .ifqm-signup .actions{display:flex;flex-direction:column;gap:10px;margin-top:6px}
        .ifqm-signup .btn{display:block;padding:12px;border-radius:12px;font-size:14px;font-weight:650;
          text-decoration:none;transition:filter .16s,transform .16s,border-color .16s}
        .ifqm-signup .primary{background:var(--primary);color:var(--on-primary)}
        .ifqm-signup .primary:hover{filter:brightness(1.05);transform:translateY(-1px)}
        .ifqm-signup .ghost{background:var(--surface);color:var(--text);border:1px solid var(--border)}
        .ifqm-signup .ghost:hover{border-color:var(--border-strong)}
      `}</style>

      <div className="box">
        <div className="brand">
          <img src="/assets/ifqm-logo.png" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
          <span>IFQM</span>
        </div>
        <h1>Self-signup is on the way</h1>
        <p>
          Workspaces are still created for you. Tell us about your organisation and
          we will set it up — usually the same day.
        </p>
        <div className="actions">
          <Link className="btn primary" to="/login">Sign in to an existing workspace</Link>
          <Link className="btn ghost" to="/">Back to the overview</Link>
        </div>
      </div>
    </div>
  );
}
