import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
import { ToastProvider } from './context/ToastContext';
import { LangProvider } from './context/LangContext';
import { NotifProvider } from './context/NotifContext';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import ForcePasswordChangePage from './pages/ForcePasswordChangePage';
import AppShell from './components/Layout/AppShell';
import DashboardPage from './pages/DashboardPage';
import MyIdeasPage from './pages/MyIdeasPage';
import SubmitPage from './pages/SubmitPage';
import ReviewQueuePage from './pages/ReviewQueuePage';
import AllIdeasPage from './pages/AllIdeasPage';
import BoardPage from './pages/BoardPage';
import ChallengesPage from './pages/ChallengesPage';
import AuditPage from './pages/AuditPage';
import LeaderboardPage from './pages/LeaderboardPage';
import AnalyticsPage from './pages/AnalyticsPage';
import AdminPage from './pages/AdminPage';
import SuperAdminPage from './pages/SuperAdminPage';
import ProfilePage from './pages/ProfilePage';
import PlatformDashPage from './pages/PlatformDashPage';
import PlatformTenantsPage from './pages/PlatformTenantsPage';
import PlatformTicketsPage from './pages/PlatformTicketsPage';
import PlatformRegistrationsPage from './pages/PlatformRegistrationsPage';
import PlatformSettingsPage from './pages/PlatformSettingsPage';
import SupportPage from './pages/SupportPage';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg)' }}>
      <div className="spinner" style={{ width:36,height:36,borderWidth:3 }}></div>
    </div>
  );
  // "/" is the public marketing page now, so an expired session belongs on the
  // sign-in screen rather than back at the pitch.
  if (!user) return <Navigate to="/login" replace />;

  // A bulk-imported employee signs in with a temporary password derived from
  // their name and birth year — guessable by any colleague. Until they replace
  // it, this is the only screen they get. The server enforces the same rule
  // (every other endpoint 403s), so this is for their benefit, not for security.
  // Support is the one exception, on both sides of the wire: the person whose
  // password doesn't work is the person who most needs to raise a ticket.
  if (user.must_change_password && location.pathname !== '/support') {
    return <ForcePasswordChangePage />;
  }

  // Platform admin can only access /platform routes
  if (user.role === 'platform_admin' && !location.pathname.startsWith('/platform')) {
    return <Navigate to="/platform" replace />;
  }
  // Super admin home is /super-admin, not /dashboard
  if (user.role === 'super_admin' && location.pathname === '/dashboard') {
    return <Navigate to="/super-admin" replace />;
  }
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg)' }}>
      <div className="spinner" style={{ width:36,height:36,borderWidth:3 }}></div>
    </div>
  );
  if (user) {
    const role = user.role;
    if (role === 'platform_admin') return <Navigate to="/platform" replace />;
    if (role === 'super_admin')    return <Navigate to="/super-admin" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PublicRoute><LandingPage /></PublicRoute>} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
      {/* Password-reset emails link here (backend builds /reset-password?token=…&org=…),
          so it must reach the login screen with its query string intact — a
          redirect to "/" would drop the token and land on the marketing page. */}
      <Route path="/reset-password" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/app" element={<PrivateRoute><AppShell /></PrivateRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="/dashboard"       element={<PrivateRoute><AppShell><DashboardPage /></AppShell></PrivateRoute>} />
      <Route path="/my-ideas"        element={<PrivateRoute><AppShell><MyIdeasPage /></AppShell></PrivateRoute>} />
      <Route path="/submit"          element={<PrivateRoute><AppShell><SubmitPage /></AppShell></PrivateRoute>} />
      <Route path="/review"          element={<PrivateRoute><AppShell><ReviewQueuePage /></AppShell></PrivateRoute>} />
      <Route path="/all-ideas"       element={<PrivateRoute><AppShell><AllIdeasPage /></AppShell></PrivateRoute>} />
      <Route path="/board"           element={<PrivateRoute><AppShell><BoardPage /></AppShell></PrivateRoute>} />
      <Route path="/challenges"      element={<PrivateRoute><AppShell><ChallengesPage /></AppShell></PrivateRoute>} />
      <Route path="/audit"           element={<PrivateRoute><AppShell><AuditPage /></AppShell></PrivateRoute>} />
      <Route path="/leaderboard"     element={<PrivateRoute><AppShell><LeaderboardPage /></AppShell></PrivateRoute>} />
      <Route path="/analytics"       element={<PrivateRoute><AppShell><AnalyticsPage /></AppShell></PrivateRoute>} />
      <Route path="/admin"           element={<PrivateRoute><AppShell><AdminPage /></AppShell></PrivateRoute>} />
      <Route path="/super-admin"     element={<PrivateRoute><AppShell><SuperAdminPage /></AppShell></PrivateRoute>} />
      <Route path="/profile"         element={<PrivateRoute><AppShell><ProfilePage /></AppShell></PrivateRoute>} />
      <Route path="/support"         element={<PrivateRoute><AppShell><SupportPage /></AppShell></PrivateRoute>} />
      <Route path="/platform"        element={<PrivateRoute><AppShell><PlatformDashPage /></AppShell></PrivateRoute>} />
      <Route path="/platform/registrations" element={<PrivateRoute><AppShell><PlatformRegistrationsPage /></AppShell></PrivateRoute>} />
      <Route path="/platform/tickets" element={<PrivateRoute><AppShell><PlatformTicketsPage /></AppShell></PrivateRoute>} />
      <Route path="/platform/settings" element={<PrivateRoute><AppShell><PlatformSettingsPage /></AppShell></PrivateRoute>} />
      <Route path="/platform/tenants/:id" element={<PrivateRoute><AppShell><PlatformTenantsPage /></AppShell></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <LangProvider>
            <ToastProvider>
              <NotifProvider>
                <AppRoutes />
              </NotifProvider>
            </ToastProvider>
          </LangProvider>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
