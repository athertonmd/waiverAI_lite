import { useState } from 'react';
import {
  signInWithPassword,
  respondNewPassword,
  forgotPassword,
  confirmForgotPassword,
  validatePassword,
} from '../auth/pkce';

type View = 'signIn' | 'forgotPassword' | 'confirmReset' | 'register' | 'registerSuccess';

interface Props {
  onAuthenticated: () => void;
}

export function Login({ onAuthenticated }: Props) {
  const [view, setView] = useState<View>('signIn');

  // Sign-in state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [needsNewPassword, setNeedsNewPassword] = useState(false);

  // Forgot password state
  const [fpEmail, setFpEmail] = useState('');

  // Confirm reset state
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  // Register state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regCompany, setRegCompany] = useState('');

  // Shared state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const goTo = (v: View) => {
    setError('');
    setLoading(false);
    setView(v);
  };

  // --- Sign In ---
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await signInWithPassword(email.trim(), password);
    setLoading(false);
    if (result.newPasswordRequired) {
      setNeedsNewPassword(true);
      return;
    }
    if (!result.success) {
      setError(result.error || 'Sign in failed');
      return;
    }
    onAuthenticated();
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await respondNewPassword(newPassword);
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'Failed to set password');
      return;
    }
    onAuthenticated();
  };

  // --- Forgot Password ---
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await forgotPassword(fpEmail.trim());
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'Failed to send reset code');
      return;
    }
    goTo('confirmReset');
  };

  // --- Confirm Reset ---
  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (resetPassword !== resetConfirm) {
      setError('Passwords do not match.');
      return;
    }

    const validation = validatePassword(resetPassword);
    if (!validation.valid) {
      setError(validation.message || 'Password does not meet requirements.');
      return;
    }

    setLoading(true);
    const result = await confirmForgotPassword(fpEmail.trim(), resetCode.trim(), resetPassword);
    setLoading(false);
    if (!result.success) {
      setError(result.error || 'Failed to reset password');
      return;
    }
    setResetSuccess(true);
  };

  // --- Registration ---
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const name = regName.trim();
    const emailVal = regEmail.trim();
    const company = regCompany.trim();

    if (!name || !emailVal || !company) {
      setError('All fields are required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailVal)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      const apiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
      const resp = await fetch(`${apiUrl}/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: emailVal, company }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        if (resp.status === 409) {
          setError(data?.error?.message || 'A registration request is already pending for this email.');
        } else if (resp.status === 400) {
          setError(data?.error?.message || 'Invalid registration data.');
        } else {
          setError(data?.error?.message || 'Registration failed. Please try again.');
        }
        setLoading(false);
        return;
      }

      setLoading(false);
      goTo('registerSuccess');
    } catch {
      setLoading(false);
      setError('Network error. Please try again.');
    }
  };

  // --- Render helpers ---
  const renderSignIn = () => {
    if (needsNewPassword) {
      return (
        <form onSubmit={handleNewPassword} style={styles.form}>
          <p style={{ color: '#ccc', fontSize: 13, marginBottom: 12 }}>
            Please set a new password to continue.
          </p>
          <label style={styles.label}>New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={styles.input}
            placeholder="New password"
            autoComplete="new-password"
            required
            aria-label="New password"
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? 'Setting password…' : 'SET PASSWORD'}
          </button>
        </form>
      );
    }

    return (
      <form onSubmit={handleSignIn} style={styles.form}>
        <label style={styles.label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          placeholder="you@company.com"
          autoComplete="email"
          required
          aria-label="Email"
        />

        <label style={{ ...styles.label, marginTop: 16 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          placeholder="••••••••"
          autoComplete="current-password"
          required
          aria-label="Password"
        />

        <button
          type="button"
          onClick={() => goTo('forgotPassword')}
          style={styles.link}
        >
          Forgot password?
        </button>

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? 'Signing in…' : 'SIGN IN'}
        </button>

        <button
          type="button"
          onClick={() => goTo('register')}
          style={{ ...styles.link, marginTop: 16, textAlign: 'center' }}
        >
          Request access
        </button>
      </form>
    );
  };

  const renderForgotPassword = () => (
    <form onSubmit={handleForgotPassword} style={styles.form}>
      <p style={{ color: '#ccc', fontSize: 13, marginBottom: 16 }}>
        Enter your email and we'll send you a verification code to reset your password.
      </p>
      <label style={styles.label}>Email</label>
      <input
        type="email"
        value={fpEmail}
        onChange={(e) => setFpEmail(e.target.value)}
        style={styles.input}
        placeholder="you@company.com"
        autoComplete="email"
        required
        aria-label="Email"
      />
      {error && <p style={styles.error}>{error}</p>}
      <button type="submit" style={styles.button} disabled={loading}>
        {loading ? 'Sending…' : 'SEND RESET CODE'}
      </button>
      <button type="button" onClick={() => goTo('signIn')} style={{ ...styles.link, marginTop: 16, textAlign: 'center' }}>
        Back to sign in
      </button>
    </form>
  );

  const renderConfirmReset = () => {
    if (resetSuccess) {
      return (
        <div style={styles.form}>
          <p style={{ color: '#81c784', fontSize: 14, marginBottom: 16 }}>
            Password reset successfully. You can now sign in with your new password.
          </p>
          <button type="button" onClick={() => { setResetSuccess(false); goTo('signIn'); }} style={styles.button}>
            BACK TO SIGN IN
          </button>
        </div>
      );
    }

    return (
      <form onSubmit={handleConfirmReset} style={styles.form}>
        <p style={{ color: '#ccc', fontSize: 13, marginBottom: 16 }}>
          Enter the verification code sent to your email and choose a new password.
        </p>
        <label style={styles.label}>Verification Code</label>
        <input
          type="text"
          value={resetCode}
          onChange={(e) => setResetCode(e.target.value)}
          style={styles.input}
          placeholder="123456"
          autoComplete="one-time-code"
          required
          aria-label="Verification code"
        />

        <label style={{ ...styles.label, marginTop: 16 }}>New Password</label>
        <input
          type="password"
          value={resetPassword}
          onChange={(e) => setResetPassword(e.target.value)}
          style={styles.input}
          placeholder="New password"
          autoComplete="new-password"
          required
          aria-label="New password"
        />

        <label style={{ ...styles.label, marginTop: 16 }}>Confirm Password</label>
        <input
          type="password"
          value={resetConfirm}
          onChange={(e) => setResetConfirm(e.target.value)}
          style={styles.input}
          placeholder="Confirm password"
          autoComplete="new-password"
          required
          aria-label="Confirm password"
        />

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? 'Resetting…' : 'RESET PASSWORD'}
        </button>
        <button type="button" onClick={() => goTo('signIn')} style={{ ...styles.link, marginTop: 16, textAlign: 'center' }}>
          Back to sign in
        </button>
      </form>
    );
  };

  const renderRegister = () => (
    <form onSubmit={handleRegister} style={styles.form}>
      <p style={{ color: '#ccc', fontSize: 13, marginBottom: 16 }}>
        Request access to Waiver Hub. An administrator will review your request.
      </p>
      <label style={styles.label}>Full Name</label>
      <input
        type="text"
        value={regName}
        onChange={(e) => setRegName(e.target.value)}
        style={styles.input}
        placeholder="Jane Smith"
        autoComplete="name"
        required
        aria-label="Full name"
      />

      <label style={{ ...styles.label, marginTop: 16 }}>Email</label>
      <input
        type="email"
        value={regEmail}
        onChange={(e) => setRegEmail(e.target.value)}
        style={styles.input}
        placeholder="you@company.com"
        autoComplete="email"
        required
        aria-label="Email"
      />

      <label style={{ ...styles.label, marginTop: 16 }}>Company</label>
      <input
        type="text"
        value={regCompany}
        onChange={(e) => setRegCompany(e.target.value)}
        style={styles.input}
        placeholder="Acme Corp"
        autoComplete="organization"
        required
        aria-label="Company"
      />

      {error && <p style={styles.error}>{error}</p>}

      <button type="submit" style={styles.button} disabled={loading}>
        {loading ? 'Submitting…' : 'REQUEST ACCESS'}
      </button>
      <button type="button" onClick={() => goTo('signIn')} style={{ ...styles.link, marginTop: 16, textAlign: 'center' }}>
        Back to sign in
      </button>
    </form>
  );

  const renderRegisterSuccess = () => (
    <div style={styles.form}>
      <p style={{ color: '#81c784', fontSize: 14, marginBottom: 8 }}>
        Your access request has been submitted.
      </p>
      <p style={{ color: '#ccc', fontSize: 13, marginBottom: 16 }}>
        An administrator will review your request. You'll receive an email when your account is ready.
      </p>
      <button type="button" onClick={() => goTo('signIn')} style={styles.button}>
        BACK TO SIGN IN
      </button>
    </div>
  );

  const viewContent: Record<View, () => JSX.Element> = {
    signIn: renderSignIn,
    forgotPassword: renderForgotPassword,
    confirmReset: renderConfirmReset,
    register: renderRegister,
    registerSuccess: renderRegisterSuccess,
  };

  return (
    <div style={styles.container}>
      <div style={styles.overlay} />
      <div style={styles.panel}>
        <div style={styles.logoSection}>
          <div style={styles.logoIcon}>✈</div>
          <h1 style={styles.title}>Waiver Hub</h1>
          <p style={styles.subtitle}>by Mantic Point</p>
        </div>
        {viewContent[view]()}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundImage: 'url(https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=80)',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.3)',
  },
  panel: {
    position: 'relative',
    zIndex: 1,
    width: 340,
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '40px 36px',
    background: 'rgba(30, 60, 90, 0.85)',
    backdropFilter: 'blur(12px)',
    color: '#fff',
  },
  logoSection: {
    textAlign: 'center',
    marginBottom: 32,
  },
  logoIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    margin: 0,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#aac',
    marginTop: 4,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 6,
    color: '#dde',
  },
  input: {
    padding: '10px 12px',
    fontSize: 14,
    border: 'none',
    borderBottom: '2px solid rgba(255,255,255,0.4)',
    background: 'transparent',
    color: '#fff',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  error: {
    color: '#ff8a80',
    fontSize: 13,
    marginTop: 12,
    marginBottom: 0,
  },
  button: {
    marginTop: 24,
    padding: '12px',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 1,
    border: 'none',
    borderRadius: 4,
    background: '#4caf50',
    color: '#fff',
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  link: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: '8px 0 0',
    textAlign: 'left',
  },
};
