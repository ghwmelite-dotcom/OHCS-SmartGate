const CACHE_NAME = 'staff-clock-v7';
const OFFLINE_URL = '/offline.html';
const QUEUE_DB = 'ohcs-queue';
const QUEUE_DB_VERSION = 1;
const QUEUE_STORES = ['clock-queue'];
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

  // Never SW-cache the navigation root or the SW itself — every deploy
  // changes the bundle hashes referenced from index.html, and a stale
  // index.html would point at non-existent JS files. Always go to network
  // for these so new deploys propagate the moment the user reopens the PWA.
  const isShell = e.request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname === '/index.html'
    || url.pathname === '/sw.js';

  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && !isShell) {
        const c = r.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, c));
      }
      return r;
    }).catch(async () => {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === 'navigate') {
        const offline = await caches.match(OFFLINE_URL);
        if (offline) return offline;
      }
      return new Response('', { status: 504 });
    })
  );
});

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB, QUEUE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of QUEUE_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(db, store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteRecord(db, store, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function drainStore(storeName) {
  const db = await openQueueDb();
  const records = await readAll(db, storeName);
  let synced = 0, failed = 0;
  for (const rec of records) {
    if (Date.now() - rec.createdAt > MAX_AGE_MS) {
      await deleteRecord(db, storeName, rec.id);
      failed++;
      continue;
    }
    try {
      const res = await fetch(rec.endpoint, { method: rec.method, headers: rec.headers, body: rec.body, credentials: 'include' });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await deleteRecord(db, storeName, rec.id);
        if (res.ok) synced++; else failed++;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  db.close();
  return { synced, failed };
}

async function drainAll() {
  let synced = 0, failed = 0;
  for (const s of QUEUE_STORES) {
    const r = await drainStore(s);
    synced += r.synced; failed += r.failed;
  }
  const clientsList = await self.clients.matchAll({ type: 'window' });
  for (const c of clientsList) c.postMessage({ type: 'queue-drained', synced, failed });
}

self.addEventListener('sync', (event) => {
  if (QUEUE_STORES.includes(event.tag)) event.waitUntil(drainStore(event.tag));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'flush-queue') event.waitUntil(drainAll());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'OHCS Staff Attendance';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.type || 'default',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.endsWith(url) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
