import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SiteRouter } from '@/components/site-router';
import './index.css';
import './components/select.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteRouter />
  </StrictMode>
);
