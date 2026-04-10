import { NavLink } from 'react-router-dom';
import { useRole } from '../auth/RoleContext';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  requiredRole?: 'admin';
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/waivers', label: 'Waivers', icon: '📄' },
  { to: '/review', label: 'Review Queue', icon: '✅', requiredRole: 'admin' },
  { to: '/ingest', label: 'Ingest', icon: '🌐', requiredRole: 'admin' },
  { to: '/rules', label: 'Rules Engine', icon: '⚙️', requiredRole: 'admin' },
  { to: '/reports', label: 'Reports', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '🔧', requiredRole: 'admin' },
  { to: '/users', label: 'Users', icon: '👥', requiredRole: 'admin' },
  { to: '/monitoring', label: 'Monitoring', icon: '📡', requiredRole: 'admin' },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { isAdmin } = useRole();
  const width = collapsed ? 56 : 180;
  const visibleItems = navItems.filter(item => !item.requiredRole || isAdmin);

  return (
    <aside style={{ ...styles.sidebar, width, minWidth: width, transition: 'width 0.2s' }}>
      <div style={{ ...styles.logoRow, justifyContent: collapsed ? 'center' : 'space-between' }}>
        {!collapsed && <span style={styles.logoText}>Waiver Hub</span>}
        <button onClick={onToggle} style={styles.toggleBtn} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? '▶' : '◀'}
        </button>
      </div>
      <nav style={styles.nav}>
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={item.label}
            style={({ isActive }) => ({
              ...styles.link,
              ...(isActive ? styles.activeLink : {}),
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '10px 0' : '10px 20px',
            })}
          >
            <span style={styles.icon}>{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    background: '#fff',
    borderRight: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 12px',
    borderBottom: '1px solid var(--color-border)',
    minHeight: 50,
  },
  logoText: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--color-primary)',
    whiteSpace: 'nowrap',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    padding: '4px 6px',
    borderRadius: 4,
    flexShrink: 0,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 0',
    flex: 1,
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    textDecoration: 'none',
    color: 'var(--color-text-secondary)',
    fontSize: 14,
    fontWeight: 500,
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  activeLink: {
    color: 'var(--color-primary)',
    background: '#e8f0fe',
    borderRight: '3px solid var(--color-primary)',
  },
  icon: { fontSize: 18 },
};
