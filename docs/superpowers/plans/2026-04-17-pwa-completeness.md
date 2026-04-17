# PWA Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four PWA gaps (A2HS install button, opt-in web push, offline mutation queue, offline indicator+fallback) across both `packages/staff` and `packages/web`, with supporting changes in `packages/api`.

**Architecture:** Each frontend gets its own near-identical copy of the PWA utilities (no new workspace package). API gains a `push_subscriptions` table, a VAPID-based push-send helper, and subscribe/unsubscribe/status endpoints. The existing hand-rolled service workers are extended in place with fetch fallback, IndexedDB-backed sync queue, and push + notificationclick handlers.

**Tech Stack:** React 18 + Vite + Zustand (frontends), Cloudflare Workers + Hono + D1 + Web Crypto (API), hand-rolled service workers with IndexedDB.

---

## File Structure Overview

**New files (staff):**
- `packages/staff/src/hooks/useOnlineStatus.ts`
- `packages/staff/src/components/OfflineBanner.tsx`
- `packages/staff/src/components/InstallButton.tsx`
- `packages/staff/src/components/IosInstallInstructions.tsx`
- `packages/staff/src/components/PushToggle.tsx`
- `packages/staff/src/components/SettingsMenu.tsx`
- `packages/staff/src/stores/install.ts`
- `packages/staff/src/lib/offlineQueue.ts`
- `packages/staff/src/lib/pushClient.ts`
- `packages/staff/public/offline.html`

**New files (web):** same as staff, under `packages/web/...`. `SettingsMenu` in web is rendered from the header avatar dropdown rather than a menu button.

**New files (api):**
- `packages/api/src/db/migration-push-subscriptions.sql`
- `packages/api/src/lib/webpush.ts`
- `packages/api/src/routes/notifications-push.ts`
- `docs/ops/pwa-secrets.md`

**Modified files:**
- `packages/staff/public/sw.js` (fetch fallback, push, notificationclick, sync, message)
- `packages/web/public/sw.js` (same edits)
- `packages/staff/src/main.tsx` (beforeinstallprompt listener + online flush trigger)
- `packages/web/src/main.tsx` (same)
- `packages/staff/src/App.tsx` (render OfflineBanner)
- `packages/web/src/App.tsx` (same)
- `packages/staff/src/pages/ClockPage.tsx` (render SettingsMenu in header; use apiOrQueue for clock)
- `packages/web/src/components/layout/Header.tsx` (render SettingsMenu from avatar)
- `packages/api/src/db/schema.sql` (add push_subscriptions)
- `packages/api/src/index.ts` (mount new router)
- `packages/api/src/services/notifier.ts` (fork-call sendPush)
- `packages/api/src/routes/clock.ts` (accept idempotency_key)
- `packages/api/src/routes/visits.ts` (accept idempotency_key on check-in)

---

## Phase A — Feature 1: Offline Indicator & Fallback

### Task 1: `useOnlineStatus` hook (staff)

**Files:**
- Create: `packages/staff/src/hooks/useOnlineStatus.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
```

- [ ] **Step 2: Type-check**

Run from repo root: `node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/staff/src/hooks/useOnlineStatus.ts
git commit -m "feat(staff): add useOnlineStatus hook"
```

### Task 2: `OfflineBanner` component + wire into staff App

**Files:**
- Create: `packages/staff/src/components/OfflineBanner.tsx`
- Modify: `packages/staff/src/App.tsx`

- [ ] **Step 1: Create the banner**

```tsx
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-[13px] font-semibold py-2 px-4 flex items-center justify-center gap-2 shadow-lg">
      <WifiOff className="h-4 w-4" />
      <span>You're offline. Changes will sync when you reconnect.</span>
    </div>
  );
}
```

- [ ] **Step 2: Render it in App.tsx**

Inside `packages/staff/src/App.tsx`, add the import next to other imports (near the top):

```tsx
import { OfflineBanner } from './components/OfflineBanner';
```

In the main `return` block wrapping `BrowserRouter`, render `<OfflineBanner />` as the FIRST sibling inside `QueryClientProvider`:

```tsx
return (
  <QueryClientProvider client={queryClient}>
    <OfflineBanner />
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><ClockPage /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);
```

- [ ] **Step 3: Type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/staff/src/components/OfflineBanner.tsx packages/staff/src/App.tsx
git commit -m "feat(staff): add OfflineBanner rendered at app root"
```

### Task 3: Offline fallback page + SW fetch fallback (staff)

**Files:**
- Create: `packages/staff/public/offline.html`
- Modify: `packages/staff/public/sw.js`

- [ ] **Step 1: Create offline.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline — Staff Attendance</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%);
      font-family: system-ui, -apple-system, sans-serif; color: white; padding: 1rem; }
    .card { max-width: 28rem; text-align: center; }
    .icon { width: 72px; height: 72px; margin: 0 auto 1.5rem; border-radius: 1rem;
      background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center; }
    h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.75rem; }
    p { font-size: 0.95rem; line-height: 1.6; opacity: 0.85; margin: 0 0 1.5rem; }
    button { background: #D4A017; color: #1A4D2E; border: none; padding: 0.75rem 1.5rem;
      border-radius: 0.75rem; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
    </div>
    <h1>You're offline</h1>
    <p>Your connection dropped. Reconnect to continue — any clock actions you took offline will sync automatically.</p>
    <button onclick="location.reload()">Try again</button>
  </div>
</body>
</html>
```

- [ ] **Step 2: Update sw.js fetch handler**

Replace the entire contents of `packages/staff/public/sw.js` with:

```js
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
```

Notes: `CACHE_NAME` bumped to `staff-clock-v2` so old caches get cleared. `offline.html` is precached on install.

- [ ] **Step 3: Commit**

```bash
git add packages/staff/public/offline.html packages/staff/public/sw.js
git commit -m "feat(staff): add offline fallback page and SW navigation fallback"
```

### Task 4: Mirror Feature 1 in `packages/web`

**Files:**
- Create: `packages/web/src/hooks/useOnlineStatus.ts`
- Create: `packages/web/src/components/OfflineBanner.tsx`
- Create: `packages/web/public/offline.html`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/public/sw.js`

- [ ] **Step 1: Duplicate `useOnlineStatus.ts`**

Create `packages/web/src/hooks/useOnlineStatus.ts` with exactly the same contents as in Task 1 Step 1.

- [ ] **Step 2: Duplicate `OfflineBanner.tsx`**

Create `packages/web/src/components/OfflineBanner.tsx` with exactly the same contents as in Task 2 Step 1.

- [ ] **Step 3: Wire into `packages/web/src/App.tsx`**

Read the file. Find its top-level `return (...)` in the exported `App` component. Add `import { OfflineBanner } from './components/OfflineBanner';` near the other imports. Render `<OfflineBanner />` as the first sibling inside the outermost provider. Preserve everything else.

- [ ] **Step 4: Duplicate `offline.html`**

Create `packages/web/public/offline.html`. Copy the file from Task 3 Step 1 but change the `<title>` to `Offline — SmartGate` and the body `<h1>` to `You're offline`.

- [ ] **Step 5: Update `packages/web/public/sw.js`**

Replace its contents with exactly the same code as Task 3 Step 2, but change the first line:

```js
const CACHE_NAME = 'smartgate-v4';
```

(The old SW used `smartgate-v3`; we bump by one.)

- [ ] **Step 6: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/hooks/useOnlineStatus.ts packages/web/src/components/OfflineBanner.tsx packages/web/public/offline.html packages/web/src/App.tsx packages/web/public/sw.js
git commit -m "feat(web): offline banner, offline fallback page, SW nav fallback"
```

---

## Phase B — Feature 4: A2HS Install Button

### Task 5: Install state store (staff)

**Files:**
- Create: `packages/staff/src/stores/install.ts`

- [ ] **Step 1: Write the store**

```ts
import { create } from 'zustand';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

interface InstallState {
  deferredPrompt: BIPEvent | null;
  installed: boolean;
  setDeferredPrompt: (e: BIPEvent | null) => void;
  setInstalled: (v: boolean) => void;
}

export const useInstallStore = create<InstallState>((set) => ({
  deferredPrompt: null,
  installed: false,
  setDeferredPrompt: (e) => set({ deferredPrompt: e }),
  setInstalled: (v) => set({ installed: v, deferredPrompt: v ? null : undefined as never }),
}));

export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isStandalone = (window.matchMedia('(display-mode: standalone)').matches) ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

export function isAppInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
```

- [ ] **Step 2: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/stores/install.ts
git commit -m "feat(staff): add install store with iOS + installed detection"
```

### Task 6: Wire `beforeinstallprompt` listener in staff `main.tsx`

**Files:**
- Modify: `packages/staff/src/main.tsx`

- [ ] **Step 1: Add listener**

Replace `packages/staff/src/main.tsx` entirely with:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useInstallStore } from './stores/install';
import './tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useInstallStore.getState().setDeferredPrompt(e as unknown as Parameters<typeof useInstallStore.getState>[0] extends never ? never : Parameters<ReturnType<typeof useInstallStore.getState>['setDeferredPrompt']>[0]);
});

window.addEventListener('appinstalled', () => {
  useInstallStore.getState().setInstalled(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      setInterval(() => reg.update(), 60_000);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && navigator.serviceWorker.controller) window.location.reload();
        });
      });
      window.addEventListener('online', () => {
        navigator.serviceWorker.controller?.postMessage({ type: 'flush-queue' });
      });
    } catch {}
  });
}
```

Notes: The awkward `Parameters<...>` cast is to satisfy strict TS without using `any`. If the plan's type acrobatics trip TS, replace that line with:

```tsx
  const store = useInstallStore.getState();
  store.setDeferredPrompt(e as Parameters<typeof store.setDeferredPrompt>[0]);
```

The online → `flush-queue` message is added now so the SW (updated in Phase C) will pick it up when that phase lands.

- [ ] **Step 2: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/main.tsx
git commit -m "feat(staff): capture beforeinstallprompt and appinstalled events"
```

### Task 7: `InstallButton` + `IosInstallInstructions` (staff)

**Files:**
- Create: `packages/staff/src/components/IosInstallInstructions.tsx`
- Create: `packages/staff/src/components/InstallButton.tsx`

- [ ] **Step 1: `IosInstallInstructions.tsx`**

```tsx
import { X, Share, Plus } from 'lucide-react';

export function IosInstallInstructions({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
              Install on iPhone
            </h3>
            <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ol className="space-y-4">
            <li className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-full bg-[#1A4D2E] text-white text-[13px] font-bold flex items-center justify-center flex-shrink-0">1</span>
              <div className="pt-0.5 text-[14px] text-gray-700 leading-relaxed">
                Tap the <span className="inline-flex items-center gap-1 font-semibold"><Share className="h-4 w-4 inline" /> Share</span> button at the bottom of Safari.
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-full bg-[#1A4D2E] text-white text-[13px] font-bold flex items-center justify-center flex-shrink-0">2</span>
              <div className="pt-0.5 text-[14px] text-gray-700 leading-relaxed">
                Scroll and tap <span className="inline-flex items-center gap-1 font-semibold"><Plus className="h-4 w-4 inline" /> Add to Home Screen</span>.
              </div>
            </li>
            <li className="flex gap-3 items-start">
              <span className="h-7 w-7 rounded-full bg-[#1A4D2E] text-white text-[13px] font-bold flex items-center justify-center flex-shrink-0">3</span>
              <div className="pt-0.5 text-[14px] text-gray-700 leading-relaxed">
                Tap <span className="font-semibold">Add</span>. The app icon will appear on your home screen.
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `InstallButton.tsx`**

```tsx
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useInstallStore, isIosSafari, isAppInstalled } from '@/stores/install';
import { IosInstallInstructions } from './IosInstallInstructions';

export function InstallButton() {
  const deferredPrompt = useInstallStore((s) => s.deferredPrompt);
  const installed = useInstallStore((s) => s.installed);
  const setDeferredPrompt = useInstallStore((s) => s.setDeferredPrompt);
  const [showIos, setShowIos] = useState(false);

  if (installed || isAppInstalled()) return null;

  const iosFallback = isIosSafari();
  if (!deferredPrompt && !iosFallback) return null;

  async function handleClick() {
    if (iosFallback && !deferredPrompt) {
      setShowIos(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="w-full h-11 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-semibold text-[14px] hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
      >
        <Download className="h-4 w-4" />
        Install app
      </button>
      {showIos && <IosInstallInstructions onClose={() => setShowIos(false)} />}
    </>
  );
}
```

- [ ] **Step 3: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/IosInstallInstructions.tsx packages/staff/src/components/InstallButton.tsx
git commit -m "feat(staff): add InstallButton + iOS install instructions"
```

### Task 8: `SettingsMenu` dropdown + wire into ClockPage header (staff)

**Files:**
- Create: `packages/staff/src/components/SettingsMenu.tsx`
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Create `SettingsMenu.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { InstallButton } from './InstallButton';

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Settings"
        className="h-9 w-9 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Settings className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 bg-white rounded-xl shadow-xl border border-gray-200 w-64 p-3 space-y-2">
          <InstallButton />
        </div>
      )}
    </div>
  );
}
```

Note: `PushToggle` will be added to this menu in Phase D. For now the menu only contains `InstallButton` (which hides itself if the app is already installed or the browser doesn't support install).

- [ ] **Step 2: Render in ClockPage header**

In `packages/staff/src/pages/ClockPage.tsx`, find the header `PinChangeButton` usage (line ~192 per audit). Add the import near the top:

```tsx
import { SettingsMenu } from '@/components/SettingsMenu';
```

Place `<SettingsMenu />` in the header right-cluster immediately BEFORE the existing `<PinChangeButton />`:

```tsx
<div className="flex items-center gap-3">
  <SettingsMenu />
  <PinChangeButton />
  {/* existing Sign Out button stays here */}
</div>
```

(The exact wrapping div and gap value may already exist. Insert `<SettingsMenu />` without altering anything else.)

- [ ] **Step 3: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/SettingsMenu.tsx packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): add SettingsMenu dropdown with Install button in header"
```

### Task 9: Mirror Feature 4 in `packages/web`

**Files:**
- Create: `packages/web/src/stores/install.ts` (identical to Task 5)
- Create: `packages/web/src/components/IosInstallInstructions.tsx` (identical to Task 7 Step 1; title becomes `Install on iPhone` with same content)
- Create: `packages/web/src/components/InstallButton.tsx` (identical to Task 7 Step 2)
- Create: `packages/web/src/components/SettingsMenu.tsx` (identical to Task 8 Step 1)
- Modify: `packages/web/src/main.tsx` (add beforeinstallprompt + appinstalled + online-flush listeners — mirror Task 6; preserve web's existing SW registration comments)
- Modify: `packages/web/src/components/layout/Header.tsx` — add `<SettingsMenu />` immediately BEFORE `<NotificationBell />`.

- [ ] **Step 1: Duplicate files**

Copy each file from staff to web with the path translation (`packages/staff/...` → `packages/web/...`). Keep imports pointing at `@/...` (both packages have the same alias).

- [ ] **Step 2: Patch `packages/web/src/main.tsx`**

Read the current file. Add the two `window.addEventListener('beforeinstallprompt', ...)` and `appinstalled` blocks from Task 6 Step 1. Add the `online` event that posts `flush-queue` inside the existing SW-register `load` handler.

- [ ] **Step 3: Patch `packages/web/src/components/layout/Header.tsx`**

Read the file. Find the `NotificationBell` usage. Add `import { SettingsMenu } from '@/components/SettingsMenu';` near the other imports. Render `<SettingsMenu />` immediately before `<NotificationBell />`.

- [ ] **Step 4: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/stores/install.ts packages/web/src/components/IosInstallInstructions.tsx packages/web/src/components/InstallButton.tsx packages/web/src/components/SettingsMenu.tsx packages/web/src/main.tsx packages/web/src/components/layout/Header.tsx
git commit -m "feat(web): add install store, button, iOS instructions, settings menu"
```

---

## Phase C — Feature 2: Offline Mutation Queue

### Task 10: Add `idempotency_key` to `POST /clock`

**Files:**
- Modify: `packages/api/src/routes/clock.ts`

- [ ] **Step 1: Extend the body schema**

Open `packages/api/src/routes/clock.ts`. Find the zod schema (around line 26-30):

```ts
z.object({
  type: z.enum(['clock_in', 'clock_out']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})
```

Change to:

```ts
z.object({
  type: z.enum(['clock_in', 'clock_out']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  idempotency_key: z.string().min(1).max(100).optional(),
})
```

- [ ] **Step 2: Dedupe by idempotency key**

At the top of the handler body (after session validation, before the daily-clocked-in check), add:

```ts
const { type, latitude, longitude, idempotency_key } = c.req.valid('json');

if (idempotency_key) {
  const existing = await c.env.DB.prepare(
    "SELECT id, type, created_at FROM clocks WHERE user_id = ? AND idempotency_key = ? LIMIT 1"
  ).bind(session.userId, idempotency_key).first<{ id: string; type: string; created_at: string }>();
  if (existing) {
    return success(c, { id: existing.id, type: existing.type, timestamp: existing.created_at, deduplicated: true });
  }
}
```

Update destructuring in the existing code to match (remove the duplicate `const { type, latitude, longitude } = ...` that existed before).

- [ ] **Step 3: Add the column (migration)**

Create `packages/api/src/db/migration-clock-idempotency.sql`:

```sql
ALTER TABLE clocks ADD COLUMN idempotency_key TEXT;
CREATE INDEX IF NOT EXISTS idx_clocks_user_idem ON clocks(user_id, idempotency_key);
```

Apply locally:

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-clock-idempotency.sql
```

And mirror the column in `packages/api/src/db/schema.sql`'s `clocks` table definition — add `idempotency_key TEXT,` before `created_at`.

- [ ] **Step 4: Include `idempotency_key` in the INSERT**

In the handler, find the existing `INSERT INTO clocks` statement. Add `idempotency_key` to the column list and pass `idempotency_key ?? null` to `bind(...)`.

- [ ] **Step 5: Type-check, commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/clock.ts packages/api/src/db/migration-clock-idempotency.sql packages/api/src/db/schema.sql
git commit -m "feat(api): idempotency_key support in POST /clock"
```

### Task 11: Add `idempotency_key` to `POST /visits/check-in`

**Files:**
- Modify: `packages/api/src/routes/visits.ts`
- Modify: `packages/api/src/lib/validation.ts` (where `CheckInSchema` lives)
- Modify: `packages/api/src/db/schema.sql`
- Create: `packages/api/src/db/migration-visits-idempotency.sql`

- [ ] **Step 1: Extend `CheckInSchema`**

In `packages/api/src/lib/validation.ts`, find `CheckInSchema` and add:

```ts
idempotency_key: z.string().min(1).max(100).optional(),
```

- [ ] **Step 2: Dedupe in the check-in handler**

In `packages/api/src/routes/visits.ts`, at the start of the `/check-in` handler (after session validation), add:

```ts
const { idempotency_key } = body; // body already destructured below; put this first

if (idempotency_key) {
  const existing = await c.env.DB.prepare(
    "SELECT id, badge_code FROM visits WHERE idempotency_key = ? LIMIT 1"
  ).bind(idempotency_key).first<{ id: string; badge_code: string }>();
  if (existing) {
    return success(c, { id: existing.id, badge_code: existing.badge_code, deduplicated: true });
  }
}
```

- [ ] **Step 3: Migration**

Create `packages/api/src/db/migration-visits-idempotency.sql`:

```sql
ALTER TABLE visits ADD COLUMN idempotency_key TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_visits_idem ON visits(idempotency_key);
```

Apply:

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-visits-idempotency.sql
```

Mirror in schema.sql visits table.

- [ ] **Step 4: INSERT includes `idempotency_key`**

In the visits INSERT, add `idempotency_key` column and `idempotency_key ?? null` param.

- [ ] **Step 5: Commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/visits.ts packages/api/src/lib/validation.ts packages/api/src/db/migration-visits-idempotency.sql packages/api/src/db/schema.sql
git commit -m "feat(api): idempotency_key support in POST /visits/check-in"
```

### Task 12: Client-side offline queue (staff)

**Files:**
- Create: `packages/staff/src/lib/offlineQueue.ts`

- [ ] **Step 1: Write the library**

```ts
const DB_NAME = 'ohcs-queue';
const DB_VERSION = 1;
const STORES = ['clock-queue'] as const;
export type QueueTag = typeof STORES[number];

interface QueueRecord {
  id: string;
  endpoint: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(tag: QueueTag, record: QueueRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tag, 'readwrite');
    tx.objectStore(tag).add(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function queueCount(tag: QueueTag): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(tag, 'readonly');
    const req = tx.objectStore(tag).count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export type ApiOrQueueResult<T> = { ok: true; data: T } | { queued: true; id: string };

export async function apiOrQueue<T>(
  tag: QueueTag,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<ApiOrQueueResult<T>> {
  const idempotency_key = crypto.randomUUID();
  const fullBody = { ...body, idempotency_key };
  const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
  const url = `${apiBase}/api${endpoint}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullBody),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const parsed = await res.json() as { data: T };
    return { ok: true, data: parsed.data };
  } catch {
    await enqueue(tag, {
      id: idempotency_key,
      endpoint: url,
      method: 'POST',
      body: JSON.stringify(fullBody),
      headers: { 'Content-Type': 'application/json' },
      createdAt: Date.now(),
    });
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await (reg as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(tag);
      } catch {
        // Fallback: SW online handler will flush.
      }
    }
    return { queued: true, id: idempotency_key };
  }
}
```

- [ ] **Step 2: Type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/staff/src/lib/offlineQueue.ts
git commit -m "feat(staff): add IndexedDB offline queue with apiOrQueue"
```

### Task 13: Extend staff SW with queue replay + sync/message handlers

**Files:**
- Modify: `packages/staff/public/sw.js`

- [ ] **Step 1: Replace contents**

Replace `packages/staff/public/sw.js` entirely with:

```js
const CACHE_NAME = 'staff-clock-v3';
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
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE_NAME).then(cache => cache.put(e.request, c)); }
      return r;
    }).catch(async () => {
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/staff/public/sw.js
git commit -m "feat(staff): add SW background sync + message-based queue drain"
```

### Task 14: Use `apiOrQueue` for clock-in in ClockPage

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Refactor the clock mutation**

Read `ClockPage.tsx`. Find the existing `clockMutation` using `useMutation`. Replace its `mutationFn` to call `apiOrQueue` instead of `api.post`:

Add import at the top:

```tsx
import { apiOrQueue, type ApiOrQueueResult } from '@/lib/offlineQueue';
```

Update the mutation:

```tsx
const clockMutation = useMutation({
  mutationFn: async (data: { type: string; latitude: number; longitude: number }) => {
    return await apiOrQueue<ClockResult>('clock-queue', '/clock', data);
  },
  onSuccess: async (res) => {
    if ('queued' in res) {
      setPhase('success');
      setResult({
        id: res.id, type: clockType, timestamp: new Date().toISOString(),
        user_name: user?.name ?? '', staff_id: '', within_geofence: true,
        distance_meters: 0, streak: status?.streak ?? 0, longest_streak: status?.longest_streak ?? 0,
      } as ClockResult);
      return;
    }
    if (res.data && photoBlob) {
      const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
      await fetch(`${apiBase}/api/clock/${res.data.id}/photo`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'image/jpeg' },
        body: await photoBlob.arrayBuffer(),
      }).catch(() => {});
    }
    setResult(res.data);
    setPhase('success');
    queryClient.invalidateQueries({ queryKey: ['clock-status'] });
    stopCamera();
  },
  onError: (err) => {
    setErrorMsg(err instanceof Error ? err.message : 'Failed to clock');
    setPhase('error');
    stopCamera();
  },
});
```

Also listen for `queue-drained` messages from the SW to re-invalidate `clock-status`:

In the component body (add a new `useEffect`):

```tsx
useEffect(() => {
  function onMessage(e: MessageEvent) {
    if (e.data?.type === 'queue-drained') {
      queryClient.invalidateQueries({ queryKey: ['clock-status'] });
    }
  }
  navigator.serviceWorker?.addEventListener('message', onMessage);
  return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
}, [queryClient]);
```

- [ ] **Step 2: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): route clock mutation through offline queue"
```

### Task 15: Mirror Feature 2 in `packages/web` (visit check-in/out)

**Files:**
- Create: `packages/web/src/lib/offlineQueue.ts` (same shape as staff but stores list is `['visit-queue']`)
- Modify: `packages/web/public/sw.js` (same as Task 13 code but swap `QUEUE_STORES = ['visit-queue']` and `CACHE_NAME = 'smartgate-v5'`)
- Modify: the check-in and check-out callers on the web side to use `apiOrQueue` for `/visits/check-in` and for `/visits/:id/check-out`

- [ ] **Step 1: Create `packages/web/src/lib/offlineQueue.ts`**

Copy the contents from Task 12 Step 1. Change `const STORES = ['clock-queue'] as const;` to `const STORES = ['visit-queue'] as const;`. Leave the rest — `apiOrQueue` is generic.

- [ ] **Step 2: Replace `packages/web/public/sw.js`**

Copy the file contents from Task 13 Step 1. Change:
- `const CACHE_NAME = 'staff-clock-v3';` → `const CACHE_NAME = 'smartgate-v5';`
- `const QUEUE_STORES = ['clock-queue'];` → `const QUEUE_STORES = ['visit-queue'];`

- [ ] **Step 3: Use `apiOrQueue` at the check-in call site**

Find the file in `packages/web/src` where `/visits/check-in` is POSTed (likely a form submission in a visitor check-in page or component). Replace the `api.post('/visits/check-in', body)` with:

```tsx
import { apiOrQueue } from '@/lib/offlineQueue';
// ...
const res = await apiOrQueue<{ id: string; badge_code: string }>('visit-queue', '/visits/check-in', body);
if ('queued' in res) {
  // surface "queued" toast; UI should still advance
} else {
  // existing success handling
}
```

And for check-out, similarly replace `api.post('/visits/${id}/check-out', {})` — note that check-out's endpoint includes the ID, which is fine since we just pass the endpoint string to `apiOrQueue`.

- [ ] **Step 4: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/lib/offlineQueue.ts packages/web/public/sw.js <the modified check-in/out files>
git commit -m "feat(web): route visit check-in/out through offline queue"
```

---

## Phase D — Feature 3: Web Push Notifications

### Task 16: Generate VAPID keys and document the secret setup

**Files:**
- Create: `docs/ops/pwa-secrets.md`

- [ ] **Step 1: Generate keys locally**

Run from repo root:

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'});console.log('PUBLIC =',k.publicKey.export({type:'spki',format:'jwk'}));console.log('PRIVATE =',k.privateKey.export({type:'pkcs8',format:'jwk'}));"
```

Record the `x`, `y` (public JWK fields) and `d` (private JWK field). These are base64url strings.

The VAPID **public key** for applicationServerKey is the uncompressed EC point: `0x04 || x || y` → base64url. A one-liner:

```bash
node -e "const b=(s)=>Buffer.from(s,'base64url');const x=b(process.env.X);const y=b(process.env.Y);process.stdout.write(Buffer.concat([Buffer.from([4]),x,y]).toString('base64url'))" X=<jwk_x> Y=<jwk_y>
```

- [ ] **Step 2: Write `docs/ops/pwa-secrets.md`**

```md
# PWA Secrets — VAPID Keys

Web Push authentication uses a VAPID ECDSA P-256 keypair.

## Generate once

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'P-256'});console.log('PUBLIC =',k.publicKey.export({type:'spki',format:'jwk'}));console.log('PRIVATE =',k.privateKey.export({type:'pkcs8',format:'jwk'}));"
```

Record `x`, `y`, `d`.

## Worker secrets (API)

From `packages/api`:

```bash
npx wrangler secret put VAPID_PUBLIC_X
npx wrangler secret put VAPID_PUBLIC_Y
npx wrangler secret put VAPID_PRIVATE_D
```

Also add to `wrangler.toml` under `[vars]`:

```toml
VAPID_SUBJECT = "mailto:ops@ohcs.gov.gh"
```

## Frontend env (both Pages projects)

Compute the applicationServerKey (uncompressed EC point, base64url):

```bash
node -e "const b=(s)=>Buffer.from(s,'base64url');const x=b(process.env.X);const y=b(process.env.Y);process.stdout.write(Buffer.concat([Buffer.from([4]),x,y]).toString('base64url'))" X=<x> Y=<y>
```

Add to `.env` in each of `packages/staff` and `packages/web`:

```
VITE_VAPID_PUBLIC_KEY=<output of the above>
```

Also set the same var in Cloudflare Pages dashboard → staff-attendance → Settings → Environment variables, and same for the `ohcs-smartgate` project.
```

- [ ] **Step 3: Commit the doc**

```bash
git add docs/ops/pwa-secrets.md
git commit -m "docs: VAPID key generation and secret placement"
```

> **Manual step for operator:** Generate the keys and set the three `VAPID_*` worker secrets and `VITE_VAPID_PUBLIC_KEY` env var before Phase D Task 20 is deployed. The code below reads those values; running without them will cause `sendPush` to log and skip (safe degradation).

### Task 17: Add `push_subscriptions` table

**Files:**
- Create: `packages/api/src/db/migration-push-subscriptions.sql`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Migration file**

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id),
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
```

- [ ] **Step 2: Apply + mirror in schema.sql**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-push-subscriptions.sql
```

Append the same `CREATE TABLE` + `CREATE INDEX` block to `packages/api/src/db/schema.sql` (after the last existing table).

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/migration-push-subscriptions.sql packages/api/src/db/schema.sql
git commit -m "feat(db): add push_subscriptions table"
```

### Task 18: Web Push library (VAPID JWT + aes128gcm)

**Files:**
- Create: `packages/api/src/lib/webpush.ts`

- [ ] **Step 1: Write the library**

```ts
// Web Push implementation for Cloudflare Workers using Web Crypto.
// - VAPID JWT (ES256) per RFC 8292
// - aes128gcm payload encryption per RFC 8291

function b64urlToBytes(b64: string): Uint8Array {
  const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 3 ? '=' : '';
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

async function importVapidPrivate(d: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d, x: '', y: '', ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// The subtle API requires x,y in JWK. We accept them separately.
async function importVapidPrivateFull(x: string, y: string, d: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x, y, d, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function createVapidJwt(params: { audience: string; subject: string; x: string; y: string; d: string }): Promise<string> {
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({ aud: params.audience, exp, sub: params.subject })));
  const input = `${header}.${payload}`;
  const key = await importVapidPrivateFull(params.x, params.y, params.d);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return `${input}.${bytesToB64url(new Uint8Array(sig))}`;
}

// HKDF helper
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, length * 8);
  return new Uint8Array(bits);
}

// Encrypt payload for Web Push per RFC 8291 (aes128gcm content-encoding)
export async function encryptPayload(payload: Uint8Array, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const recipientPublic = b64urlToBytes(p256dhB64);
  const auth = b64urlToBytes(authB64);

  // Generate ephemeral P-256 keypair
  const ephem = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephemPublicJwk = await crypto.subtle.exportKey('jwk', ephem.publicKey);
  const ephemPublicRaw = concat(new Uint8Array([4]), b64urlToBytes(ephemPublicJwk.x!), b64urlToBytes(ephemPublicJwk.y!));

  // Import recipient public for ECDH
  const recipJwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(recipientPublic.slice(1, 33)),
    y: bytesToB64url(recipientPublic.slice(33, 65)),
    ext: true,
  };
  const recipKey = await crypto.subtle.importKey('jwk', recipJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipKey }, ephem.privateKey, 256);
  const shared = new Uint8Array(sharedBits);

  // Generate 16-byte salt
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  // PRK_key = HKDF-Extract(auth, shared)
  // IKM = HKDF-Expand(PRK_key, info_key, 32) where info_key = "WebPush: info" || 0x00 || ua_public || as_public
  const infoKey = concat(new TextEncoder().encode('WebPush: info\0'), recipientPublic, ephemPublicRaw);
  const prkKey = await hkdf(auth, shared, infoKey, 32);

  // CEK = HKDF(salt, IKM, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(salt, prkKey, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  // NONCE = HKDF(salt, IKM, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, prkKey, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Encrypt. Pad: 0x02 terminator for single-record payloads.
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, plaintext as BufferSource));

  // Build header: salt(16) || rs(4 BE) || idlen(1) || keyid (ephemPublicRaw, 65 bytes)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const idlen = new Uint8Array([ephemPublicRaw.length]);
  return concat(salt, rs, idlen, ephemPublicRaw, ciphertext);
}

export interface WebPushEnv {
  VAPID_PUBLIC_X: string;
  VAPID_PUBLIC_Y: string;
  VAPID_PRIVATE_D: string;
  VAPID_SUBJECT: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPush(target: PushTarget, payload: object, env: WebPushEnv): Promise<number> {
  if (!env.VAPID_PUBLIC_X || !env.VAPID_PRIVATE_D) {
    console.warn('[webpush] VAPID keys not set; skipping');
    return 0;
  }
  const url = new URL(target.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await createVapidJwt({ audience, subject: env.VAPID_SUBJECT, x: env.VAPID_PUBLIC_X, y: env.VAPID_PUBLIC_Y, d: env.VAPID_PRIVATE_D });
  const appServerKey = bytesToB64url(concat(new Uint8Array([4]), b64urlToBytes(env.VAPID_PUBLIC_X), b64urlToBytes(env.VAPID_PUBLIC_Y)));
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await encryptPayload(body, target.p256dh, target.auth);
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${appServerKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body: encrypted as BodyInit,
  });
  return res.status;
}
```

- [ ] **Step 2: Update `Env` interface**

In `packages/api/src/types.ts`, add the VAPID fields to `Env`:

```ts
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  STORAGE: R2Bucket;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  ENVIRONMENT: string;
  VAPID_PUBLIC_X: string;
  VAPID_PUBLIC_Y: string;
  VAPID_PRIVATE_D: string;
  VAPID_SUBJECT: string;
}
```

- [ ] **Step 3: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/lib/webpush.ts packages/api/src/types.ts
git commit -m "feat(api): add VAPID-signed Web Push library (aes128gcm)"
```

### Task 19: Push subscribe/unsubscribe/status endpoints

**Files:**
- Create: `packages/api/src/routes/notifications-push.ts`
- Modify: `packages/api/src/index.ts` (mount the router)

- [ ] **Step 1: Create the router**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { getSession } from '../services/auth';
import { success, error } from '../lib/response';

export const notificationsPushRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(10),
    auth: z.string().min(10),
  }),
});

async function requireSession(c: Parameters<Parameters<typeof notificationsPushRoutes.post>[1]>[0]): Promise<SessionData | null> {
  const sid = getCookie(c, 'session_id');
  if (!sid) return null;
  return await getSession(sid, c.env);
}

notificationsPushRoutes.post('/subscribe', zValidator('json', subscribeSchema), async (c) => {
  const session = await requireSession(c);
  if (!session) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const { endpoint, keys } = c.req.valid('json');

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(session.userId, endpoint, keys.p256dh, keys.auth).run();

  return success(c, { ok: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

notificationsPushRoutes.post('/unsubscribe', zValidator('json', unsubscribeSchema), async (c) => {
  const session = await requireSession(c);
  if (!session) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const { endpoint } = c.req.valid('json');
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .bind(session.userId, endpoint).run();
  return success(c, { ok: true });
});

notificationsPushRoutes.get('/status', async (c) => {
  const session = await requireSession(c);
  if (!session) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?')
    .bind(session.userId).first<{ n: number }>();
  return success(c, { subscribed: (row?.n ?? 0) > 0, endpoints: row?.n ?? 0 });
});
```

- [ ] **Step 2: Mount the router**

In `packages/api/src/index.ts`, find where other routers are mounted (e.g., `app.route('/api/auth', authRoutes)`). Add:

```ts
import { notificationsPushRoutes } from './routes/notifications-push';
// ...
app.route('/api/notifications/push', notificationsPushRoutes);
```

- [ ] **Step 3: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/notifications-push.ts packages/api/src/index.ts
git commit -m "feat(api): add push subscribe/unsubscribe/status endpoints"
```

### Task 20: Fork-call `sendPush` from notification creation

**Files:**
- Modify: `packages/api/src/services/notifier.ts` (lines 164-181)

- [ ] **Step 1: Fork-call sendPush**

At the top of `notifier.ts`, add:

```ts
import { sendWebPush, type PushTarget } from '../lib/webpush';

const PUSH_WHITELIST = new Set(['visitor_arrival', 'clock_reminder', 'late_clock_alert', 'monthly_report_ready']);
```

After the existing `INSERT INTO notifications ...` call inside `createInAppNotification`, add:

```ts
// Fork-send web-push for whitelisted types (fire-and-forget).
const type = 'visitor_arrival'; // hardcoded in this function; use a variable if type is dynamic
if (PUSH_WHITELIST.has(type)) {
  const subs = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();
  for (const s of subs.results ?? []) {
    const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
    sendWebPush(target, {
      title: 'Visitor arrived',
      body: customBody ?? 'You have a visitor',
      url: '/',
      type,
    }, env).catch(() => {}); // log & swallow
  }
}
```

(If `createInAppNotification` is later generalized to accept other types, make `type` a parameter and update `PUSH_WHITELIST.has(type)` accordingly.)

- [ ] **Step 2: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/notifier.ts
git commit -m "feat(api): fork-send web push for whitelisted notifications"
```

### Task 21: Push + notificationclick handlers in both SWs

**Files:**
- Modify: `packages/staff/public/sw.js`
- Modify: `packages/web/public/sw.js`

- [ ] **Step 1: Append push handlers to staff SW**

At the end of `packages/staff/public/sw.js`, append:

```js
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'OHCS SmartGate';
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
```

Also bump `CACHE_NAME` one more time to invalidate the previous cache on rollout (`'staff-clock-v4'`).

- [ ] **Step 2: Same append to web SW**

Append the exact same block to `packages/web/public/sw.js`. Bump `CACHE_NAME` to `'smartgate-v6'`.

- [ ] **Step 3: Commit**

```bash
git add packages/staff/public/sw.js packages/web/public/sw.js
git commit -m "feat: add push + notificationclick handlers in service workers"
```

### Task 22: Push client + toggle component (staff)

**Files:**
- Create: `packages/staff/src/lib/pushClient.ts`
- Create: `packages/staff/src/components/PushToggle.tsx`

- [ ] **Step 1: Push client helper**

```ts
export async function getPushStatus(): Promise<{ subscribed: boolean; endpoints: number }> {
  const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
  const res = await fetch(`${apiBase}/api/notifications/push/status`, { credentials: 'include' });
  if (!res.ok) return { subscribed: false, endpoints: 0 };
  const { data } = await res.json() as { data: { subscribed: boolean; endpoints: number } };
  return data;
}

function urlB64ToUint8Array(b64: string): Uint8Array {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Push not supported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permission denied');
  const vapidPub = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPub) throw new Error('VAPID public key not configured');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(vapidPub),
  });
  const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
  const json = sub.toJSON();
  await fetch(`${apiBase}/api/notifications/push/subscribe`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
  await fetch(`${apiBase}/api/notifications/push/unsubscribe`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}
```

- [ ] **Step 2: `PushToggle.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { enablePush, disablePush, getPushStatus } from '@/lib/pushClient';

export function PushToggle() {
  const [state, setState] = useState<'idle' | 'loading' | 'on' | 'off' | 'unsupported'>('loading');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    getPushStatus().then(s => setState(s.subscribed ? 'on' : 'off')).catch(() => setState('off'));
  }, []);

  if (state === 'unsupported') {
    return <div className="text-[12px] text-gray-500 text-center py-2">Push notifications not supported on this browser.</div>;
  }

  async function toggle() {
    setErr('');
    const was = state;
    setState('loading');
    try {
      if (was === 'on') {
        await disablePush();
        setState('off');
      } else {
        await enablePush();
        setState('on');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
      setState(was);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={toggle}
        disabled={state === 'loading'}
        className="w-full h-11 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-semibold text-[14px] hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
      >
        {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
         state === 'on' ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {state === 'on' ? 'Disable notifications' : 'Enable notifications'}
      </button>
      {err && <p className="text-red-600 text-[11px] font-medium text-center">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Wire into `SettingsMenu`**

In `packages/staff/src/components/SettingsMenu.tsx`, add `import { PushToggle } from './PushToggle';` and render `<PushToggle />` inside the dropdown panel, below `<InstallButton />`:

```tsx
<div className="absolute right-0 top-11 z-30 bg-white rounded-xl shadow-xl border border-gray-200 w-64 p-3 space-y-2">
  <InstallButton />
  <PushToggle />
</div>
```

- [ ] **Step 4: Type-check and commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/lib/pushClient.ts packages/staff/src/components/PushToggle.tsx packages/staff/src/components/SettingsMenu.tsx
git commit -m "feat(staff): add push toggle in settings menu"
```

### Task 23: Mirror Task 22 in `packages/web`

**Files:**
- Create: `packages/web/src/lib/pushClient.ts` (identical to Task 22 Step 1)
- Create: `packages/web/src/components/PushToggle.tsx` (identical to Task 22 Step 2)
- Modify: `packages/web/src/components/SettingsMenu.tsx` (add PushToggle)

- [ ] **Step 1: Copy and commit**

```bash
# Duplicate files
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/lib/pushClient.ts packages/web/src/components/PushToggle.tsx packages/web/src/components/SettingsMenu.tsx
git commit -m "feat(web): add push toggle in settings menu"
```

---

## Phase E — Deploy & Verify

### Task 24: Deploy

- [ ] **Step 1: Apply migrations to remote D1**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-clock-idempotency.sql
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-visits-idempotency.sql
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-push-subscriptions.sql
```

- [ ] **Step 2: Set VAPID secrets (operator runs these interactively)**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js secret put VAPID_PUBLIC_X
node ../../node_modules/wrangler/bin/wrangler.js secret put VAPID_PUBLIC_Y
node ../../node_modules/wrangler/bin/wrangler.js secret put VAPID_PRIVATE_D
```

Add to `wrangler.toml` vars:

```toml
VAPID_SUBJECT = "mailto:ops@ohcs.gov.gh"
```

- [ ] **Step 3: Deploy API Worker**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js deploy
```

- [ ] **Step 4: Set `VITE_VAPID_PUBLIC_KEY` in Pages env and rebuild frontends**

Add `VITE_VAPID_PUBLIC_KEY=<app-server-key>` to `.env` of each package (or Pages dashboard env vars).

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
node node_modules/typescript/bin/tsc -b packages/staff && node node_modules/vite/bin/vite.js build packages/staff
node node_modules/typescript/bin/tsc -b packages/web && node node_modules/vite/bin/vite.js build packages/web

cd packages/staff
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=staff-attendance --branch=main --commit-dirty=true

cd ../web
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=ohcs-smartgate --branch=main --commit-dirty=true
```

- [ ] **Step 5: Push to GitHub**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
git push origin main
```

### Task 25: Manual verification

- [ ] **Offline indicator:** Open staff app. DevTools → Network → Offline. Red banner appears within 1s. Restore → banner disappears.
- [ ] **Offline fallback page:** DevTools → Application → Storage → Clear site data. DevTools → Offline. Reload. Offline.html renders.
- [ ] **Install button:** On Android Chrome, open staff app. Settings menu → Install app → native install sheet appears. Accept. App opens as PWA.
- [ ] **Offline clock-in:** Log in as `1334685`/`1118` (acknowledged). Go offline. Clock in. Toast "queued" (or "success" — depending on UI). Go online. Within 5s, `queue-drained` message arrives; clock-status invalidates; the clock-in shows as recorded server-side.
- [ ] **Push:** Settings menu → Enable notifications → grant permission. From an admin session, create a test visitor-arrival notification targeted at user `1334685`. Within 10s an OS-level notification appears. Tap it → app opens.
- [ ] **Web side mirror:** same checks on `ohcs-smartgate` for visitor check-in/out.

---

## Self-Review Notes

- **Spec coverage:**
  - Feature 1 (offline indicator + fallback) → Tasks 1–4.
  - Feature 2 (offline queue + idempotency) → Tasks 10–15.
  - Feature 3 (push) → Tasks 16–23.
  - Feature 4 (A2HS install) → Tasks 5–9.
- **Ordering:** Feature 1 & 4 (pure client) first; Feature 2 next (touches SW + API idempotency); Feature 3 last (biggest, touches DB, crypto, SW). Matches spec ordering.
- **Deviations from spec:**
  - Spec said notification types `visitor_arrived`; the codebase uses `visitor_arrival`. Plan uses the existing string to avoid breaking existing consumers. Whitelist includes both-ish forms: `visitor_arrival` only for now; add more when those notification types are actually implemented in the notifier.
- **Known risks:**
  - VAPID + aes128gcm code (Task 18) is tricky. If the first run fails to deliver (pushes return non-2xx), the most likely issues are: JWK field ordering, salt/info byte order, or the `0x02` padding terminator. Cross-check against RFC 8291 and use FCM's echo endpoint to debug.
  - iOS Safari requires iOS 16.4+ for Web Push in PWAs; older iOS shows the "unsupported" state. That's expected behavior.
- **Type consistency:**
  - `apiOrQueue<T>()` returns `{ ok: true; data: T } | { queued: true; id: string }` used consistently.
  - `PushTarget` interface reused between `webpush.ts` and the fork-call site.
  - VAPID env fields `VAPID_PUBLIC_X/Y/PRIVATE_D/SUBJECT` used consistently across `Env`, `webpush.ts`, and `pwa-secrets.md`.
