import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LangContext';
import { isPrivileged, isSuperAdmin, isPlatformAdmin } from '../../utils/helpers';
import { NAV_ICONS } from './Sidebar';

const MORE_ICON = (
  <svg viewBox="0 0 24 24"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
);

/*
 * The phone's bottom bar: the four places a person goes most, one thumb away, plus "More"
 * which opens the full menu. Which four depends on who is signed in - an approver lives in
 * the review queue, an employee in their own ideas, IFQM staff in the console.
 */
function tabsFor(role, t) {
  if (isPlatformAdmin(role)) return [
    { path:'/platform',               icon:NAV_ICONS.platformDash,    label:t('nav.organisations') },
    { path:'/platform/registrations', icon:NAV_ICONS.platformTenants, label:t('nav.registrations') },
    { path:'/platform/tickets',       icon:NAV_ICONS.support,         label:t('nav.support_tickets') },
    { path:'/platform/settings',      icon:NAV_ICONS.admin,           label:t('nav.platform_settings') },
  ];
  if (isSuperAdmin(role)) return [
    { path:'/super-admin', icon:NAV_ICONS.superAdmin,  label:t('nav.super_admin') },
    { path:'/all-ideas',   icon:NAV_ICONS.allIdeas,    label:t('nav.all_ideas') },
    { path:'/board',       icon:NAV_ICONS.board,       label:t('nav.board') },
    { path:'/leaderboard', icon:NAV_ICONS.leaderboard, label:t('nav.leaderboard') },
  ];
  if (isPrivileged(role)) return [
    { path:'/dashboard', icon:NAV_ICONS.dashboard, label:t('nav.dashboard') },
    { path:'/review',    icon:NAV_ICONS.review,    label:t('nav.review') },
    { path:'/submit',    icon:NAV_ICONS.submit,    label:t('nav.submit'), primary:true },
    { path:'/all-ideas', icon:NAV_ICONS.allIdeas,  label:t('nav.all_ideas') },
  ];
  return [
    { path:'/dashboard', icon:NAV_ICONS.dashboard, label:t('nav.dashboard') },
    { path:'/my-ideas',  icon:NAV_ICONS.myIdeas,   label:t('nav.my_ideas') },
    { path:'/submit',    icon:NAV_ICONS.submit,    label:t('nav.submit'), primary:true },
    { path:'/all-ideas', icon:NAV_ICONS.allIdeas,  label:t('nav.all_ideas') },
  ];
}

export default function MobileTabBar({ onMore, menuOpen }) {
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  if (!user) return null;

  const tabs = tabsFor(user.role, t);
  const here = location.pathname;

  return (
    <nav id="mobile-tabbar" aria-label={t('nav.menu')}>
      {tabs.map((tab) => {
        const active = !menuOpen && (here === tab.path || (tab.path !== '/platform' && here.startsWith(tab.path + '/')));
        return (
          <button
            key={tab.path}
            type="button"
            className={`mtab${active ? ' active' : ''}${tab.primary ? ' primary' : ''}`}
            onClick={() => navigate(tab.path)}
            aria-current={active ? 'page' : undefined}
          >
            <span className="mtab-icon">{tab.icon}</span>
            <span className="mtab-label">{tab.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        className={`mtab${menuOpen ? ' active' : ''}`}
        onClick={onMore}
        aria-expanded={menuOpen}
        aria-controls="sidebar"
      >
        <span className="mtab-icon">{MORE_ICON}</span>
        <span className="mtab-label">{t('nav.more')}</span>
      </button>
    </nav>
  );
}
