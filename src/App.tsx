import React from "react";
import LoginPage from "./Components/LoginPage";

function App() {
  const handleLogin = (token: string, role: string) => {
    // Handle login logic here
    console.log('Logged in with token:', token, 'role:', role);
  };

  return <LoginPage onLogin={handleLogin} />;
}

export default App;