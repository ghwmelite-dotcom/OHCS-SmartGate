# Bearer Token Auth Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the installed-PWA login loop on mobile by letting the API accept a session ID via either cookie or `Authorization: Bearer` header, and having the frontend stash and send the ID as a token.

**Architecture:** API gains a `readSessionId(c)` helper that prefers the cookie and falls back to the Bearer header. Login responses include `session_token: <sessionId>`. Clients stash it in `localStorage` under `ohcs.token` and attach it via `Authorization` header on every fetch (including offline-queue replays). Cookie flow stays untouched.

**Tech Stack:** Cloudflare Workers + Hono + D1 + KV (API). React 18 + Zustand + TanStack Query + IndexedDB (staff + web frontends). No new deps.

---

## File Structure

**New files:**
- `packages/staff/src/lib/tokenStore.ts`
- `packages/web/src/lib/tokenStore.ts`

**Modified files:**
- `packages/api/src/services/auth.ts` (add `readSessionId` export)
- `packages/api/src/middleware/auth.ts` (use helper)
- `packages/api/src/routes/auth.ts` (use helper in `/change-pin` and `/me`; add `session_token` to two login responses)
- `packages/staff/src/lib/api.ts` (attach header)
- `packages/staff/src/stores/auth.ts` (stash/clear token)
- `packages/staff/src/lib/offlineQueue.ts` (embed header in queued records)
- `packages/web/src/lib/api.ts` (attach header)
- `packages/web/src/stores/auth.ts` (stash/clear token)
- `packages/web/src/lib/offlineQueue.ts` (embed header)

---

## Task 1: Server — `readSessionId` helper + middleware update

**Files:**
- Modify: `packages/api/src/services/auth.ts`
- Modify: `packages/api/src/middleware/auth.ts`

- [ ] **Step 1: Add `readSessionId` export at end of `services/auth.ts`**

Add these imports near the top if missing:
```ts
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
```

Append at the end of the file:
```ts
/**
 * Read a session ID from either the `session_id` cookie or an
 * `Authorization: Bearer <id>` header. Cookie wins when both are
 * present (backward-compatible).
 */
export function readSessionId(c: Context): string | null {
  const cookie = getCookie(c, 'session_id');
  if (cookie) return cookie;
  const auth = c.req.header('authorization') ?? '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}
```

- [ ] **Step 2: Update `middleware/auth.ts` to use the helper**

Current file:
```ts
import { createMiddleware } from 'hono/factory';
import type { Env, SessionData } from '../types';
import { getSession } from '../services/auth';
import { getCookie } from 'hono/cookie';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionData };
}>(async (c, next) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const session = await getSession(sessionId, c.env);
  if (!session) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, 401);
  }

  c.set('session', session);
  await next();
});
```

Replace entirely with:
```ts
import { createMiddleware } from 'hono/factory';
import type { Env, SessionData } from '../types';
import { getSession, readSessionId } from '../services/auth';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionData };
}>(async (c, next) => {
  const sessionId = readSessionId(c);
  if (!sessionId) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const session = await getSession(sessionId, c.env);
  if (!session) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, 401);
  }

  c.set('session', session);
  await next();
});
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/auth.ts packages/api/src/middleware/auth.ts
git commit -m "feat(api): readSessionId accepts cookie or Bearer header"
```

---

## Task 2: Server — `/change-pin` and `/me` use the helper; login responses emit `session_token`

**Files:**
- Modify: `packages/api/src/routes/auth.ts`

- [ ] **Step 1: Import `readSessionId`**

At the top of `packages/api/src/routes/auth.ts`, update the import from `services/auth`:

Find:
```ts
import { createOtp, verifyOtp, verifyPin, hashPin, createSession, deleteSession, getSession } from '../services/auth';
```

Replace with:
```ts
import { createOtp, verifyOtp, verifyPin, hashPin, createSession, deleteSession, getSession, readSessionId } from '../services/auth';
```

- [ ] **Step 2: `/logout` uses the helper**

Find:
```ts
authRoutes.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (sessionId) {
    await deleteSession(sessionId, c.env);
  }
  deleteCookie(c, 'session_id', { path: '/' });
  return success(c, { message: 'Logged out' });
});
```

Replace with:
```ts
authRoutes.post('/logout', async (c) => {
  const sessionId = readSessionId(c);
  if (sessionId) {
    await deleteSession(sessionId, c.env);
  }
  deleteCookie(c, 'session_id', { path: '/' });
  return success(c, { message: 'Logged out' });
});
```

- [ ] **Step 3: `/change-pin` uses the helper**

Find the `/change-pin` handler (around line 156). Its first two lines:
```ts
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
```

Replace with:
```ts
  const sessionId = readSessionId(c);
  if (!sessionId) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
```

- [ ] **Step 4: `/me` uses the helper**

Find the `/me` handler (around line 179). Its first two lines:
```ts
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  }
```

Replace with:
```ts
  const sessionId = readSessionId(c);
  if (!sessionId) {
    return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  }
```

- [ ] **Step 5: `/verify` response includes `session_token`**

In the `/verify` handler, find the final return:
```ts
  return success(c, { user: { id: user.id, name: user.name, email: user.email, role: user.role } });
```

Replace with:
```ts
  return success(c, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      session_token: sessionId,
    },
  });
```

- [ ] **Step 6: `/pin-login` response includes `session_token`**

In the `/pin-login` handler, find the final return:
```ts
  return success(c, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      pin_acknowledged: user.pin_acknowledged === 1,
    },
  });
```

Replace with:
```ts
  return success(c, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      pin_acknowledged: user.pin_acknowledged === 1,
      session_token: sessionId,
    },
  });
```

- [ ] **Step 7: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/auth.ts
git commit -m "feat(api): emit session_token in login responses; use readSessionId in /me, /change-pin, /logout"
```

---

## Task 3: Staff — `tokenStore` + `api.ts` header injection

**Files:**
- Create: `packages/staff/src/lib/tokenStore.ts`
- Modify: `packages/staff/src/lib/api.ts`

- [ ] **Step 1: Create tokenStore.ts**

```ts
const KEY = 'ohcs.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    // localStorage disabled (private mode, blocked, etc.) — ignore.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
```

- [ ] **Step 2: Modify `packages/staff/src/lib/api.ts`**

Replace the entire file with:

```ts
import { getToken } from './tokenStore';

const API_BASE = import.meta.env.PROD
  ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev/api'
  : '/api';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  const json = await res.json() as ApiResponse<T>;
  if (!res.ok || json.error) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.location.href = '/login';
    throw new ApiError(json.error?.code ?? 'UNKNOWN', json.error?.message ?? 'Error', res.status);
  }
  return json;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }),
};
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/lib/tokenStore.ts packages/staff/src/lib/api.ts
git commit -m "feat(staff): tokenStore + api.ts attaches Bearer header when present"
```

---

## Task 4: Staff — auth store stashes and clears the token

**Files:**
- Modify: `packages/staff/src/stores/auth.ts`

- [ ] **Step 1: Add imports**

Near the top of `packages/staff/src/stores/auth.ts`, add:
```ts
import { setToken, clearToken } from '@/lib/tokenStore';
```

- [ ] **Step 2: Widen response type to include session_token and capture it**

The current `loginWithPin` action:
```ts
loginWithPin: async (staffId, pin) => {
  const res = await api.post<{ user: User }>('/auth/pin-login', { staff_id: staffId, pin, remember: true });
  set({ user: res.data?.user ?? null });
},
```

Replace with:
```ts
loginWithPin: async (staffId, pin) => {
  const res = await api.post<{ user: User & { session_token?: string } }>('/auth/pin-login', { staff_id: staffId, pin, remember: true });
  if (res.data?.user?.session_token) {
    setToken(res.data.user.session_token);
  }
  const u = res.data?.user;
  if (u) {
    // Strip session_token from what we store in the Zustand user object.
    const { session_token: _discard, ...userForStore } = u;
    void _discard;
    set({ user: userForStore as User });
  } else {
    set({ user: null });
  }
},
```

- [ ] **Step 3: `logout` clears the token BEFORE the API call**

Current:
```ts
logout: async () => {
  await api.post('/auth/logout', {});
  set({ user: null });
},
```

Replace with:
```ts
logout: async () => {
  clearToken();
  try { await api.post('/auth/logout', {}); } catch { /* best-effort */ }
  set({ user: null });
},
```

- [ ] **Step 4: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/stores/auth.ts
git commit -m "feat(staff): stash session_token on login; clear on logout"
```

---

## Task 5: Staff — offline queue embeds the header at enqueue time

**Files:**
- Modify: `packages/staff/src/lib/offlineQueue.ts`

- [ ] **Step 1: Import + attach token in `apiOrQueue`**

In `packages/staff/src/lib/offlineQueue.ts`, add near the top:
```ts
import { getToken } from './tokenStore';
```

Inside the `apiOrQueue` function, locate the `fetch` call and the subsequent `enqueue` call. Modify both so that the `Authorization` header is attached — reading the token once at call time so the queued record embeds it:

Find the fetch block and the enqueue block. The fetch is currently:
```ts
res = await fetch(url, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(fullBody),
});
```

The enqueue is currently:
```ts
await enqueue(tag, {
  id: idempotency_key,
  endpoint: url,
  method: 'POST',
  body: JSON.stringify(fullBody),
  headers: { 'Content-Type': 'application/json' },
  createdAt: Date.now(),
});
```

Add a `const token = getToken();` call at the top of the function body (right after `idempotency_key` is generated). Then replace the two `headers: { 'Content-Type': 'application/json' }` literals with:

```ts
headers: {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
},
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/lib/offlineQueue.ts
git commit -m "feat(staff): offline queue embeds Bearer header at enqueue time"
```

---

## Task 6: Web — mirror Tasks 3–5

**Files:**
- Create: `packages/web/src/lib/tokenStore.ts`
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/stores/auth.ts`
- Modify: `packages/web/src/lib/offlineQueue.ts`

- [ ] **Step 1: Create `packages/web/src/lib/tokenStore.ts`**

Same content as Task 3 Step 1 — write verbatim.

- [ ] **Step 2: Modify `packages/web/src/lib/api.ts`**

Add import at the top:
```ts
import { getToken } from './tokenStore';
```

Find the `request` function. Replace the existing body with the header-attaching version:

Current:
```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  // ...rest of function stays
}
```

Replace with:
```ts
async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  // ...rest of function stays (the response parsing + error handling)
}
```

The rest of the file (type defs, exports, interfaces) stays unchanged.

- [ ] **Step 3: Modify `packages/web/src/stores/auth.ts`**

Add import:
```ts
import { setToken, clearToken } from '@/lib/tokenStore';
```

Update `loginWithPin`:
```ts
loginWithPin: async (staffId: string, pin: string, remember: boolean) => {
  const res = await api.post<{ user: User & { session_token?: string } }>('/auth/pin-login', { staff_id: staffId, pin, remember });
  if (res.data?.user?.session_token) {
    setToken(res.data.user.session_token);
  }
  const u = res.data?.user;
  if (u) {
    const { session_token: _discard, ...userForStore } = u;
    void _discard;
    set({ user: userForStore as User });
  } else {
    set({ user: null });
  }
},
```

Update `verify`:
```ts
verify: async (email: string, code: string, remember: boolean) => {
  const res = await api.post<{ user: User & { session_token?: string } }>('/auth/verify', { email, code, remember });
  if (res.data?.user?.session_token) {
    setToken(res.data.user.session_token);
  }
  const u = res.data?.user;
  if (u) {
    const { session_token: _discard, ...userForStore } = u;
    void _discard;
    set({ user: userForStore as User });
  } else {
    set({ user: null });
  }
},
```

Update `logout`:
```ts
logout: async () => {
  clearToken();
  try { await api.post('/auth/logout', {}); } catch { /* best-effort */ }
  set({ user: null });
},
```

The other actions (`login`, `checkSession`) don't need changes.

- [ ] **Step 4: Modify `packages/web/src/lib/offlineQueue.ts`**

Same edit pattern as Task 5 Step 1 — add `import { getToken } from './tokenStore';`, add `const token = getToken();` at the top of `apiOrQueue`, and attach the header in both the live fetch and the enqueue record.

- [ ] **Step 5: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
git add packages/web/src/lib/tokenStore.ts packages/web/src/lib/api.ts packages/web/src/stores/auth.ts packages/web/src/lib/offlineQueue.ts
git commit -m "feat(web): mirror Bearer token fallback (tokenStore + api + auth store + offline queue)"
```

---

## Task 7: Deploy

**Files:** none modified.

- [ ] **Step 1: Deploy API first**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js deploy
```

Expected: new version ID printed. API is now backward-compatible — still accepts cookies; also accepts Bearer headers; now emits `session_token` in login responses (older clients ignore the extra field).

- [ ] **Step 2: Build + deploy staff Pages**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
node node_modules/typescript/bin/tsc -b packages/staff
node node_modules/vite/bin/vite.js build packages/staff
cd packages/staff
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=staff-attendance --branch=main --commit-dirty=true
```

- [ ] **Step 3: Build + deploy web Pages**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
node node_modules/typescript/bin/tsc -b packages/web
node node_modules/vite/bin/vite.js build packages/web
cd packages/web
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=ohcs-smartgate --branch=main --commit-dirty=true
```

- [ ] **Step 4: Push commits to GitHub**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
git push origin main
```

- [ ] **Step 5: Smoke-test via curl (cookie path still works)**

```bash
# Login, save cookie + parse token
curl -s -c /tmp/cookies.txt -X POST https://ohcs-smartgate-api.ghwmelite.workers.dev/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"staff_id":"1334685","pin":"<real_pin>"}'
```

Expected: response body contains `"session_token":"<uuid>"` alongside user fields. A cookie is also set in `/tmp/cookies.txt`.

```bash
# Cookie-only
curl -s -b /tmp/cookies.txt https://ohcs-smartgate-api.ghwmelite.workers.dev/api/auth/me
# Bearer-only (extract token from previous response manually)
TOKEN="<paste the session_token from above>"
curl -s -H "Authorization: Bearer $TOKEN" https://ohcs-smartgate-api.ghwmelite.workers.dev/api/auth/me
```

Both should return the same user object.

- [ ] **Step 6: Mobile PWA regression check (user action)**

Have the user reload the installed staff PWA on their phone, log in, background + foreground, refresh — should now stay logged in.

---

## Self-Review Notes

**Spec coverage:**
- Server middleware helper → Task 1.
- `/me`, `/change-pin`, `/logout` use helper → Task 2 steps 2-4.
- `/verify`, `/pin-login` emit `session_token` → Task 2 steps 5-6.
- Client `tokenStore` + api header attach → Task 3 (staff) / Task 6 (web).
- Client auth store stashes/clears → Task 4 / Task 6.
- Offline queue embeds header → Task 5 / Task 6.
- Deploy → Task 7.

**Type consistency:**
- `readSessionId(c)` returns `string | null` — consumed identically across middleware, /me, /change-pin, /logout.
- `session_token` is a `string` when present; frontend treats it as optional via `User & { session_token?: string }`.
- `getToken()` returns `string | null`; `setToken(t: string)`, `clearToken()` — consistent across staff and web.
- `localStorage` key `'ohcs.token'` consistent in both tokenStore copies.

**Known risks:**
- The `{ session_token: _discard, ...userForStore } = u` destructure pattern needs both packages' `User` type to NOT have `session_token`. They don't today. If someone adds it later, the spread will include it in `userForStore` — correct behavior, but worth watching.
- If a user's browser is running the OLD client code (pre-deploy cache) with the NEW API, they continue working via cookie — backward-compatible.
- If a user's browser has the NEW client code with the OLD API, the POST succeeds and `session_token` is undefined → `setToken` is skipped → cookie still carries them → still works. Graceful.
- Safari Private Browsing throws on `localStorage.setItem`. The try/catch in tokenStore swallows it; the user falls back to cookie-only, which may fail on PWA — they'll still be logged out, no regression versus today.
- The SW-queued replay records already include headers. When the user logs out + back in, queued records from the prior session carry the OLD token. The server rejects with 401; the SW drain deletes 4xx records. Acceptable.
