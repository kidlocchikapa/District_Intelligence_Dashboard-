import { useState } from 'react';
import logo from './assets/court_of_arms.png';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to login');
      onLogin(data.token, data.role);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-form-container">
      <div className="login-card">
        {/* Branding Header */}
        <div className="login-branding">
          <img src={logo} alt="Court of Arms" className="login-logo" />
          <div className="login-title-container">
            <h1 className="login-main-title">DISTRICT<br />INTELLIGENCE<br />DASHBOARD</h1>
          </div>
        </div>

        <p className="login-subtitle">Sign in to manage Dashboard</p>
        
        {error && <div className="error-message" style={{ width: '100%', marginBottom: '1.5rem' }}>{error}</div>}
        
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field-group">
            <label className="login-field-label">Enter your email</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="Official@district.gov.mw"
              required
              className="login-input"
              autoComplete="username"
            />
          </div>
          
          <div className="login-field-group">
            <label className="login-field-label">Enter your Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="********************"
              required
              className="login-input"
              autoComplete="current-password"
            />
          </div>
          
          <button type="submit" className="login-submit-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        
        <p className="login-footer-text">
          Having issues with signing-up? <strong>contact support</strong>
        </p>
      </div>
    </div>
  );
}
