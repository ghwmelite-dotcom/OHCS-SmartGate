# PWA Completeness — Design

**Date:** 2026-04-17
**Scope:** `packages/staff`, `packages/web`, `packages/api`. Closes four PWA gaps identified in the prior audit: A2HS install button, Web Push notifications, offline mutation queue, offline indicator + fallback page.

## Goal

Raise both frontend PWAs (staff attendance app, visitor management web app) from ~78% to ~95% PWA completeness by:

1. Letting users install the app from the app itself.
2. Delivering high-signal events as web-push notifications when the app is closed.
3. Queuing clock-in/out and visitor check-in/out when offline and syncing on reconnect.
4. Showing a clear offline indicator and serving a dedicated offline fallback page.

---

## Feature 1 — Offline Indicator & Fallback

### Behavior

- A small red banner appears at the top of the app when `navigator.onLine === false`. Text: *"You're offline. Changes will sync when you reconnect."*
- When Feature 2's queue has pending items, banner text becomes *"You're offline. N pending."* Count updates as items enqueue/drain.
- When connectivity returns, the banner disappears. If the queue had items, a green toast fires: *"Synced N items ✓."*
- Navigation requests to routes the SW has never cached fall back to `/offline.html` (rather than the current `/` app-shell fallback, which might leave the user on a broken in-app state).

### Data / infra

None. Pure client-side.

### Files touched

- Create: `packages/staff/src/hooks/useOnlineStatus.ts`
- Create: `packages/staff/src/components/OfflineBanner.tsx`
- Create: `packages/staff/public/offline.html`
- Modify: `packages/staff/public/sw.js` (fetch handler fallback)
- Modify: `packages/staff/src/App.tsx` (render `OfflineBanner`)
- Symmetric creates/modifies under `packages/web/`

---

## Feature 2 — Offline Mutation Queue (Background Sync + fallback)

### Behavior

- Wrap critical mutations: clock-in/out (staff), visit check-in/out (web). Wrapped call tries normal `POST`; on network error, enqueues to IndexedDB and resolves with `{ queued: true }`. UI shows *"Saved offline. Will sync when you reconnect."*
- On reconnect (via Background Sync if supported, or `window.online` message to SW as fallback), SW drains the queue by replaying each mutation. 2xx → delete record. 4xx → delete record and log. 5xx/network error → stop draining (retry on next sync).
- Drain completion posts a message to any open client: `{ type: 'queue-drained', synced: N, failed: M }`. UI surfaces a toast.

### Data / infra

- IndexedDB `ohcs-queue` (one per origin, shared between staff and web if ever on same origin — in practice they're different subdomains so each package has its own).
- Object stores: `clock-queue` (staff-only), `visit-queue` (web-only). Records: `{ id: UUID, endpoint: string, method: 'POST', body: string, headers: Record<string,string>, createdAt: number }`.

### Scope

**Queued endpoints:**
- Staff: `POST /clock`
- Web: `POST /visits`, `POST /visits/:id/check-out`

**NOT queued (explicit):**
- Any GET
- Auth endpoints (`/auth/*`)
- Admin CRUD (users, directorates, officers, categories)
- Photo uploads (binary bodies, not worth queueing; user-facing flow can retry)

### Edge cases

- **Duplicate submission:** if a clock-in is enqueued and the user re-clocks when back online before the queue drains, the replay may create a duplicate. Mitigation: queue record includes an `idempotency_key` (UUID) and the API's clock endpoint dedupes by it. (If adding idempotency to the clock endpoint is out of scope, this risk is accepted — receptionist can delete dupes.)
- **Queue staleness:** records older than 24h are dropped during drain (to avoid replaying yesterday's attempted clock-in today).
- **iOS Safari:** no Background Sync API. Fallback: client listens for `window.online`, posts `{type:'flush-queue'}` to `navigator.serviceWorker.controller`; SW drains on receipt.

### Files touched

- Create: `packages/staff/src/lib/offlineQueue.ts` (client-side IDB wrapper + `apiOrQueue()`).
- Modify: `packages/staff/public/sw.js` (IDB open, sync handler, message handler, replay logic).
- Modify: `packages/staff/src/pages/ClockPage.tsx` (use `apiOrQueue` for clock mutation; react to toast).
- Symmetric on `packages/web/` for visit check-in / check-out.
- Modify: `packages/api/src/routes/clock.ts` and `packages/api/src/routes/visits.ts` — accept optional `idempotency_key` and dedupe.

---

## Feature 3 — Web Push Notifications

### Behavior

- Users opt in via a button in Settings ("Enable notifications"). Clicking requests permission → creates a push subscription → POSTs it to the API.
- Whenever the API creates one of the whitelisted in-app notification types, it also fires a web-push to all that user's active subscriptions.
- Tapping a push opens the app at a deep link (or focuses an existing window).

### Whitelist

Push is sent only for notifications of these types:
- `visitor_arrived` (a visitor has arrived for this officer)
- `clock_reminder` (daily nudge to clock in/out)
- `late_clock_alert` (sent to supervisors when an officer is late)
- `monthly_report_ready` (monthly attendance report generated)

All other in-app notifications stay in-app only.

### Data / infra

**New D1 table:**
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

**VAPID keys (one-time generation):**
- `VAPID_PUBLIC_KEY` — base64url, baked into frontend builds via `VITE_VAPID_PUBLIC_KEY`.
- `VAPID_PRIVATE_KEY` — base64url, Worker secret.
- `VAPID_SUBJECT` — `mailto:ops@ohcs.gov.gh` (Worker env var).

### API additions

- `POST /notifications/push/subscribe` — authenticated. Body: `{ endpoint: string, keys: { p256dh: string, auth: string } }`. Upsert by `endpoint` (ON CONFLICT update `user_id`). Returns `{ ok: true }`.
- `DELETE /notifications/push/unsubscribe` — authenticated. Body: `{ endpoint: string }`. Deletes the row if `user_id` matches. Returns `{ ok: true }`.
- `GET /notifications/push/status` — authenticated. Returns `{ subscribed: boolean, endpoints: number }` (for Settings UI to show state).

### Push send flow

`sendPush(userId: string, payload: { title, body, url, type })`:

1. `SELECT * FROM push_subscriptions WHERE user_id = ?`.
2. For each subscription, build the web-push request:
   - VAPID JWT (ES256-signed via Web Crypto), `aud = endpoint origin`, `exp = now+12h`, `sub = VAPID_SUBJECT`.
   - Encrypt payload with `aes128gcm` per RFC 8291 (Web Crypto P-256 ECDH + HKDF). Use library `@negrel/webpush` or hand-rolled against Web Crypto — implementation detail.
   - `POST endpoint` with `Authorization: vapid t=JWT, k=VAPID_PUBLIC_KEY_B64URL`, `Content-Encoding: aes128gcm`, `TTL: 86400`, body = encrypted payload.
3. Response handling: `201` or `202` → success. `410` or `404` → delete subscription. Other errors → log.

Fork-call point: the existing in-app notification creation flow (will be located during implementation) adds a branch:

```ts
await createInAppNotification(userId, ...);
if (PUSH_WHITELIST.includes(type)) {
  await sendPush(userId, { title, body, url, type }); // fire-and-forget via c.executionCtx.waitUntil()
}
```

### Frontend flow

- `/notifications/push/status` called on app mount to determine toggle state.
- "Enable notifications" button in Settings:
  - State: disabled / enabled / not-supported (browser lacks `PushManager`).
  - On click (enable): `await Notification.requestPermission()` → denial = error toast; granted = `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })` → POST to `/notifications/push/subscribe` → success toast.
  - On click (disable): `reg.pushManager.getSubscription()` → `sub.unsubscribe()` → DELETE to `/notifications/push/unsubscribe`.
- SW handlers:
  ```js
  self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};
    event.waitUntil(self.registration.showNotification(data.title ?? 'OHCS SmartGate', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url ?? '/' },
    }));
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url ?? '/';
    event.waitUntil(clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) { if (c.url.includes(url) && 'focus' in c) return c.focus(); }
      return clients.openWindow(url);
    }));
  });
  ```

### Files touched

- Create: `packages/api/src/db/migration-push-subscriptions.sql`
- Modify: `packages/api/src/db/schema.sql`
- Create: `packages/api/src/lib/webpush.ts` (VAPID JWT + AES128GCM encryption + send).
- Create: `packages/api/src/routes/notifications-push.ts` (subscribe/unsubscribe/status endpoints).
- Modify: `packages/api/src/index.ts` (mount the new router).
- Modify: wherever the in-app notification is created (located during implementation) to fork-call `sendPush` for whitelisted types.
- Create per package: `src/lib/pushClient.ts`, `src/components/PushToggle.tsx`.
- Modify per package: `public/sw.js` (push + notificationclick handlers), `src/components/PwaSettings.tsx` (or equivalent settings area — located during implementation).

### Secrets setup

Document (in a new `docs/ops/pwa-secrets.md` or added to the plan) how to:
- Generate VAPID keys: `node -e "const k = require('crypto').generateKeyPairSync('ec',{namedCurve:'P-256'});console.log('pub:',k.publicKey.export({type:'spki',format:'der'}).toString('base64url'));console.log('priv:',k.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'))"` or use `web-push generate-vapid-keys` once locally.
- Set the Worker secrets: `wrangler secret put VAPID_PRIVATE_KEY`, `wrangler secret put VAPID_SUBJECT`.
- Add `VITE_VAPID_PUBLIC_KEY=<pub>` to both frontend `.env` files and Pages env vars.

---

## Feature 4 — A2HS Install Button

### Behavior

- Button labeled **"Install app"** in the Settings menu area of each package.
- Visibility logic:
  - Already installed (detected via `window.matchMedia('(display-mode: standalone)').matches` or `navigator.standalone`): button hidden.
  - `beforeinstallprompt` event fired and stashed: button visible and enabled.
  - iOS device (UA regex `/iPad|iPhone|iPod/` and not `standalone`): button visible; click shows instructions modal.
  - Otherwise (desktop without prompt fired, unsupported browser): button hidden.
- Click (stashed prompt): `deferredPrompt.prompt()` → await `deferredPrompt.userChoice` → if `accepted` show *"Installed — find the app on your home screen."*; if `dismissed` clear stash silently.
- Click (iOS): modal with illustrated instructions.
- On `appinstalled`: clear stash and hide button.

### Files touched

- Create per package: `src/stores/install.ts` (Zustand slice holding the deferred prompt + install state).
- Create per package: `src/components/InstallButton.tsx`.
- Create per package: `src/components/IosInstallInstructions.tsx`.
- Modify per package: `src/main.tsx` (global listeners for `beforeinstallprompt` and `appinstalled`).
- Modify per package: the Settings surface (located during implementation) to render `InstallButton`.

---

## Shared Decisions

- **No new workspace package.** Utilities are small enough to duplicate between `packages/staff` and `packages/web` (~150-200 lines each side). Avoids adding a monorepo package dependency graph for marginal DRY gain.
- **Service workers diverge.** Each package's `public/sw.js` is edited independently because they have different endpoint lists to queue and different cache namespaces.
- **Opt-in push, not auto-prompt.** Users explicitly enable via Settings. No permission prompts at login.
- **TypeScript strict mode preserved.** No `any`.
- **Tailwind for styling.** Match existing color palette (`#1A4D2E`, `#D4A017`) and component style (rounded-2xl cards, Playfair Display headings).

## Out of Scope

- Offline reading of historical data (past visits, past clock-ins).
- Periodic Background Sync.
- Android shortcuts, widgets.
- Push notifications to users who have never logged in.
- Native OS integrations (share target, file handlers, etc.).
- Unsubscribe-via-email links.

## Acceptance Criteria (whole feature set)

1. **Install:** From Chrome on Android, tapping **Install app** in Settings produces the native install sheet. Dismissing hides it until next session. On iOS, tapping **Install app** shows a 3-step Share → Add to Home Screen dialog.
2. **Offline UX:** Turning off wifi while on ClockPage (staff) makes the banner appear within 1s. A clock-in attempted offline shows *"Saved offline…"* toast. Restoring wifi: banner disappears, toast *"Synced 1 item ✓"* fires within 3s (desktop Chrome) or within 3s of returning to the app (mobile Safari via online-event fallback).
3. **Push:** From Settings, tapping **Enable notifications** requests permission; after granting, an admin creating a whitelisted notification produces an OS-level push within 10s. Tapping the push opens the relevant page.
4. **All four features** run without type-check errors, without console errors on load, and without regressions to existing flows (existing tests — curl-based and manual — still pass).

---

## Implementation Ordering (will be detailed in plan)

1. Feature 1 (offline indicator) — pure client, smallest blast radius, unlocks UX for later features.
2. Feature 4 (A2HS) — also pure client, independent of API.
3. Feature 2 (offline queue) — depends on SW changes; coordinate with Feature 1's SW edit in the same touch.
4. Feature 3 (push) — largest; API + DB + frontend; do last since it has the most moving parts.
