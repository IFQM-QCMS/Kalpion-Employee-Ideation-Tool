import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useBranding } from '../../context/BrandingContext';
import { useLang } from '../../context/LangContext';
import { isPrivileged, isAdmin, isSuperAdmin, isPlatformAdmin, formatRole } from '../../utils/helpers';

const NAV_ICONS = {
  dashboard: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  myIdeas: <svg viewBox="0 0 24 24"><path d="M9 21h6M12 3a6 6 0 016 6c0 2.2-1.1 3.8-2.5 5L15 16H9l-.5-2C7 12.8 6 11.2 6 9a6 6 0 016-6z"/></svg>,
  submit: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
  challenges: <svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M17 3h3l-1 5a4 4 0 01-4 3M7 3H4l1 5a4 4 0 004 3"/><path d="M7 11a5 5 0 0010 0V3H7v8z"/><line x1="12" y1="11" x2="12" y2="7"/></svg>,
  review: <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/><polyline points="9 14 11 16 15 12"/></svg>,
  allIdeas: <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none"/></svg>,
  board: <svg viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>,
  audit: <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  leaderboard: <svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M17 3h3l-1 5a4 4 0 01-4 3M7 3H4l1 5a4 4 0 004 3"/><path d="M7 11a5 5 0 0010 0V3H7v8z"/></svg>,
  analytics: <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  admin: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 115 19.07M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>,
  superAdmin: <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  platformDash: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>,
  platformTenants: <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  profile: <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>,
  support: <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
};

export default function Sidebar({ collapsed, onToggle }) {
  const { user } = useAuth();
  const { orgName, logo } = useBranding();
  const { t }    = useLang();
  const navigate  = useNavigate();
  const location  = useLocation();

  if (!user) return null;

  const role   = user.role;
  const isPA   = isPlatformAdmin(role);
  const isSA   = isSuperAdmin(role);
  const isAdm  = isAdmin(role);
  const isPriv = isPrivileged(role);

  const active = (path) => location.pathname === path;

  const NavItem = ({ path, icon, label, dataLabel, hidden }) => {
    if (hidden) return null;
    return (
      <div
        className={`nav-item${active(path) ? ' active' : ''}`}
        data-label={dataLabel || label}
        onClick={() => navigate(path)}
      >
        <span className="icon">{icon}</span>
        <span className="label">{label}</span>
      </div>
    );
  };

  return (
    <div id="sidebar" className={collapsed ? 'collapsed' : ''}>
      {/*
        * The organisation's own logo and name, not IFQM's — a TVS employee sees
        * TVS here, an L&T employee sees L&T. Both fall back to the IFQM mark and
        * the app name until that tenant's admin has set their branding, and for
        * platform admins, who sit outside any tenant. The login page keeps the
        * IFQM logo deliberately: there is no tenant resolved before sign-in.
        */}
      <div className="sidebar-logo" onClick={onToggle} style={{ cursor:'pointer' }} title={orgName}>
        <img
          src={logo}
          alt={orgName}
          style={{ height:28,flexShrink:0,background:'#fff',borderRadius:6,padding:'3px 8px',objectFit:'contain',boxShadow:'0 1px 3px rgba(0,0,0,.15)' }}
          onError={e => { e.target.style.display='none'; }}
        />
        <span style={{ fontWeight:700,letterSpacing:'-.3px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>
          {orgName || t('app.name')}
        </span>
      </div>

      {!isPA && (
        <>
          <div className="nav-section">{t('section.main')}</div>
          <NavItem path="/dashboard"  icon={NAV_ICONS.dashboard}  label={t('nav.dashboard')} hidden={isSA} />
          <NavItem path="/my-ideas"   icon={NAV_ICONS.myIdeas}    label={t('nav.my_ideas')}  hidden={isSA} />
          <NavItem path="/submit"     icon={NAV_ICONS.submit}     label={t('nav.submit')}    hidden={isSA} />
          <NavItem path="/challenges" icon={NAV_ICONS.challenges}  label={t('nav.challenges')} hidden={isSA} />

          <div className="nav-section">{t('section.workflow')}</div>
          <NavItem path="/review"     icon={NAV_ICONS.review}     label={t('nav.review')}    hidden={!isPriv} />
          <NavItem path="/all-ideas"  icon={NAV_ICONS.allIdeas}   label={t('nav.all_ideas')} />
          {/* §13.5 / §14.1 — rejections as a readable set, not a filter
              nobody thinks to apply. */}
          <NavItem path="/rejected"   icon={NAV_ICONS.allIdeas}   label={t('nav.rejected')} />
          <NavItem path="/board"      icon={NAV_ICONS.board}      label={t('nav.board')}     />
          <NavItem path="/audit"      icon={NAV_ICONS.audit}      label={t('nav.audit')}     hidden={!isPriv} />

          <div className="nav-section">{t('section.insights')}</div>
          <NavItem path="/leaderboard" icon={NAV_ICONS.leaderboard} label={t('nav.leaderboard')} />
          <NavItem path="/analytics"   icon={NAV_ICONS.analytics}   label={t('nav.analytics')}   hidden={!isPriv} />

          {isAdm && (
            <>
              <div className="nav-section">{t('section.admin')}</div>
              <NavItem path="/admin" icon={NAV_ICONS.admin} label={t('nav.admin')} />
            </>
          )}
          {isSA && (
            <>
              <div className="nav-section">{t('section.super_admin')}</div>
              <NavItem path="/super-admin" icon={NAV_ICONS.superAdmin} label={t('nav.super_admin')} />
            </>
          )}
        </>
      )}

      {isPA && (
        <>
          <div className="nav-section">{t('section.platform')}</div>
          <NavItem path="/platform" icon={NAV_ICONS.platformDash} label={t('nav.organisations')} />
          <NavItem path="/platform/registrations" icon={NAV_ICONS.platformTenants} label={t('nav.registrations')} />
          <NavItem path="/platform/tickets" icon={NAV_ICONS.support} label={t('nav.support_tickets')} />
          <NavItem path="/platform/logins" icon={NAV_ICONS.audit} label={t('nav.login_activity')} />
          <NavItem path="/platform/settings" icon={NAV_ICONS.admin} label={t('nav.platform_settings')} />
        </>
      )}

      {!isPA && (
        <>
          {/* Support is for everyone in the tenant, not just admins — the person
              who hits a bug is the person who should be able to report it. */}
          <div className="nav-section">{t('section.help')}</div>
          <NavItem path="/support" icon={NAV_ICONS.support} label={t('nav.support')} />
          <NavItem path="/profile" icon={NAV_ICONS.profile} label={t('nav.profile')} />
        </>
      )}

      <div className="sidebar-user">
        <div className="avatar" style={{ flexShrink:0 }}>
          {user.avatar_initials || user.name?.[0] || '?'}
        </div>
        <div className="sidebar-user-info">
          <span style={{ fontSize:13,fontWeight:600 }}>{user.name}</span>
          <span>{formatRole(user.role, t)}</span>
          {!isPA && !isSA && (
            <span><span className="points-badge">{user.points || 0} {t('unit.pts')}</span></span>
          )}
        </div>
      </div>
    </div>
  );
}
