import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { isAuthenticated, handleCallback, getUserInfo } from '../auth/pkce';
import { resolveRole, type AppRole } from '../auth/role';
import { Login } from '../pages/Login';

const ADMIN_ONLY_ROUTES = ['/review', '/ingest', '/rules', '/settings', '/users', '/monitoring'];

interface Props {
  children: ReactNode;
}

export function ProtectedRoute({ children }: Props) {
  const [state, setState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [role, setRole] = useState<AppRole>(null);
  const [roleResolved, setRoleResolved] = useState(false);
  const location = useLocation();

  useEffect(() => {
    async function init() {
      const exchanged = await handleCallback();
      if (exchanged) {
        setState('authenticated');
        return;
      }
      if (isAuthenticated()) {
        setState('authenticated');
      } else {
        setState('unauthenticated');
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (state === 'authenticated') {
      const info = getUserInfo();
      setRole(resolveRole(info?.groups));
      setRoleResolved(true);
    }
  }, [state]);

  if (state === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading…</p>
      </div>
    );
  }

  // Show custom login page instead of redirecting to hosted UI
  if (state === 'unauthenticated') {
    return <Login onAuthenticated={() => setState('authenticated')} />;
  }

  // Authenticated but no recognized group
  if (roleResolved && role === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12 }}>
        <h2>Access Denied</h2>
        <p>Your account does not belong to a recognized group. Contact an administrator.</p>
      </div>
    );
  }

  // Role-based route guard: redirect user-role away from admin-only routes
  if (role === 'user' && ADMIN_ONLY_ROUTES.some(r => location.pathname.startsWith(r))) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
