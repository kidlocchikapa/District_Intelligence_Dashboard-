import { useState } from 'react';

interface LoginProps {
  onLogin: (token: string, role: string) => void;
}

interface ErrorState {
  msg: string;
  success: boolean;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ErrorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      if (isRegistering) {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to register');
        setError({ msg: 'Registration successful! You can now sign in.', success: true });
        setIsRegistering(false);
      } else {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to login');
        onLogin(data.token, data.role);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError({ msg: errorMessage, success: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', fontFamily: 'sans-serif', background: '#fff' }}>
      
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <img src="/coat-of-arms.png" alt="Coat of Arms" style={{ width: 72, height: 72, objectFit: 'contain' }} />
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.15, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#111' }}>
          District<br />Intelligence<br />Dashboard
        </div>
      </div>

      <p style={{ fontSize: 14, color: '#666', marginBottom: '2rem' }}>Sign in to manage Dashboard</p>

      <div style={{ width: '100%', maxWidth: 420 }}>
        {error && (
          <div style={{ fontSize: 13, padding: '10px 14px', borderRadius: 8, marginBottom: '1rem', background: error.success ? '#dcfce7' : '#fee2e2', color: error.success ? '#166534' : '#991b1b' }}>
            {error.msg}
          </div>
        )}

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 6 }}>Enter your email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Official@district.gov.mw"
            autoComplete="email"
            style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: '1px solid #ccc', borderRadius: 8, outline: 'none' }}
          />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 6 }}>Enter your Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="••••••••••••••••"
            autoComplete={isRegistering ? 'new-password' : 'current-password'}
            style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: '1px solid #ccc', borderRadius: 8, outline: 'none' }}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '12px', fontSize: 15, fontWeight: 500, background: loading ? '#888' : '#111', color: '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Processing...' : isRegistering ? 'Register' : 'Sign in'}
        </button>

        <p
          style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: 13, color: '#666', cursor: 'pointer' }}
          onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
        >
          {isRegistering ? 'Already have an account? ' : 'Need an account? '}
          <span style={{ color: '#111', fontWeight: 500, textDecoration: 'underline' }}>
            {isRegistering ? 'Sign in' : 'Register'}
          </span>
        </p>
      </div>
    </div>
  );
}