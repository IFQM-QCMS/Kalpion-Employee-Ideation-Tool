import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import ContentProtection from '../ContentProtection';
import BillingBanner from '../BillingBanner';
import Breadcrumbs from './Breadcrumbs';
import { settingsApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function AppShell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

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
    <div id="app">
      <ContentProtection enabled={protectContent} />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(v => !v)} />
      <div id="main">
        <Topbar onToggleSidebar={() => setCollapsed(v => !v)} />
        <div id="content">
          {/* Where the organisation's account stands, if it is worth saying. */}
          <BillingBanner />
          {/* Renders nothing on a top-level screen - see Breadcrumbs. */}
          <Breadcrumbs />
          {children}
        </div>
      </div>
    </div>
  );
}
