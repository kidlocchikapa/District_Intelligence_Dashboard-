import { useState, useEffect } from 'react';
import Login from './Login';
import DataManagement from './DataManagement';
import './App.css';

function App() {
  const [token, setToken] = useState(null);
  const [role, setRole] = useState(null);

  // Initialize session from local storage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('did_token');
    const savedRole = localStorage.getItem('did_role');
    if (savedToken) {
      setToken(savedToken);
      setRole(savedRole);
    }
  }, []);

  const handleLogin = (newToken, newRole) => {
    localStorage.setItem('did_token', newToken);
    localStorage.setItem('did_role', newRole);
    setToken(newToken);
    setRole(newRole);
  };

  const handleLogout = () => {
    localStorage.removeItem('did_token');
    localStorage.removeItem('did_role');
    setToken(null);
    setRole(null);
  };

  return (
    <div className="app-container">
      <header>
        <h1>District Intelligence</h1>
        {token && (
          <button onClick={handleLogout}>Sign Out</button>
        )}
      </header>

      <main>
        {!token ? (
          <Login onLogin={handleLogin} />
        ) : (
          <DataManagement token={token} />
        )}
      </main>
    </div>
  );
}

export default App;
