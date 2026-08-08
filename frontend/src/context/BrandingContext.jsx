import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { brandingApi } from '../services/api';

/**
 * Per-tenant branding: the organisation display name and logo that every user
 * under a tenant sees (TVS users see TVS, L&T users see L&T).
 *
 * Fetched once per signed-in session rather than per page, because the logo
 * travels inline as a data: URI — see brandingService for why it is not a URL.
 *
 * The org NAME is already on the user object (`user.org_name`, resolved from the
 * tenant row on every request), so it is used as the initial value and the
 * fallback. That way the sidebar renders the right name immediately on load
 * instead of flashing "IFQM" until this request lands.
 */
const BrandingContext = createContext(null);

const IFQM_LOGO = '/assets/ifqm-logo.png';

export function BrandingProvider({ children }) {
  const { user } = useAuth();
  const [logo, setLogo]       = useState(null);
  const [orgName, setOrgName] = useState(user?.org_name || '');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    // A platform administrator belongs to no organisation, so this endpoint
    // has no database to answer from and correctly refuses. Skipping the call
    // avoids a pointless request and a 403 in the log on every page load.
    if (!user || user.role === 'platform_admin') return;
    setLoading(true);
    try {
      const res = await brandingApi.get();
      const b = res.data?.branding;
      if (b) {
        setOrgName(b.org_name || '');
        setLogo(b.logo || null);
      }
    } catch {
      // Branding is decorative. A failure here must not blank the shell — we
      // keep whatever we have (at minimum user.org_name + the IFQM logo).
    } finally {
      setLoading(false);
    }
  }, [user?.org_slug, user?.id]);

  useEffect(() => {
    if (!user || user.role === 'platform_admin') { setLogo(null); setOrgName(''); return; }
    setOrgName(user.org_name || '');
    refresh();
  }, [user?.org_slug, user?.id]);

  return (
    <BrandingContext.Provider
      value={{
        orgName: orgName || user?.org_name || 'IFQM',
        // Falling back to the IFQM mark keeps the sidebar from collapsing for a
        // tenant whose admin has not uploaded a logo yet.
        logo: logo || IFQM_LOGO,
        hasCustomLogo: !!logo,
        loading,
        refresh,
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext) || { orgName: 'IFQM', logo: IFQM_LOGO, hasCustomLogo: false, loading: false, refresh: () => {} };
}
