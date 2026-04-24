import { useNavigate } from 'react-router-dom';

export function RegistrationCTA() {
  const navigate = useNavigate();

  return (
    <section style={{
      marginTop: 40, padding: '32px 24px', background: '#e8f0fe',
      borderRadius: 8, textAlign: 'center',
    }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 18, color: '#1a1a2e' }}>
        Want to add your own waivers via email?
      </h3>
      <p style={{ margin: '0 0 16px', color: '#444', fontSize: 14 }}>
        Register for a free account to see more waiver information and to forward your airline waiver emails directly into the system.
      </p>
      <button
        onClick={() => navigate('/?register=true')}
        style={{
          background: '#1a1a2e', color: '#fff', border: 'none', borderRadius: 6,
          padding: '10px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Register
      </button>
    </section>
  );
}
