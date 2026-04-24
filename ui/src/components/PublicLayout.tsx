import { Outlet, Link } from 'react-router-dom';

export function PublicLayout() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '1px solid #e0e0e0', background: '#fff',
      }}>
        <Link to="/browse" style={{ textDecoration: 'none', color: '#1a1a2e', fontSize: 20, fontWeight: 700 }}>
          ✈ Waiver Hub
        </Link>
        <Link to="/" style={{
          textDecoration: 'none', color: '#fff', background: '#1a1a2e',
          padding: '8px 20px', borderRadius: 6, fontSize: 14, fontWeight: 500,
        }}>
          Sign In
        </Link>
      </header>
      <main style={{ flex: 1, padding: '24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
}
