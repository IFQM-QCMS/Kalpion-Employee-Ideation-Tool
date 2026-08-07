import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, verify any stored token is still valid
  useEffect(() => {
    const token = localStorage.getItem('ifqm_token');
    if (!token) { setLoading(false); return; }
    authApi.me()
      .then(res => {
        if (res.data.authenticated) {
          setUser(res.data.user);
        } else {
          localStorage.removeItem('ifqm_token');
          localStorage.removeItem('ifqm_org');
        }
      })
      .catch(() => {
        localStorage.removeItem('ifqm_token');
        localStorage.removeItem('ifqm_org');
      })
      .finally(() => setLoading(false));
  }, []);

  // Session expiry guard — check when tab becomes visible
  useEffect(() => {
    const check = async () => {
      if (!user) return;
      try {
        const res = await authApi.me();
        if (!res.data.authenticated) logout();
      } catch { /* network error — don't force logout */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(check, 600000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [user]);

  const login = useCallback(async ({ email, password, org_slug }) => {
    let res;
    try {
      res = await authApi.login({ email, password, org_slug });
    } catch (err) {
      /*
       * A rejected sign-in comes back as 401/429, and axios *throws* on any
       * non-2xx — so this branch, not the one below, is what actually runs for a
       * wrong password. It used to be left to LoginPage's catch-all, which
       * showed "Server error. Please try again." for every failure.
       *
       * That threw away the only messages that matter here: "Invalid email or
       * password — 3 attempt(s) remaining" and "Too many failed attempts, try
       * again in 15 minutes". Users were being locked out with no idea why.
       */
      const data = err?.response?.data;
      if (data?.error) return { success: false, error: data.error };
      return { success: false, error: null }; // genuine network/server failure
    }

    if (res.data.success) {
      localStorage.setItem('ifqm_token', res.data.token);
      if (org_slug) localStorage.setItem('ifqm_org', org_slug);
      else localStorage.removeItem('ifqm_org');
      setUser(res.data.user);
      return { success: true, user: res.data.user };
    }
    return { success: false, error: res.data.error || null };
  }, []);

  /*
   * Adopt a session minted by some route other than the password form — today
   * that is the one-time code (MOM §4.1). The server returns exactly the same
   * { user, token } either way, so this is the same three lines the password
   * branch runs and nothing downstream can tell them apart.
   */
  const adoptSession = useCallback((user, token, orgSlug) => {
    localStorage.setItem('ifqm_token', token);
    if (orgSlug) localStorage.setItem('ifqm_org', orgSlug);
    else localStorage.removeItem('ifqm_org');
    setUser(user);
    return { success: true, user };
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    localStorage.removeItem('ifqm_token');
    localStorage.removeItem('ifqm_org');
    setUser(null);
  }, []);

  /**
   * Change the signed-in user's password.
   *
   * The server revokes every token issued before the change — including the one
   * we are holding — and hands back a fresh one. Storing that new token is what
   * keeps the user signed in; drop it and the next request 401s.
   */
  const changePassword = useCallback(async ({ current_password, new_password }) => {
    const res = await authApi.changePassword({ current_password, new_password });
    if (res.data?.success && res.data.token) {
      localStorage.setItem('ifqm_token', res.data.token);
      setUser(res.data.user || ((u) => ({ ...u, must_change_password: false })));
      return { success: true };
    }
    return { success: false, error: res.data?.error || 'Could not change password.' };
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await authApi.me();
      if (res.data.authenticated) setUser(res.data.user);
    } catch { /* ignore */ }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, adoptSession, logout, changePassword, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
