import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AuthGate } from '@/components/auth-gate';
import { MobileApp } from '@/components/mobile-app';
import './index.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      {window.location.pathname === '/mobile' ? <MobileApp /> : <App />}
    </AuthGate>
  </StrictMode>
);
