import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { DistrictProvider } from './context/DistrictContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DistrictProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DistrictProvider>
  </React.StrictMode>
);
