const CACHE_NAME = 'staff-clock-v2';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))),
  ]));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api') || url.hostname !== self.location.hostname) return;

  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const c = r.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, c));
        }
        return r;
      })
      .catch(async () => {
        const cached = await caches.match(e.request);
        if (cached) return cached;
        if (e.request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
        }
        return new Response('', { status: 504 });
      })
  );
});
