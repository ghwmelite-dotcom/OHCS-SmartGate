const CACHE_NAME = 'smartgate-v3';

// Install — immediately take over
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate — claim all clients immediately + clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
    ])
  );
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip API calls entirely — always network
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api') || url.hostname !== self.location.hostname) return;

  // Everything else: try network first, cache as fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses for offline fallback
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed — serve from cache
        return caches.match(request).then((cached) => {
          return cached || caches.match('/');
        });
      })
  );
});
