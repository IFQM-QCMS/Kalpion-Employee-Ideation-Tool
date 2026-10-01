import { isPrivileged, canViewReports, isAdmin, isSuperAdmin, isPlatformAdmin } from './helpers';

/*
 * The same ordered, role-filtered list of main-nav destinations Sidebar.jsx renders -
 * flattened, for the page-to-page prev/next control (PageNav). Kept in one place so the two
 * cannot drift apart: a page reachable from the sidebar should step to and from with the
 * arrows in the same order it appears there.
 */
export function navOrder(user, t) {
  if (!user) return [];
  const role = user.role;
  const isPA     = isPlatformAdmin(role);
  const isSA     = isSuperAdmin(role);
  const isAdm    = isAdmin(role);
  const isPriv   = isPrivileged(role);
  const canReport = canViewReports(role);

  const items = [];
  const add = (path, label, hidden) => { if (!hidden) items.push({ path, label }); };

  if (!isPA) {
    add('/dashboard',  t('nav.dashboard'), isSA);
    add('/my-ideas',   t('nav.my_ideas'),  isSA);
    add('/submit',     t('form.submit_idea'), isSA);
    add('/challenges', t('nav.challenges'), isSA);

    add('/review',    t('nav.review'), !isPriv);
    add('/all-ideas', t('nav.all_ideas'));
    add('/rejected',  t('nav.rejected'));
    add('/board',     t('nav.board'));
    add('/audit',     t('nav.audit'), !canReport);

    add('/leaderboard', t('nav.leaderboard'));
    add('/rewards',     t('nav.rewards'), !canReport);
    add('/analytics',   t('nav.analytics'), !canReport);

    if (isAdm) {
      add('/admin',   t('nav.admin'));
      add('/billing', t('nav.my_billing'));
    }
    if (isSA) {
      add('/super-admin', t('nav.super_admin'));
    }

    add('/user-guide', t('nav.user_guide'));
    add('/help',       t('nav.help'));
    add('/support',    t('nav.support'));
    add('/profile',    t('nav.profile'));
  } else {
    add('/platform',               t('nav.organisations'));
    add('/platform/registrations', t('nav.registrations'));
    add('/platform/tickets',       t('nav.support_tickets'));
    add('/platform/plans',         t('nav.plans'));
    add('/platform/billing',       t('nav.billing'));
    add('/platform/logins',        t('nav.login_activity'));
    add('/platform/settings',      t('nav.platform_settings'));
    add('/user-guide',             t('nav.user_guide'));
  }

  return items;
}

export default navOrder;
