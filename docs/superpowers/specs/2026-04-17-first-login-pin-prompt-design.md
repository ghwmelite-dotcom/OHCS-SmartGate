# First-Login PIN Prompt — Design

**Date:** 2026-04-17
**Scope:** Staff Attendance system (`packages/staff`, `packages/api`)

## Goal

On first login, officers are prompted to either change the PIN their administrator set for them, or explicitly keep it. Once they make a choice, they are never prompted again (unless an admin later resets their PIN).

## Behavior Summary

- **Soft prompt, not a hard gate.** The officer reaches the clock page; a modal overlay asks them to choose.
- **Choice required.** The modal cannot be dismissed by clicking outside — the officer must click one of two buttons.
- **Once answered, done.** A `pin_acknowledged` flag on the user record persists the decision.
- **Applies to all existing officers** on their next login (including the seeded superadmin `1334685` / PIN `1118` and reception `OHCS-001` / PIN `1234`). The migration sets the flag to `0` for every existing row.
- **Applies to admin-created officers.** The `POST /users` endpoint continues to accept an admin-provided PIN; new rows are inserted with `pin_acknowledged = 0`.
- **Re-triggers on admin reset** (forward-compatible). No admin PIN-reset endpoint exists today. If/when one is added, it must set `pin_acknowledged = 0`. This spec does not build the reset flow.

## Data Model

Add one column to `users`:

```sql
ALTER TABLE users ADD COLUMN pin_acknowledged INTEGER NOT NULL DEFAULT 0;
```

- `0` = officer has not yet decided; show the modal on login.
- `1` = officer has either changed their PIN or explicitly chosen to keep it.

Migration location: new file `packages/api/src/db/migration-pin-acknowledged.sql`.

The default value `0` covers both fresh user inserts and backfilled existing rows, so no separate backfill statement is needed — the `ALTER TABLE` itself sets existing rows to `0`.

## API Changes (`packages/api`)

### 1. `POST /auth/pin-login` (modify)

Current response returns `{ user, session }`. Add `pin_acknowledged: boolean` derived from `users.pin_acknowledged`.

File: `packages/api/src/routes/auth.ts` (lines 74–111).

The session record in KV should also carry `pin_acknowledged` so a page refresh (which re-validates the session without re-hitting login) can surface the flag too.

### 2. `GET /auth/session` (modify, if exposed)

Whatever endpoint the frontend calls on app startup to restore session state must also return `pin_acknowledged`. If the current response already includes the full user, just add this field.

### 3. `POST /auth/change-pin` (modify)

Current behavior: verifies current PIN, updates `pin_hash`.

New behavior: after updating `pin_hash`, in the same SQL statement (or a second statement in the same request), set `pin_acknowledged = 1`.

File: `packages/api/src/routes/auth.ts` (lines 122–149).

### 4. `POST /auth/acknowledge-pin` (new)

- Method: `POST`
- Auth: requires valid session cookie (same guard as `/auth/change-pin`).
- Body: none.
- Side effect: `UPDATE users SET pin_acknowledged = 1 WHERE id = ?` for the session's user.
- Response: `{ ok: true }`.

This is the "keep current PIN" path — it records the decision without mutating the PIN hash.

File: `packages/api/src/routes/auth.ts` (append new handler).

### 5. Session shape

`SessionData` interface in `packages/api/src/types.ts` gains `pin_acknowledged: boolean`. The session stored in KV is updated when the officer logs in, and when either `/auth/change-pin` or `/auth/acknowledge-pin` succeeds — both must also refresh the cached KV session so subsequent requests see the updated flag without requiring a re-login.

## Frontend Changes (`packages/staff`)

### 1. Auth store (`src/stores/auth.ts`)

Add `pinAcknowledged: boolean` to the store state. Populate it from the login response and from the `checkSession()` response. Expose two actions:

- `markPinAcknowledged()` — flips the local flag to `true`. Called after either of the two API paths succeed.

### 2. New component: `FirstLoginPinPrompt`

Location: `packages/staff/src/components/FirstLoginPinPrompt.tsx`.

Render it on `ClockPage` only when `pinAcknowledged === false`.

Structure:

- Full-screen semi-opaque backdrop (not click-dismissable).
- Centered card, ~480px wide:
  - **Heading:** "Secure your account"
  - **Body:** "You're currently using the PIN set by your administrator. Would you like to change it now, or keep it?"
  - **Primary button:** "Change PIN" → opens the existing `PinChangeModal` in place of this modal.
  - **Secondary button:** "Keep Current PIN" → calls `POST /auth/acknowledge-pin`; on success calls `markPinAcknowledged()`.
- Escape key and outside click are intentionally ignored — the officer must click one of the two buttons.

### 3. Integration with existing `PinChangeModal`

The existing `usePinChange` flow already exists at `packages/staff/src/hooks/usePinChange.tsx`. When the officer clicks "Change PIN" inside `FirstLoginPinPrompt`, open `PinChangeModal`. On success of `POST /auth/change-pin`, the server already sets `pin_acknowledged = 1`; the client calls `markPinAcknowledged()` so the overlay unmounts.

If the officer cancels out of `PinChangeModal` (backs out), they should land back on `FirstLoginPinPrompt` — they haven't made a choice yet.

### 4. Routing / gate behavior

No route changes. `ProtectedRoute` still only checks authentication. The modal is a local overlay on `ClockPage`; other protected pages (if any) do not need to re-implement it, because an officer who hasn't acknowledged will see it as soon as they hit `ClockPage`, which is the default landing route.

## Data Flow

```
POST /auth/pin-login
  → 200 { user, pin_acknowledged: false }
  → auth store: { user, pinAcknowledged: false }
  → ClockPage mounts
  → FirstLoginPinPrompt overlays

  ┌── user clicks "Change PIN"
  │     → FirstLoginPinPrompt opens PinChangeModal
  │     → POST /auth/change-pin
  │         → server: pin_hash updated, pin_acknowledged = 1
  │     → client: markPinAcknowledged()
  │     → both modals dismiss, ClockPage visible
  │
  └── user clicks "Keep Current PIN"
        → POST /auth/acknowledge-pin
            → server: pin_acknowledged = 1
        → client: markPinAcknowledged()
        → overlay dismisses, ClockPage visible
```

## Error Handling

- **`/auth/acknowledge-pin` fails (network / 500):** show inline error in `FirstLoginPinPrompt`, keep the modal open, allow retry. Do not set `pinAcknowledged = true` on the client if the server call failed.
- **`/auth/change-pin` fails:** the existing `PinChangeModal` already surfaces its own errors. `FirstLoginPinPrompt` remains behind it until the change succeeds or the user backs out.
- **Session expires mid-prompt:** the next API call returns 401; the existing session-expiry handling redirects to login. On re-login the modal shows again (because `pin_acknowledged` is still `0`).

## Testing

Unit / integration coverage:

- **API:**
  - `ALTER TABLE` migration applies cleanly and defaults existing rows to `0`.
  - `POST /auth/pin-login` returns `pin_acknowledged: false` for a freshly migrated user.
  - `POST /auth/change-pin` flips `pin_acknowledged` to `1`.
  - `POST /auth/acknowledge-pin` flips `pin_acknowledged` to `1` without changing `pin_hash`.
  - `POST /auth/acknowledge-pin` rejects unauthenticated requests (401).
  - Session in KV reflects the updated flag after either success path.
- **Frontend:**
  - `FirstLoginPinPrompt` renders iff `pinAcknowledged === false`.
  - Clicking outside the modal does nothing.
  - "Keep Current PIN" calls the endpoint once and unmounts on success.
  - "Change PIN" opens `PinChangeModal`; successful change unmounts both overlays.
  - Canceling out of `PinChangeModal` returns the user to `FirstLoginPinPrompt`.

## Out of Scope

- Admin PIN-reset UI or endpoint (not present today).
- PIN complexity rules (still 4 digits).
- PIN expiry / rotation policies.
- "Remind me later" or snooze behavior.
- Rate limiting on `/auth/acknowledge-pin` (inherits whatever exists on the auth routes).

## Open Questions

None at design time. If the `/auth/session` restore endpoint does not currently include the full user record, that will surface during implementation and be handled as a small additive change.
