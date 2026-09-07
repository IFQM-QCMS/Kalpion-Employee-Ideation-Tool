import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// The browser tab title, and the description a shared link shows.

const META = {
  // The home page leads with the brand.
  '/':        ['Kalpion - turn shop-floor ideas into measured improvements',
               'Employee ideation software for Indian MSMEs. Collect ideas, route them through your own approval chain, and track what each one saved. 14-day free trial.'],
  '/login':   ['Sign in', 'Sign in to your organisation’s IFQM ideation workspace.'],
  '/signup':  ['Apply for a workspace',
               'Register your business with IFQM. Corporate email required; every application is reviewed before a workspace is created.'],

  '/dashboard':    ['Dashboard'],
  '/my-ideas':     ['My ideas'],
  '/submit':       ['Submit an idea'],
  '/review':       ['Review queue'],
  '/all-ideas':    ['All ideas'],
  '/rejected':     ['Rejected ideas'],
  '/board':        ['Idea board'],
  '/challenges':   ['Challenges'],
  '/leaderboard':  ['Leaderboard'],
  '/analytics':    ['Analytics'],
  '/audit':        ['Audit trail'],
  '/admin':        ['Admin panel'],
  '/super-admin':  ['Organisation hierarchy'],
  '/profile':      ['My profile'],
  '/support':      ['Support'],
  '/help':         ['Help and frequently asked questions',
                    'How to submit an idea, what happens to it next, and who can see what.'],

  '/platform':                ['Organisations'],
  '/platform/registrations':  ['Registrations'],
  '/platform/tickets':        ['Support tickets'],
  '/platform/settings':       ['Platform settings'],
  '/platform/logins':         ['Login activity'],
  '/platform/plans':          ['Plans'],
};

const SUFFIX = 'Kalpion';

function setMeta(name, content) {
  if (!content) return;
  let tag = document.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export default function PageMeta() {
  const { pathname } = useLocation();

  useEffect(() => {
    const entry = META[pathname];

    // A path not in the table is either a detail page or a mistyped address.
    const [title, description] = entry || [null, null];

    // A title that already opens with the brand is not given it twice.
    const brandLed = title && title.startsWith(SUFFIX);
    document.title = title ? (brandLed ? title : `${title} · ${SUFFIX}`) : SUFFIX;
    if (description) setMeta('description', description);

    // A page behind the sign-in must never be indexed, whatever a crawler does with the
    // client-side route.
    const publicPage = ['/', '/login', '/signup', '/reset-password'].includes(pathname);
    setMeta('robots', publicPage ? 'index, follow' : 'noindex, nofollow');
  }, [pathname]);

  return null;
}
