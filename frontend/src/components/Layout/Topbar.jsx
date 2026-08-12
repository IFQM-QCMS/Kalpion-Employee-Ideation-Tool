import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LangContext';
import { useNotif } from '../../context/NotifContext';
import { useToast } from '../../context/ToastContext';
import { SUPPORTED_LANGS, LANG_LABELS, LANG_NAMES } from '../../i18n/translations';
import { formatRole, timeAgo } from '../../utils/helpers';
import IdeaDetailModal from '../IdeaDetailModal';

const PAGE_TITLES = {
  '/dashboard':    'nav.dashboard',
  '/my-ideas':     'nav.my_ideas',
  '/submit':       'form.submit_idea',
  '/review':       'nav.review',
  '/all-ideas':    'nav.all_ideas',
  '/board':        'nav.board',
  '/challenges':   'nav.challenges',
  '/audit':        'nav.audit',
  '/leaderboard':  'nav.leaderboard',
  '/analytics':    'nav.analytics',
  '/admin':        'nav.admin',
  '/super-admin':  'nav.super_admin',
  '/profile':      'nav.profile',
  '/platform':     'nav.platform',
  '/rejected':     'nav.rejected',
  '/support':      'nav.support',
  '/help':         'nav.help',
  '/platform/registrations': 'nav.registrations',
  '/platform/tickets':       'nav.support_tickets',
  '/platform/settings':      'nav.platform_settings',
  '/platform/logins':        'nav.login_activity',
  '/platform/plans':         'nav.plans',
};

// Anything not in the map above still gets a properly capitalised heading
// rather than the raw path, which used to read "rejected".
function titleFromPath(path) {
  const last = path.split('/').filter(Boolean).pop() || '';
  return last.replace(/-/g, ' ').replace(/\w/g, (c) => c.toUpperCase());
}

export default function Topbar({ onToggleSidebar }) {
  const { user, logout }                     = useAuth();
  const { t, lang, setLang }                = useLang();
  const { notifs, unreadCount, total, busy, markAllRead, markOneRead } = useNotif();
  const { showToast }                        = useToast();
  const navigate  = useNavigate();
  const location  = useLocation();

  const [isDark, setIsDark]         = useState(document.documentElement.getAttribute('data-theme') === 'dark');
  const [showNotif, setShowNotif]   = useState(false);
  const [showLang, setShowLang]     = useState(false);
  // The idea a notification points at, opened as an overlay from wherever the
  // reader happens to be. Navigating to a list page and hoping it opens the
  // right row would depend on that page's own state; this does not.
  const [notifIdeaId, setNotifIdeaId] = useState(null);
  const langMenuRef                  = useRef(null);
  const notifPanelRef                = useRef(null);

  /**
   * Open what a notification is about.
   *
   * Every notification the server writes carries the idea it concerns —
   * submitted, escalated, assigned, committee-routed, approved, rejected,
   * implemented — so this is not special-cased per type. Reading it also marks
   * that one read, which is what a person means by opening it.
   */
  function openNotification(n) {
    markOneRead(n.id);
    if (n.idea_id) {
      setShowNotif(false);
      setNotifIdeaId(null);
      setTimeout(() => setNotifIdeaId(n.idea_id), 20);
    }
  }

  const pageTitle = PAGE_TITLES[location.pathname]
    ? t(PAGE_TITLES[location.pathname])
    : titleFromPath(location.pathname);

  function toggleDark() {
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ifqm-theme', next);
    setIsDark(!isDark);
  }

  async function doLogout() {
    await logout();
    // Signing out returns you to the sign-in screen, not to the public pitch
    // page that now lives at "/".
    navigate('/login');
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e) {
      if (showNotif && notifPanelRef.current && !notifPanelRef.current.contains(e.target)) {
        const bell = document.getElementById('notif-bell-btn');
        if (!bell?.contains(e.target)) setShowNotif(false);
      }
      if (showLang && langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        const btn = document.getElementById('lang-btn');
        if (!btn?.contains(e.target)) setShowLang(false);
      }
    }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showNotif, showLang]);

  function handleLangToggle(e) {
    e.stopPropagation();
    setShowLang(v => !v);
  }

  return (
    <div id="topbar">
      <div className="topbar-left">
        <button
          style={{ background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--text-muted)',padding:'4px 6px',borderRadius:6,transition:'background .15s',lineHeight:1 }}
          onClick={onToggleSidebar}
          onMouseOver={e => e.target.style.background='var(--bar-track)'}
          onMouseOut={e => e.target.style.background='none'}
        >&#9776;</button>
        <span className="page-title">{pageTitle}</span>
      </div>

      <div className="topbar-right">
        {/* Dark mode toggle */}
        <div className="dm-toggle" onClick={toggleDark} title={t('topbar.toggle_dark')}>
          <div className={`dm-track${isDark ? ' on' : ''}`}><div className="dm-thumb"></div></div>
          <span>{isDark ? t('topbar.light') : t('topbar.dark')}</span>
        </div>

        {/* Language picker */}
        <div className={`lang-wrap${showLang ? ' open' : ''}`}>
          <button className="lang-toggle" id="lang-btn" onClick={handleLangToggle}>
            {LANG_LABELS[lang] || 'EN'}
          </button>
          {showLang && (
            <div className="lang-menu" ref={langMenuRef}>
              {SUPPORTED_LANGS.map(l => (
                <div
                  key={l}
                  className={`lang-opt${lang === l ? ' active' : ''}`}
                  data-lang={l}
                  onClick={() => { setLang(l); setShowLang(false); }}
                >
                  <span className="lang-opt-code">{LANG_LABELS[l]}</span>
                  <span>{LANG_NAMES[l]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notifications bell.
            The panel is a child of this wrapper so it opens beneath the bell
            rather than at the window's right edge — see .notif-wrap in the
            stylesheet for why that changed. */}
        <div className="notif-wrap">
          <div
            id="notif-bell-btn"
            className="notif-bell"
            onClick={() => setShowNotif(v => !v)}
            title={t('topbar.notifications')}
            style={{ display:'flex',alignItems:'center',gap:6 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            <span>{t('topbar.notifications')}</span>
            {unreadCount > 0 && (
              <div className="notif-badge" style={{ position:'relative',top:'auto',right:'auto',margin:0 }}>
                {unreadCount}
              </div>
            )}
          </div>

          {showNotif && (
            <div className="notification-panel" ref={notifPanelRef}>
              <div style={{
                padding:'10px 14px',borderBottom:'1px solid var(--border)',
                display:'flex',justifyContent:'space-between',alignItems:'center',
                gap:10,flex:'0 0 auto',
              }}>
                <strong style={{ fontSize:13 }}>{t('notif.header')}</strong>
                <button className="btn btn-outline btn-sm"
                  disabled={busy || !unreadCount}
                  onClick={markAllRead}>
                  {t('topbar.mark_read')}
                </button>
              </div>

              <div id="notif-list">
                {!notifs.length
                  ? <div className="empty-state">{t('msg.no_notif')}</div>
                  : notifs.map(n => {
                    // Every notification the server writes carries the idea it
                    // is about, so every one of them can be opened — not just
                    // "new idea submitted". Where the link is genuinely absent
                    // the row is rendered as text rather than a dead button.
                    const canOpen = !!n.idea_id;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className={`notif-item${!n.is_read ? ' unread' : ''}${canOpen ? '' : ' static'}`}
                        onClick={() => openNotification(n)}
                        aria-label={n.title || n.message}
                      >
                        <div className="notif-item-title">{n.title || n.message}</div>
                        {n.title && n.message && n.message !== n.title && (
                          <div style={{ fontSize:12,color:'var(--text-muted)',marginTop:2,lineHeight:1.45 }}>
                            {n.message}
                          </div>
                        )}
                        <div className="notif-item-meta">
                          {timeAgo(n.created_at, t)}
                          {canOpen && <> · {t('notif.open')}</>}
                        </div>
                      </button>
                    );
                  })
                }
              </div>

              {total > notifs.length && (
                <div style={{
                  padding:'8px 14px',borderTop:'1px solid var(--border)',
                  fontSize:11.5,color:'var(--subtle)',flex:'0 0 auto',
                }}>
                  {t('notif.showing', { shown: notifs.length, total })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User chip.
            MOM §12.10 — a platform admin sees "Superadmin signed in as <name>"
            rather than a bare name plus a role pill. These accounts can reach
            every tenant on the platform, so which one you are currently acting
            as should be a sentence, not something inferred from a chip. */}
        <div className="user-chip" onClick={() => navigate('/profile')}>
          <div className="avatar">{user?.avatar_initials || user?.name?.[0] || '?'}</div>
          {user?.role === 'platform_admin' ? (
            <span>{t('pa.signed_in_as').replace('{name}', user?.name || '')}</span>
          ) : (
            <>
              <span>{user?.name}</span>
              <span className="role-badge">{formatRole(user?.role, t)}</span>
            </>
          )}
        </div>

        <button className="btn btn-outline btn-sm" onClick={doLogout}>{t('topbar.logout')}</button>
      </div>

      {/* Opened from a notification, so it works on every page. */}
      {notifIdeaId && (
        <IdeaDetailModal ideaId={notifIdeaId} onClose={() => setNotifIdeaId(null)} />
      )}
    </div>
  );
}
