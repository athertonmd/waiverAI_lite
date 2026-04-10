import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { getUserInfo } from './pkce';
import { resolveRole, type AppRole } from './role';

interface RoleContextValue {
  role: AppRole;
  isAdmin: boolean;
}

const RoleContext = createContext<RoleContextValue>({ role: null, isAdmin: false });

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AppRole>(null);

  useEffect(() => {
    const info = getUserInfo();
    setRole(resolveRole(info?.groups));
  }, []);

  return (
    <RoleContext.Provider value={{ role, isAdmin: role === 'admin' }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
