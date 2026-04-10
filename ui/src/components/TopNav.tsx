import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserInfo, logout } from '../auth/pkce';

export function TopNav() {
  const [userName, setUserName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const info = getUserInfo();
    setUserName(info?.email ?? 'User');
  }, []);

  const handleSignOut = () => {
    logout();
  };

  return (
    <header style={styles.header}>
      <div style={styles.search}>
        <input
          type="text"
          placeholder="Search waivers…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchTerm.trim()) {
              navigate(`/waivers?search=${encodeURIComponent(searchTerm.trim())}`);
            }
          }}
          style={styles.searchInput}
          aria-label="Search waivers"
        />
      </div>

      <div style={styles.actions}>
        <div style={styles.profileWrapper}>
          <button
            style={styles.profileBtn}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Profile menu"
          >
            {userName || 'User'}
          </button>
          {menuOpen && (
            <div style={styles.dropdown}>
              <div style={styles.dropdownItem}>{userName}</div>
              <button
                style={{ ...styles.dropdownItem, ...styles.signOutBtn }}
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    height: 'var(--topnav-height)',
    minHeight: 'var(--topnav-height)',
    background: '#fff',
    borderBottom: '1px solid var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
  },
  search: { flex: 1, maxWidth: 480 },
  searchInput: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    fontSize: 14,
    outline: 'none',
  },
  actions: { display: 'flex', alignItems: 'center', gap: 12 },
  iconBtn: {
    background: 'none',
    border: 'none',
    fontSize: 20,
    cursor: 'pointer',
    padding: 4,
  },
  profileWrapper: { position: 'relative' as const },
  profileBtn: {
    background: 'var(--color-primary)',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
  },
  dropdown: {
    position: 'absolute' as const,
    right: 0,
    top: 40,
    background: '#fff',
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    minWidth: 160,
    zIndex: 100,
  },
  dropdownItem: {
    padding: '10px 16px',
    fontSize: 13,
    color: 'var(--color-text)',
    borderBottom: '1px solid var(--color-border)',
  },
  signOutBtn: {
    width: '100%',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'var(--color-red)',
    borderBottom: 'none',
  },
};
