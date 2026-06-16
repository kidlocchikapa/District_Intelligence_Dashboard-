import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './App.css';
import { DistrictProvider } from './context/DistrictContext';
import { AIPlannerProvider } from './context/AIPlannerContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DistrictProvider>
      <AIPlannerProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AIPlannerProvider>
    </DistrictProvider>
  </React.StrictMode>
);
