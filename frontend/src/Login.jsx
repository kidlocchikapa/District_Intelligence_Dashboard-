import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { postJson, setAuthToken } from './lib/api';
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
      const data = await postJson('/auth/login', { email, password });
      
      setAuthToken(data.data.token);
      toast.success('Signed in successfully');
      onLogin(data.data.token, data.data.user.role);
    } catch (err) {
      const message =
        err?.response?.data?.message || err?.message || 'Failed to sign in';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-form-container">
      <div className="login-card">
        {/* Branding Header7rrrr */}
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
          Having issues with signing-in? <strong>contact support</strong>
        </p>
      </div>
    </div>
  );
}
