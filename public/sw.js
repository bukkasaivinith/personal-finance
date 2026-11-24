self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Let the browser serve the app's versioned static assets. Keep origin API reads off caches.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'))) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
  }
});
