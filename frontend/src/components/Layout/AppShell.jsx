import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import ContentProtection from '../ContentProtection';
import { settingsApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function AppShell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();

  /*
   * MOM §7.2 — content protection is a per-organisation setting, so the shell
   * has to know whether it is on. Read once per session rather than per screen.
   *
   * A platform admin sits outside every tenant and has no org settings to read,
   * so the call is skipped for them entirely — it would 404 and log noise.
   */
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
          {children}
        </div>
      </div>
    </div>
  );
}
