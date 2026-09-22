import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileTabBar from './MobileTabBar';
import { useIsMobile } from '../../utils/useIsMobile';
import { watchTables } from '../../utils/responsiveTables';
import ContentProtection from '../ContentProtection';
import BillingBanner from '../BillingBanner';
import Breadcrumbs from './Breadcrumbs';
import { settingsApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function AppShell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const mobile = useIsMobile();
  const location = useLocation();
  const contentRef = useRef(null);
  const appRef = useRef(null);

  // The phone drawer. It closes on navigation, on Escape, on the backdrop, and when the
  // screen grows into a desktop (where the rail is always visible).
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => { if (!mobile) setDrawerOpen(false); }, [mobile]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Each screen starts at the top on a phone - #content is the scroller, not the window,
  // so the router's own scroll restoration never sees it.
  useEffect(() => { contentRef.current?.scrollTo?.(0, 0); }, [location.pathname]);

  // Column headings onto cells, so tables can stack into cards on a phone. Watched from the
  // root rather than #content so a dialog opened from the topbar is covered too.
  useEffect(() => watchTables(appRef.current), []);

  // MOM §7.2 - content protection is a per-organisation setting, so the shell has to know
  // whether it is on.
  const [protectContent, setProtectContent] = useState(false);
  useEffect(() => {
    if (!user || user.role === 'platform_admin') return;
    let cancelled = false;
    settingsApi.get()
      .then((res) => {
        if (!cancelled) setProtectContent(res.data?.settings?.content_protection === '1');
      })
      .catch(() => { /* a failed read simply leaves it off */ });
    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  return (
    <div id="app" className={mobile ? 'is-mobile' : ''} ref={appRef}>
      <ContentProtection enabled={protectContent} />
      {mobile && (
        <div
          className={`drawer-backdrop${drawerOpen ? ' show' : ''}`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(v => !v)}
        mobile={mobile}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
      <div id="main">
        <Topbar
          mobile={mobile}
          onToggleSidebar={() => (mobile ? setDrawerOpen(v => !v) : setCollapsed(v => !v))}
        />
        <div id="content" ref={contentRef}>
          {/* Where the organisation's account stands, if it is worth saying. */}
          <BillingBanner />
          {/* Renders nothing on a top-level screen - see Breadcrumbs. */}
          <Breadcrumbs />
          {children}
        </div>
        {mobile && <MobileTabBar menuOpen={drawerOpen} onMore={() => setDrawerOpen(v => !v)} />}
      </div>
    </div>
  );
}
