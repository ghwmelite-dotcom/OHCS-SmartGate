# Bearer Token Auth Fallback — Design

**Date:** 2026-04-18
**Scope:** `packages/api`, `packages/staff`, `packages/web`. Fixes installed-PWA login loop on mobile (esp. iOS WebKit), where the cross-origin session cookie is blocked by the platform's third-party-cookie protections.

## Problem

Frontend lives on `*.pages.dev`, API lives on `*.workers.dev`. Session is a cookie. Desktop browsers largely still send cross-site cookies with `SameSite=None; Secure`. Installed PWAs (iOS Safari / WebKit, Android WebView) block them → `POST /auth/pin-login` sets the cookie, but the next `GET /auth/me` never sees it → frontend thinks user is logged out → kicked back to `/login`.

## Goal

Ship an auth path that works without third-party cookies while keeping the existing cookie flow intact for clients that honor it.

## Non-goals

- No change to session generation, TTL, KV storage, or rate limiting.
- No migration of the API to the frontend's domain (Option B/C from prior discussion).
- No change to OTP, PIN, or login credential logic.

## Design

### 1. Server-side: middleware accepts either cookie or bearer header

`packages/api/src/middleware/auth.ts` currently:

```ts
const sessionId = getCookie(c, 'session_id');
if (!sessionId) return c.json({ … UNAUTHORIZED … }, 401);
```

Change to:

```ts
const cookieSid = getCookie(c, 'session_id');
const authHeader = c.req.header('authorization') ?? '';
const bearerSid = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
const sessionId = cookieSid ?? bearerSid;
if (!sessionId) return c.json({ … UNAUTHORIZED … }, 401);
```

All downstream logic (`getSession`, `c.set('session', …)`, etc.) stays identical. The session ID itself is the same opaque UUID whether transported via cookie or header.

`/auth/change-pin` and `/auth/me` currently do their own `getCookie('session_id')` rather than relying on middleware. Fix both in the same pattern — extract a shared `readSessionId(c)` helper in `services/auth.ts`:

```ts
export function readSessionId(c: Context): string | null {
  const cookie = getCookie(c, 'session_id');
  if (cookie) return cookie;
  const auth = c.req.header('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}
```

Three call sites update (middleware + two route handlers). No schema change, no behavior change for clients that already send a cookie.

### 2. Server-side: login responses include the session ID

`/auth/verify` and `/auth/pin-login` both call `createSession(...)` and currently set a cookie. Add the returned `sessionId` to the JSON response body as `session_token`:

```ts
return success(c, {
  user: {
    id: user.id, name: user.name, email: user.email, role: user.role,
    pin_acknowledged: user.pin_acknowledged === 1,  // pin-login only
    session_token: sessionId,
  },
});
```

Cookie set stays untouched — still useful for browsers that honor it.

### 3. Client-side: store and attach the token

New module `lib/tokenStore.ts` in both `packages/staff/src` and `packages/web/src`:

```ts
const KEY = 'ohcs.token';

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function setToken(token: string): void {
  try { localStorage.setItem(KEY, token); } catch {}
}

export function clearToken(): void {
  try { localStorage.removeItem(KEY); } catch {}
}
```

`try/catch` guards against storage disabled / private mode edge cases (Safari Private Browsing throws on `setItem`).

### 4. Client-side: `api.ts` attaches the token

Both `packages/staff/src/lib/api.ts` and `packages/web/src/lib/api.ts` wrap `fetch` with helpers. Modify each `api.get`/`api.post`/… to inject the header:

```ts
import { getToken } from './tokenStore';

const token = getToken();
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...(init.headers as Record<string, string> | undefined),
};
```

`credentials: 'include'` stays — the cookie path continues to work where supported, providing defense-in-depth.

### 5. Client-side: auth store captures the token on login

In `packages/staff/src/stores/auth.ts` and `packages/web/src/stores/auth.ts` (if the web one also handles session — check during implementation; the web app may route via `api.post('/auth/verify', …)`):

- In `loginWithPin` action: after successful POST, extract `session_token` from response and call `setToken(session_token)`.
- In `logout` action: call `clearToken()` BEFORE the API call (so if the API call races, the local token is cleared first).
- In `checkSession`: nothing to change. The updated `api.get` automatically attaches the token.

The `User` TypeScript interface doesn't need `session_token` — we consume and discard it at the store layer. The server's response type can include it; the client's stored `User` shape stays lean.

### 6. Client-side: offline queue passes the token through

`lib/offlineQueue.ts` in both packages currently sends queued replays with `credentials: 'include'` but no header. Modify the `apiOrQueue` function to:

- Read the token at the time of the call.
- Include `Authorization: Bearer <token>` in the queued record's `headers` object.
- SW replays that record verbatim, so the token travels with the retry.

Token freshness: if the user logs out while a request is queued, the token in the queued record becomes invalid and the server returns 401. The SW drain currently deletes records on 4xx (since we can't retry a bad request), which is correct behavior — the logged-out user doesn't need that mutation replayed.

## Files Touched

**Modified:**
- `packages/api/src/middleware/auth.ts`
- `packages/api/src/services/auth.ts` (new `readSessionId` helper)
- `packages/api/src/routes/auth.ts` (both login handlers emit `session_token`; `/change-pin` + `/me` use `readSessionId`)
- `packages/staff/src/lib/api.ts`
- `packages/staff/src/stores/auth.ts`
- `packages/staff/src/lib/offlineQueue.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/stores/auth.ts` (if applicable; check on implementation — web may call the API directly from pages)
- `packages/web/src/lib/offlineQueue.ts`

**New:**
- `packages/staff/src/lib/tokenStore.ts`
- `packages/web/src/lib/tokenStore.ts`

## Rollout Order

1. Deploy API first (backward-compatible — accepts cookie OR header, emits `session_token` in response).
2. Deploy both Pages builds (they now store + send the token).
3. Users on existing cookie sessions: keep working via cookie. New logins: get a token in localStorage and all subsequent requests carry it.
4. After a few days in production without issue, we could drop the cookie flow — but there's no reason to; belt-and-suspenders costs nothing.

## Security

- **localStorage vs cookie**: both are XSS-exposed on the origin. Attacker with XSS can read either. No downgrade.
- **Token rotation**: the token IS the session ID. Logout deletes the KV session → token becomes invalid server-side.
- **No separate revocation**: same as today.
- **CSRF**: was mitigated by `SameSite=None; Secure` cookie + CORS allowlist. Bearer tokens are not sent automatically by the browser on cross-origin requests, so they're CSRF-immune by design. Net improvement.
- **Rate limiting**: unchanged. The KV buckets key on email/IP/staff_id, not session.

## Testing

Manual (no automated test infra in this project):

1. **Desktop browser** (cookies work): log in → confirm `Authorization: Bearer …` present in DevTools network tab on `/auth/me`. Refresh → still logged in. Logout → localStorage key removed.
2. **Installed PWA on phone** (cookies blocked): install app, log in, close and reopen → should stay logged in (was the bug). Force-quit and relaunch → still logged in.
3. **Offline clock-in**: go offline, clock-in, come back online → queued request replays with header, server accepts.
4. **Logout with queued requests**: queue a mutation offline, log out while offline, come back online → server rejects with 401 → queue drops the record (current behavior).
5. **Cookie-only fallback**: clear localStorage manually, refresh → should still work if cookie is present (backward-compat).
6. **Both missing**: clear localStorage AND cookies → /auth/me returns 401, user redirected to /login (expected).

## Out of Scope

- Token rotation on a schedule.
- Refresh-token pattern (access token + refresh token split). Current token == session ID has a TTL already.
- Server-side session store change (still KV).
- OAuth/OIDC migration.
- Moving the API to a subdomain of the frontend (Option B/C from prior discussion). If Bearer fallback proves insufficient, revisit.

## Open Questions

None at design time. Will confirm web's auth store location on implementation (VMS may use a different pattern than staff).
