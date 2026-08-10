import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LangContext';
import { isPrivileged, isAdmin, isPlatformAdmin } from '../utils/helpers';

/*
 * The page for an address that does not exist.
 *
 * It used to redirect silently to the landing page, which is the worst of both
 * worlds: somebody following a stale link is dumped somewhere they did not ask
 * for, with no clue whether they mistyped, whether the page moved, or whether
 * they are simply not allowed in. A 404 that says what happened and offers the
 * places they might actually have wanted is a page, not a dead end.
 *
 * The links offered depend on who is signed in. A trainee has no use for a
 * shortcut to the review queue, and a signed-out visitor has no use for any of
 * them — they get the public routes instead.
 */
export default function NotFoundPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const location = useLocation();
  const navigate = useNavigate();

  const role = user?.role;

  const links = !user
    ? [
        ['/', 'Home', 'What the platform does and who it is for'],
        ['/login', 'Sign in', 'Get to your organisation’s workspace'],
        ['/signup', 'Apply for a workspace', 'Register your business with IFQM'],
      ]
    : isPlatformAdmin(role)
      ? [
          ['/platform', 'Organisations', 'Every customer, their usage and their status'],
          ['/platform/registrations', 'Registrations', 'Applications waiting for a decision'],
          ['/platform/plans', 'Plans', 'What IFQM charges, and what each plan includes'],
          ['/platform/tickets', 'Support tickets', 'Everything customers have raised'],
        ]
      : [
          ['/dashboard', 'Dashboard', 'Where your ideas have got to'],
          ['/submit', 'Submit an idea', 'Raise something you have noticed'],
          ['/my-ideas', 'My ideas', 'Everything you have submitted'],
          ['/board', 'Idea board', 'What your colleagues are working on'],
          ...(isPrivileged(role) ? [['/review', 'Review queue', 'Ideas waiting on your decision']] : []),
          ...(isAdmin(role) ? [['/admin', 'Admin panel', 'People, settings and your organisation’s ideas']] : []),
          ['/support', 'Support', 'Ask us — we reply within one working day'],
        ];

  return (
    <div style={{
      minHeight: user ? 'auto' : '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '48px 20px', background: user ? 'transparent' : 'var(--bg)',
    }}>
      <div style={{ maxWidth: 620, width: '100%' }}>
        <div style={{
          fontSize: 72, fontWeight: 800, lineHeight: 1,
          color: 'var(--primary)', opacity: .25, letterSpacing: '-3px',
        }}>404</div>

        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--heading)', margin: '8px 0 10px' }}>
          We could not find that page
        </h1>

        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 6px' }}>
          Nothing is broken and nothing has been lost. The address{' '}
          <code style={{
            background: 'var(--panel-bg)', padding: '2px 7px', borderRadius: 5,
            fontSize: 12.5, overflowWrap: 'anywhere',
          }}>{location.pathname}</code>{' '}
          does not match any page here.
        </p>
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.65, margin: '0 0 24px' }}>
          It is usually a mistyped address, a link from an old email, or a page that has been renamed.
          {!user && ' If you were signed in and got here, your session may have ended — signing in again will fix it.'}
        </p>

        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .6,
                      color: 'var(--subtle)', fontWeight: 700, marginBottom: 10 }}>
          Where you might have been going
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {links.map(([to, label, description]) => (
            <Link key={to} to={to} style={{
              display: 'block', textDecoration: 'none',
              background: 'var(--panel-bg)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '11px 14px',
            }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--primary)' }}>{label} →</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{description}</div>
            </Link>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => navigate(-1)}>← Go back</button>
          <Link className="btn btn-outline btn-sm" to={user ? '/dashboard' : '/'}>
            {user ? 'Dashboard' : 'Home'}
          </Link>
          {user && <Link className="btn btn-outline btn-sm" to="/support">Tell us about this</Link>}
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--subtle)', marginTop: 20, lineHeight: 1.6 }}>
          Still stuck? Raise a support ticket and somebody will answer within one working day.
        </div>
      </div>
    </div>
  );
}
