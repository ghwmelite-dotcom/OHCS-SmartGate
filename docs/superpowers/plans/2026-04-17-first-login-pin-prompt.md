# First-Login PIN Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first login, officers are prompted by a modal to either change the admin-set PIN or explicitly keep it. The decision is persisted so the prompt never reappears (unless an admin later resets the PIN).

**Architecture:** Add a `pin_acknowledged` column to `users`. `POST /auth/pin-login` and `GET /auth/me` return the flag to the client. `POST /auth/change-pin` flips it automatically; a new `POST /auth/acknowledge-pin` flips it without mutating the PIN. The staff frontend overlays a `FirstLoginPinPrompt` modal on `ClockPage` when the flag is `false`.

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite) on the API side; React 18 + Vite + React Router 7 + Zustand on the staff frontend. No test runner — verification is `npm run type-check` plus manual `curl` and browser checks against `wrangler dev`.

---

## File Structure

**API (`packages/api`):**
- Create: `src/db/migration-pin-acknowledged.sql` — adds column.
- Modify: `src/db/schema.sql` — mirror the column so fresh setups get it.
- Modify: `src/routes/auth.ts` — update `pin-login` response, update `change-pin` to flip flag, add `acknowledge-pin` endpoint, update `/me` to include flag.
- Modify: `src/types.ts` — no shape change needed (see Task 4 note).
- No change: `src/services/auth.ts` — sessions keep their existing shape; the flag is read from DB on `/me`.
- No change: `src/routes/users.ts` — admin-create already omits the column; DB default `0` applies.

**Staff frontend (`packages/staff`):**
- Modify: `src/stores/auth.ts` — add `pinAcknowledged`, plumb through login + session-check, add `markPinAcknowledged` action.
- Modify: `src/hooks/usePinChange.tsx` — export `PinChangeModal` and accept an `onSuccess` callback.
- Create: `src/components/FirstLoginPinPrompt.tsx` — the overlay component.
- Modify: `src/pages/ClockPage.tsx` — render `FirstLoginPinPrompt` when `pinAcknowledged === false`.

---

## Task 1: Add `pin_acknowledged` column to the database

**Files:**
- Create: `packages/api/src/db/migration-pin-acknowledged.sql`
- Modify: `packages/api/src/db/schema.sql` (users table, line 3-15)

- [ ] **Step 1: Create the migration file**

Create `packages/api/src/db/migration-pin-acknowledged.sql` with exactly:

```sql
-- First-login PIN prompt: adds a flag indicating the officer has either
-- changed their admin-set PIN or explicitly chosen to keep it.
ALTER TABLE users ADD COLUMN pin_acknowledged INTEGER NOT NULL DEFAULT 0;
```

SQLite (D1) applies the `DEFAULT 0` to all existing rows when adding a `NOT NULL` column, so every existing officer — including the seeded superadmin `1334685` and reception `OHCS-001` — will have `pin_acknowledged = 0` and get prompted on their next login.

- [ ] **Step 2: Mirror the column in `schema.sql`**

Edit `packages/api/src/db/schema.sql`. Inside the `CREATE TABLE IF NOT EXISTS users (...)` block (lines 3-15), insert a new line between `pin_hash` (line 8) and `role` (line 9):

```sql
    pin_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(pin_acknowledged IN (0, 1)),
```

The full `users` table definition should now read:

```sql
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    staff_id    TEXT UNIQUE,
    pin_hash    TEXT,
    pin_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(pin_acknowledged IN (0, 1)),
    role        TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('superadmin','admin','receptionist','it','director','staff')),
    grade       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    last_login_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

- [ ] **Step 3: Apply the migration against the local D1 database**

From `packages/api`:

```bash
npx wrangler d1 execute smartgate-db --local --file=src/db/migration-pin-acknowledged.sql
```

Expected: exit code 0, one row indicating the migration ran.

- [ ] **Step 4: Verify the column exists and existing rows default to 0**

```bash
npx wrangler d1 execute smartgate-db --local --command="SELECT staff_id, pin_acknowledged FROM users"
```

Expected: every row shows `pin_acknowledged = 0`, including `1334685` and `OHCS-001`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/migration-pin-acknowledged.sql packages/api/src/db/schema.sql
git commit -m "feat(db): add pin_acknowledged column for first-login prompt"
```

---

## Task 2: Return `pin_acknowledged` from `POST /auth/pin-login`

**Files:**
- Modify: `packages/api/src/routes/auth.ts` (lines 74-111)

- [ ] **Step 1: Extend the SELECT in `pin-login` to read the new column**

In `packages/api/src/routes/auth.ts`, lines 77-81 currently read:

```ts
const user = await c.env.DB.prepare(
    'SELECT id, name, email, role, pin_hash, is_active FROM users WHERE staff_id = ?'
  ).bind(staff_id.toUpperCase()).first<{
    id: string; name: string; email: string; role: string; pin_hash: string | null; is_active: number;
  }>();
```

Replace with:

```ts
const user = await c.env.DB.prepare(
    'SELECT id, name, email, role, pin_hash, is_active, pin_acknowledged FROM users WHERE staff_id = ?'
  ).bind(staff_id.toUpperCase()).first<{
    id: string; name: string; email: string; role: string;
    pin_hash: string | null; is_active: number; pin_acknowledged: number;
  }>();
```

- [ ] **Step 2: Include the flag in the response body**

Line 110 currently reads:

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
      pin_acknowledged: user.pin_acknowledged === 1,
    },
  });
```

- [ ] **Step 3: Type-check**

From the repo root:

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 4: Manual verification via curl**

Start the API locally from `packages/api`:

```bash
npx wrangler dev
```

In another terminal, log in as the seeded superadmin:

```bash
curl -i -X POST http://localhost:8787/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"staff_id":"1334685","pin":"1118"}'
```

Expected: `200 OK` with JSON body `{"data":{"user":{"id":"...","name":"System Administrator","email":"...","role":"superadmin","pin_acknowledged":false}}}`.

Note the `Set-Cookie: session_id=...` header — save the session ID for later tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/auth.ts
git commit -m "feat(api): include pin_acknowledged in pin-login response"
```

---

## Task 3: Return `pin_acknowledged` from `GET /auth/me`

**Files:**
- Modify: `packages/api/src/routes/auth.ts` (lines 151-161)

- [ ] **Step 1: Update `/auth/me` to look up the flag from DB**

`/auth/me` currently returns the KV session verbatim. Since the session doesn't store `pin_acknowledged`, we query the DB so a page refresh always gets the live flag.

Lines 151-161 currently read:

```ts
authRoutes.get('/me', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  }
  const session = await getSession(sessionId, c.env);
  if (!session) {
    return error(c, 'UNAUTHORIZED', 'Session expired', 401);
  }
  return success(c, { user: session });
});
```

Replace with:

```ts
authRoutes.get('/me', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  }
  const session = await getSession(sessionId, c.env);
  if (!session) {
    return error(c, 'UNAUTHORIZED', 'Session expired', 401);
  }

  const row = await c.env.DB.prepare('SELECT pin_acknowledged FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ pin_acknowledged: number }>();

  return success(c, {
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      role: session.role,
      pin_acknowledged: (row?.pin_acknowledged ?? 0) === 1,
    },
  });
});
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 3: Manual verification**

With `wrangler dev` still running and the session cookie from Task 2 Step 4 saved (replace `<SID>` below):

```bash
curl -i http://localhost:8787/api/auth/me \
  -H "Cookie: session_id=<SID>"
```

Expected: `200 OK` with `{"data":{"user":{"id":"...","name":"...","email":"...","role":"superadmin","pin_acknowledged":false}}}`.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/auth.ts
git commit -m "feat(api): include pin_acknowledged in /auth/me"
```

---

## Task 4: Flip the flag in `POST /auth/change-pin`

**Files:**
- Modify: `packages/api/src/routes/auth.ts` (lines 128-149)

- [ ] **Step 1: Update the `UPDATE` statement to set both `pin_hash` and `pin_acknowledged`**

Lines 144-146 currently read:

```ts
  const newHash = await hashPin(new_pin);
  await c.env.DB.prepare('UPDATE users SET pin_hash = ? WHERE id = ?')
    .bind(newHash, session.userId).run();
```

Replace with:

```ts
  const newHash = await hashPin(new_pin);
  await c.env.DB.prepare('UPDATE users SET pin_hash = ?, pin_acknowledged = 1 WHERE id = ?')
    .bind(newHash, session.userId).run();
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 3: Manual verification**

With `wrangler dev` running and the superadmin session from Task 2 Step 4:

```bash
curl -i -X POST http://localhost:8787/api/auth/change-pin \
  -H "Content-Type: application/json" \
  -H "Cookie: session_id=<SID>" \
  -d '{"current_pin":"1118","new_pin":"1119"}'
```

Expected: `200 OK` with `{"data":{"message":"PIN changed successfully"}}`.

Then confirm the flag flipped:

```bash
npx wrangler d1 execute smartgate-db --local --command="SELECT staff_id, pin_acknowledged FROM users WHERE staff_id='1334685'"
```

Expected: `pin_acknowledged = 1`.

Reset the PIN back for later tasks:

```bash
npx wrangler d1 execute smartgate-db --local \
  --command="UPDATE users SET pin_hash='63ecbfa3a1ad34a1fdd5e3dd3aeaec31456d1d676552c654d5ecf7dab0b2f4f8', pin_acknowledged=0 WHERE staff_id='1334685'"
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/auth.ts
git commit -m "feat(api): set pin_acknowledged on successful PIN change"
```

---

## Task 5: Add `POST /auth/acknowledge-pin` endpoint

**Files:**
- Modify: `packages/api/src/routes/auth.ts` (append new handler after the `/change-pin` route, before `/me`)

- [ ] **Step 1: Add the handler**

In `packages/api/src/routes/auth.ts`, insert the following block between the existing `/change-pin` handler (ends at line 149) and the `/me` handler (begins at line 151):

```ts
// Acknowledge the admin-set PIN without changing it ("keep current PIN"
// path for the first-login prompt).
authRoutes.post('/acknowledge-pin', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const session = await getSession(sessionId, c.env);
  if (!session) return error(c, 'UNAUTHORIZED', 'Session expired', 401);

  await c.env.DB.prepare('UPDATE users SET pin_acknowledged = 1 WHERE id = ?')
    .bind(session.userId)
    .run();

  return success(c, { message: 'PIN acknowledged' });
});
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 3: Manual verification — unauthenticated rejection**

```bash
curl -i -X POST http://localhost:8787/api/auth/acknowledge-pin
```

Expected: `401 Unauthorized` with error code `UNAUTHORIZED`.

- [ ] **Step 4: Manual verification — authenticated success**

Log in fresh to get a new session cookie (the one from Task 2 may have been invalidated when we reset the PIN):

```bash
curl -i -X POST http://localhost:8787/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"staff_id":"1334685","pin":"1118"}'
```

Save the new `<SID>`, then:

```bash
curl -i -X POST http://localhost:8787/api/auth/acknowledge-pin \
  -H "Cookie: session_id=<SID>"
```

Expected: `200 OK` with `{"data":{"message":"PIN acknowledged"}}`.

Verify the flag:

```bash
npx wrangler d1 execute smartgate-db --local --command="SELECT staff_id, pin_hash, pin_acknowledged FROM users WHERE staff_id='1334685'"
```

Expected: `pin_acknowledged = 1` AND `pin_hash` unchanged from the seeded value `63ecbfa3a1ad34a1fdd5e3dd3aeaec31456d1d676552c654d5ecf7dab0b2f4f8`.

Reset for frontend testing:

```bash
npx wrangler d1 execute smartgate-db --local --command="UPDATE users SET pin_acknowledged=0 WHERE staff_id='1334685'"
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/auth.ts
git commit -m "feat(api): add POST /auth/acknowledge-pin endpoint"
```

---

## Task 6: Extend the staff auth store with `pinAcknowledged`

**Files:**
- Modify: `packages/staff/src/stores/auth.ts`

- [ ] **Step 1: Replace the file with the extended version**

Replace the entire contents of `packages/staff/src/stores/auth.ts` with:

```ts
import { create } from 'zustand';
import { api } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  pin_acknowledged: boolean;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  loginWithPin: (staffId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  markPinAcknowledged: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  loginWithPin: async (staffId, pin) => {
    const res = await api.post<{ user: User }>('/auth/pin-login', { staff_id: staffId, pin, remember: true });
    set({ user: res.data?.user ?? null });
  },
  logout: async () => {
    await api.post('/auth/logout', {});
    set({ user: null });
  },
  checkSession: async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      set({ user: res.data?.user ?? null, isLoading: false });
    } catch { set({ user: null, isLoading: false }); }
  },
  markPinAcknowledged: () =>
    set((state) => (state.user ? { user: { ...state.user, pin_acknowledged: true } } : state)),
}));
```

Key changes:
- `User` now includes `pin_acknowledged: boolean`.
- `AuthState` gains `markPinAcknowledged()`, which flips the flag locally without hitting the server (the server was already updated by whichever mutation triggered this call).

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: no errors. (If other files consumed the `User` type and break, they will be addressed in their own task below.)

- [ ] **Step 3: Commit**

```bash
git add packages/staff/src/stores/auth.ts
git commit -m "feat(staff): add pin_acknowledged to auth store"
```

---

## Task 7: Export `PinChangeModal` and add an `onSuccess` callback

**Files:**
- Modify: `packages/staff/src/hooks/usePinChange.tsx` (lines 5-103)

- [ ] **Step 1: Export `PinChangeModal` and thread `onSuccess` through**

`PinChangeModal` is currently a private helper inside this file. We need to export it so `FirstLoginPinPrompt` can open it directly, and we need it to signal successful PIN change to its parent.

In `packages/staff/src/hooks/usePinChange.tsx`, find line 18:

```tsx
function PinChangeModal({ onClose }: { onClose: () => void }) {
```

Replace with:

```tsx
export function PinChangeModal({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
```

Then find the `try` block around lines 34-40:

```tsx
    try {
      await api.post('/auth/change-pin', { current_pin: currentPin, new_pin: newPin });
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to change PIN');
      setStatus('error');
    }
```

Replace with:

```tsx
    try {
      await api.post('/auth/change-pin', { current_pin: currentPin, new_pin: newPin });
      setStatus('success');
      onSuccess?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to change PIN');
      setStatus('error');
    }
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: no errors. The existing `PinChangeButton` usage passes only `onClose` — `onSuccess` is optional so it still type-checks.

- [ ] **Step 3: Commit**

```bash
git add packages/staff/src/hooks/usePinChange.tsx
git commit -m "feat(staff): export PinChangeModal and add onSuccess callback"
```

---

## Task 8: Create the `FirstLoginPinPrompt` component

**Files:**
- Create: `packages/staff/src/components/FirstLoginPinPrompt.tsx`

- [ ] **Step 1: Write the component**

Create `packages/staff/src/components/FirstLoginPinPrompt.tsx` with:

```tsx
import { useState } from 'react';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { PinChangeModal } from '@/hooks/usePinChange';

export function FirstLoginPinPrompt() {
  const markPinAcknowledged = useAuthStore((s) => s.markPinAcknowledged);
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [keepStatus, setKeepStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [keepError, setKeepError] = useState('');

  async function handleKeep() {
    setKeepStatus('loading');
    setKeepError('');
    try {
      await api.post('/auth/acknowledge-pin', {});
      markPinAcknowledged();
    } catch (err) {
      setKeepError(err instanceof Error ? err.message : 'Failed to save your choice');
      setKeepStatus('error');
    }
  }

  if (showChangeModal) {
    return (
      <PinChangeModal
        onClose={() => setShowChangeModal(false)}
        onSuccess={() => {
          markPinAcknowledged();
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-login-pin-title"
    >
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          <div className="w-14 h-14 bg-[#1A4D2E]/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="h-7 w-7 text-[#1A4D2E]" />
          </div>
          <h3
            id="first-login-pin-title"
            className="text-[20px] font-bold text-gray-900 text-center"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            Secure your account
          </h3>
          <p className="text-[14px] text-gray-600 text-center mt-2 leading-relaxed">
            You're currently using the PIN set by your administrator. Would you like to change it now, or keep it?
          </p>

          {keepError && (
            <p className="text-red-600 text-[13px] font-medium text-center mt-3">{keepError}</p>
          )}

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => setShowChangeModal(true)}
              disabled={keepStatus === 'loading'}
              className="w-full h-12 bg-[#1A4D2E] text-white rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              <KeyRound className="h-4 w-4" />
              Change PIN
            </button>
            <button
              type="button"
              onClick={handleKeep}
              disabled={keepStatus === 'loading'}
              className="w-full h-12 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-semibold text-[15px] hover:border-gray-300 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {keepStatus === 'loading' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Keep Current PIN'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

Key behaviors:
- The backdrop has no `onClick` handler, and the inner card doesn't stop propagation — clicking outside does nothing. The user must click one of the two buttons.
- `z-40` so the base page stays visible behind; when the user clicks "Change PIN", `PinChangeModal` (which uses `z-50`) layers on top correctly.
- On success of either path, `markPinAcknowledged()` is called. The component unmounts when `ClockPage` re-evaluates the flag (Task 9).
- `keepError` surfaces network failures on the "keep" path; "change" errors are surfaced inside `PinChangeModal` itself.

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/staff/src/components/FirstLoginPinPrompt.tsx
git commit -m "feat(staff): add FirstLoginPinPrompt component"
```

---

## Task 9: Render `FirstLoginPinPrompt` on `ClockPage`

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx` (lines 1-10 and the return JSX)

- [ ] **Step 1: Import the component**

In `packages/staff/src/pages/ClockPage.tsx`, the import block currently includes (line 3):

```tsx
import { PinChangeButton } from '@/hooks/usePinChange';
```

Immediately after it, add:

```tsx
import { FirstLoginPinPrompt } from '@/components/FirstLoginPinPrompt';
```

- [ ] **Step 2: Read the flag from the store**

Line 37 currently reads:

```tsx
  const user = useAuthStore((s) => s.user);
```

Replace with:

```tsx
  const user = useAuthStore((s) => s.user);
  const showFirstLoginPrompt = user ? !user.pin_acknowledged : false;
```

- [ ] **Step 3: Render the overlay**

The `ClockPage` return JSX begins well below line 100. Rather than restructuring it, render `FirstLoginPinPrompt` as a sibling at the top of the returned fragment so it overlays regardless of the page's internal state.

Locate the top-level `return (` in `ClockPage` (it returns a single root element — likely a `div` with the page chrome). Immediately inside that root element (as the first child), add:

```tsx
{showFirstLoginPrompt && <FirstLoginPinPrompt />}
```

If the existing return uses a single wrapping `<div>`, this becomes:

```tsx
return (
  <div /* existing props */>
    {showFirstLoginPrompt && <FirstLoginPinPrompt />}
    {/* existing children unchanged */}
  </div>
);
```

If the existing return uses a fragment `<>...</>`, wrap as:

```tsx
return (
  <>
    {showFirstLoginPrompt && <FirstLoginPinPrompt />}
    {/* existing children unchanged */}
  </>
);
```

The overlay uses `position: fixed inset-0 z-40`, so it floats above the page regardless of the page's own layout.

- [ ] **Step 4: Type-check**

```bash
npm run type-check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): render FirstLoginPinPrompt on ClockPage when unacknowledged"
```

---

## Task 10: End-to-end verification in the browser

**Files:** none modified.

- [ ] **Step 1: Reset both seeded users to unacknowledged**

```bash
npx wrangler d1 execute smartgate-db --local --command="UPDATE users SET pin_acknowledged=0 WHERE staff_id IN ('1334685','OHCS-001')"
```

Also reset the superadmin PIN hash to the seeded value in case it was changed during earlier tasks:

```bash
npx wrangler d1 execute smartgate-db --local \
  --command="UPDATE users SET pin_hash='63ecbfa3a1ad34a1fdd5e3dd3aeaec31456d1d676552c654d5ecf7dab0b2f4f8' WHERE staff_id='1334685'"
```

- [ ] **Step 2: Start both servers**

Terminal A (from `packages/api`):

```bash
npx wrangler dev
```

Terminal B (from `packages/staff`):

```bash
npm run dev
```

- [ ] **Step 3: Verify "Keep Current PIN" path**

1. Open the staff app URL (typically `http://localhost:5173`).
2. Log in as `1334685` / `1118`.
3. **Expected:** the `ClockPage` loads and the `FirstLoginPinPrompt` overlay appears with heading "Secure your account".
4. Click anywhere outside the modal card.
5. **Expected:** nothing happens — the modal stays.
6. Click **Keep Current PIN**.
7. **Expected:** the button shows a "Saving..." spinner briefly, then the overlay disappears.
8. In a separate terminal:
   ```bash
   npx wrangler d1 execute smartgate-db --local --command="SELECT staff_id, pin_acknowledged FROM users WHERE staff_id='1334685'"
   ```
   **Expected:** `pin_acknowledged = 1`.
9. Refresh the browser page.
10. **Expected:** `ClockPage` loads without the overlay.
11. Log out (header logout control), then log back in with `1334685` / `1118`.
12. **Expected:** no overlay.

- [ ] **Step 4: Verify "Change PIN" path**

1. Log out. Log in as `OHCS-001` / `1234`.
2. **Expected:** overlay appears.
3. Click **Change PIN**.
4. **Expected:** the `PinChangeModal` replaces the overlay.
5. Enter current PIN `1234`, new PIN `5678`, confirm `5678`, submit.
6. **Expected:** success screen in the modal. Click **Done**.
7. **Expected:** both overlays are gone; `ClockPage` is visible.
8. Verify in DB:
   ```bash
   npx wrangler d1 execute smartgate-db --local --command="SELECT staff_id, pin_acknowledged FROM users WHERE staff_id='OHCS-001'"
   ```
   **Expected:** `pin_acknowledged = 1`.
9. Log out. Log in with `OHCS-001` / `1234`.
10. **Expected:** login fails (PIN changed).
11. Log in with `OHCS-001` / `5678`.
12. **Expected:** login succeeds; no overlay.

- [ ] **Step 5: Verify cancel-out-of-change-returns-to-prompt behavior**

1. Reset:
   ```bash
   npx wrangler d1 execute smartgate-db --local --command="UPDATE users SET pin_acknowledged=0 WHERE staff_id='1334685'"
   ```
2. Log out. Log in as `1334685` / `1118`.
3. Overlay appears. Click **Change PIN**.
4. In `PinChangeModal`, click the **X** close button (top-right).
5. **Expected:** `PinChangeModal` closes and `FirstLoginPinPrompt` reappears (we returned to the prompt overlay).
6. Click **Keep Current PIN**. Overlay dismisses.

- [ ] **Step 6: Restore seeded values for clean state**

```bash
npx wrangler d1 execute smartgate-db --local --command="UPDATE users SET pin_hash='03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', pin_acknowledged=0 WHERE staff_id='OHCS-001'"
npx wrangler d1 execute smartgate-db --local --command="UPDATE users SET pin_hash='63ecbfa3a1ad34a1fdd5e3dd3aeaec31456d1d676552c654d5ecf7dab0b2f4f8', pin_acknowledged=0 WHERE staff_id='1334685'"
```

- [ ] **Step 7: Final commit with any doc / cleanup touch-ups**

If any task above left unstaged whitespace-only diffs from an editor, clean them up; otherwise skip this step.

```bash
git status
```

Expected: clean working tree.

---

## Self-Review Notes

- **Spec coverage:**
  - Data model (`pin_acknowledged` column, default 0) → Task 1.
  - `POST /auth/pin-login` returns flag → Task 2.
  - `GET /auth/me` returns flag → Task 3 (spec said "if exposed" — it is, and we read from DB so refreshes are correct without mutating KV).
  - `POST /auth/change-pin` flips flag → Task 4.
  - `POST /auth/acknowledge-pin` new endpoint → Task 5.
  - Auth store carries flag + `markPinAcknowledged` → Task 6.
  - `FirstLoginPinPrompt` component + wiring → Tasks 8–9.
  - Existing `PinChangeModal` reused with `onSuccess` hook → Task 7.
  - All existing officers prompted (Option B) → Migration in Task 1 defaults to 0 for existing rows.
  - Admin PIN reset re-triggers prompt → noted as out-of-scope in spec; when built later, it simply sets `pin_acknowledged = 0`. No code here.

- **Deviation from spec:** spec mentioned storing `pinAcknowledged` in KV session. Plan reads from DB on `/me` instead so mutations don't need to touch KV — simpler and avoids KV-TTL issues. Behavior (refresh shows live flag) is unchanged.

- **Type consistency:** field is `pin_acknowledged` (snake_case) end-to-end from DB → API JSON → frontend `User` type. `markPinAcknowledged()` uses camelCase only as a method name. No mismatches.
