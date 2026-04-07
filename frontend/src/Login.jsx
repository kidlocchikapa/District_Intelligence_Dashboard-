import { useState } from 'react';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const [isRegistering, setIsRegistering] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegistering) {
        const res = await fetch('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to register');
        
        setError("Registration successful! You can now sign in.");
        setIsRegistering(false);
      } else {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name,email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to login');
        onLogin(data.token, data.role);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel login-container">
      <h2>{isRegistering ? 'Create Account' : 'Welcome Back'}</h2>
      <p>{isRegistering ? 'Register an admin account.' : 'Log in to access District Intelligence tools.'}</p>
      
      {error && <div className="error-message" style={{ background: error.includes('successful') ? 'rgba(16, 185, 129, 0.1)' : '', color: error.includes('successful') ? 'var(--success)' : '' }}>{error}</div>}
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Admin Fullname</label>
          <input 
            type="text" 
            value={full_name} 
            onChange={(e) => setFull_name(e.target.value)} 
            placeholder="e.g. John Doe"
            required
            autoComplete="username"
          />
        </div>
        
        <div className="form-group">
          <label>Email</label>
          <input 
            type="email" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            placeholder="e.g. john.doe@example.com"
            required
            autoComplete="email"
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <input 
            type="password" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            placeholder="••••••••"
            required
            autoComplete={isRegistering ? 'new-password' : 'current-password'}
          />
        </div>
        
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Processing...' : (isRegistering ? 'Register' : 'Sign In')}
        </button>
      </form>
      
      <p style={{marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem', cursor: 'pointer', color: 'var(--accent)'}} onClick={() => { setIsRegistering(!isRegistering); setError(null); }}>
        {isRegistering ? 'Already have an account? Sign in' : 'Need an account? Register'}
      </p>
    </div>
  );
}
