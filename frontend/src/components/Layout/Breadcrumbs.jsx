import { Link, useLocation } from 'react-router-dom';
import { useLang } from '../../context/LangContext';

/*
 * Where you are, and how to get back one step.
 *
 * Only drawn where it earns its place — a page nested under something else. On
 * a top-level screen the trail would read "Home / Dashboard", which is a line
 * of furniture telling somebody what the highlighted sidebar item already told
 * them.
 *
 * The trail is built from the route rather than from navigation history, so it
 * is the same whether somebody clicked through, followed a link from an email,
 * or typed the address.
 */

// Section a path belongs under, and what that section is called.
const SECTIONS = [
  ['/platform/', { to: '/platform', key: 'nav.platform' }],
  ['/admin/', { to: '/admin', key: 'nav.admin' }],
];

// Pages worth naming in a trail, with the parent they sit under.
const TRAILS = {
  '/platform/registrations': [['/platform', 'nav.platform'], [null, 'nav.registrations']],
  '/platform/tickets':       [['/platform', 'nav.platform'], [null, 'nav.support_tickets']],
  '/platform/settings':      [['/platform', 'nav.platform'], [null, 'nav.platform_settings']],
  '/platform/logins':        [['/platform', 'nav.platform'], [null, 'nav.login_activity']],
  '/platform/plans':         [['/platform', 'nav.platform'], [null, 'nav.plans']],
  '/rejected':               [['/all-ideas', 'nav.all_ideas'], [null, 'nav.rejected']],
  '/submit':                 [['/my-ideas', 'nav.my_ideas'], [null, 'form.submit_idea']],
};

export default function Breadcrumbs() {
  const { t } = useLang();
  const { pathname } = useLocation();

  let trail = TRAILS[pathname];

  // A detail page — /platform/tenants/7 — is not in the table by name, so its
  // section is worked out from the prefix.
  if (!trail) {
    const section = SECTIONS.find(([prefix]) => pathname.startsWith(prefix));
    if (!section) return null;
    const [, parent] = section;
    if (pathname === parent.to) return null;
    trail = [[parent.to, parent.key], [null, null]];
  }

  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
      <ol style={{
        listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 6, margin: 0, padding: 0, fontSize: 12.5, color: 'var(--text-muted)',
      }}>
        {trail.map(([to, key], i) => {
          const label = key ? t(key) : 'Details';
          const last = i === trail.length - 1;
          return (
            <li key={`${to || 'here'}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {to && !last
                ? <Link to={to} style={{ color: 'var(--primary)', textDecoration: 'none' }}>{label}</Link>
                : <span aria-current={last ? 'page' : undefined}
                    style={{ color: 'var(--text)', fontWeight: 600 }}>{label}</span>}
              {!last && <span aria-hidden="true" style={{ color: 'var(--subtle)' }}>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
