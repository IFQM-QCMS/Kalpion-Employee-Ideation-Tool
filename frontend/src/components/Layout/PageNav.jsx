import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LangContext';
import { navOrder } from '../../utils/navOrder';

const ArrowLeft = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
  </svg>
);
const ArrowRight = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);

/*
 * A small step-through control, for moving between pages without reopening the sidebar -
 * easier to find and use than the menu for somebody who just wants "back one, forward one"
 * rather than a list of destinations to read and pick from. Follows the exact order
 * Sidebar.jsx renders (see navOrder) so the arrows never surprise anyone who also uses the
 * menu. Renders nothing on a page that is not part of that ordered list - a detail page
 * reached some other way has no sensible "next" to offer.
 */
export default function PageNav() {
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();

  const items = useMemo(() => navOrder(user, t), [user, t]);
  const idx = items.findIndex((i) => i.path === location.pathname);

  if (idx === -1) return null;
  const prev = items[idx - 1];
  const next = items[idx + 1];
  if (!prev && !next) return null;

  return (
    <div className="page-nav" role="navigation" aria-label={t('nav.page_nav_label')}>
      <button type="button" className="page-nav-btn" disabled={!prev}
        onClick={() => prev && navigate(prev.path)}
        aria-label={prev ? t('nav.page_nav_prev_to', { page: prev.label }) : undefined}>
        <ArrowLeft />
        {prev && <span className="page-nav-label">{prev.label}</span>}
      </button>
      <button type="button" className="page-nav-btn page-nav-next" disabled={!next}
        onClick={() => next && navigate(next.path)}
        aria-label={next ? t('nav.page_nav_next_to', { page: next.label }) : undefined}>
        {next && <span className="page-nav-label">{next.label}</span>}
        <ArrowRight />
      </button>
    </div>
  );
}
