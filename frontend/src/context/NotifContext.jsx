import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { notifApi } from '../services/api';
import { useAuth } from './AuthContext';

const NotifContext = createContext(null);

export function NotifProvider({ children }) {
  const { user } = useAuth();
  const [notifs, setNotifs] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  const loadNotifications = useCallback(async () => {
    // A platform administrator belongs to no organisation, so this endpoint has no database to
    // answer from and correctly refuses.
    if (!user || user.role === 'platform_admin') return;
    try {
      const res = await notifApi.list();
      if (res.data.success) {
        setNotifs(res.data.notifications || []);
        setUnreadCount(res.data.unread_count || 0);
        setTotal(res.data.total ?? (res.data.notifications || []).length);
      }
    } catch { /* ignore */ }
  }, [user]);

  // Poll every two minutes
  useEffect(() => {
    if (!user || user.role === 'platform_admin') return;
    loadNotifications();
    // Notifications kept polling in every background tab, for every signed-in person, all day.
    const interval = setInterval(loadNotifications, 120000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadNotifications();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, loadNotifications]);

  /** Mark everything read. */
  const markAllRead = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // Optimistic, so the panel responds to the click immediately.
    setNotifs((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    try {
      await notifApi.markRead();       // no ids = all, including older ones
      await loadNotifications();       // confirm against the server
    } catch {
      await loadNotifications();       // put the true state back on failure
    }
    setBusy(false);
  }, [busy, loadNotifications]);

  /** Mark one read - used when a notification is opened. */
  const markOneRead = useCallback(async (id) => {
    const n = notifs.find((x) => x.id === id);
    if (!n || n.is_read) return;
    setNotifs((prev) => prev.map((x) => (x.id === id ? { ...x, is_read: 1 } : x)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try { await notifApi.markRead([id]); } catch { await loadNotifications(); }
  }, [notifs, loadNotifications]);

  return (
    <NotifContext.Provider value={{
      notifs, unreadCount, total, busy,
      loadNotifications, markAllRead, markOneRead,
    }}>
      {children}
    </NotifContext.Provider>
  );
}

export function useNotif() {
  return useContext(NotifContext);
}
