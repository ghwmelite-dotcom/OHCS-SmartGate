# OHCS Clock-In — Re-Auth & Liveness Prompt — Design Proposal

**Status:** Draft for review
**Author:** Engineering
**Date:** 2026-04-29
**Audience:** OHCS leadership / engineering

---

## Executive summary

Today, once a staff member is signed into the OHCS Staff Attendance PWA, their session lasts up to 24 hours (30 days with "remember me"). During that window, *anyone* holding the phone can clock in or out — the server has no way to tell whether the person tapping the button is the real owner. The selfie that's captured is stored for review only; it isn't checked against anything in real time, and there's no liveness control to stop someone from holding up an old photo.

This spec adds two things at every clock-in:

1. **A fresh biometric (Face ID / fingerprint) check** at the moment of clocking in — not just at login. PIN fallback for devices without a biometric.
2. **A random 2-digit "show this number to the camera" prompt** that has to be visible in the captured selfie. Today's prompt won't match yesterday's saved photo, so old selfies become useless.

Together these close the realistic impersonation attacks: a colleague handing their unlocked phone to someone else, or a friend re-using yesterday's selfie.

Face-matching against an enrolled reference photo is **not** in this spec — that's the next, larger piece of work and gets its own design (see *out of scope*).

---

## What the staff member sees

The clock-in flow gets two new steps inserted into the existing screen:

1. Tap **Clock In** as today.
2. **New:** screen shows *"Show this number to the camera: **47**"* with a 90-second countdown ring. (The number is different every time.)
3. Camera opens. Staff captures a selfie with the number visible — held on the phone screen, written on paper, or signalled with fingers. Whatever works.
4. **New:** as soon as the photo is captured, the device asks for **Face ID / fingerprint** (or PIN, if biometric isn't set up).
5. On success, clock-in is recorded — same as today.

The whole new flow adds **one tap and 2-3 seconds** to a typical clock-in. The biometric prompt is the same one the user already sees when unlocking their phone, so there's no learning curve.

If a staff member's device doesn't support biometrics (older Android, shared device), they enter their existing 6-digit PIN instead. Five wrong PIN attempts in a minute triggers a 60-second cooldown.

---

## What HR / admin gets

Existing clock-records review page gets two new columns:

- **Prompt** — the 2-digit number that was issued for that clock-in. Admin can spot-check: does the photo show "47"? If not, flag.
- **Verified by** — *Face ID*, *Fingerprint*, or *PIN*. Lets admin spot trends like "this user always falls back to PIN" — which may mean their phone doesn't support biometrics, or may mean they're sharing a device with someone.

No new admin pages, no new screens. Just two more columns on the existing review.

---

## How it stays secure (in plain English)

| Risk | How we handle it |
| --- | --- |
| Colleague hands their unlocked phone to a friend | Friend's face/fingerprint won't pass the biometric check. PIN fallback exists, but PINs are private — the friend would need both the phone *and* the PIN. |
| Replay yesterday's selfie | Today's prompt is a different number. The old selfie shows yesterday's number (or no number). Admin sees the mismatch on review. |
| Save a stash of selfies for the week | Prompt is generated server-side, single-use, and expires in 90 seconds. There's no way to know the next prompt in advance. |
| Print a photo of a colleague and hold it to the camera | This spec does **not** stop that — passive face-replay defeats prompt-based liveness. The face-matching spec (separate) is what closes this. For now, admin review of prompt-vs-photo catches it on inspection. |
| User has no biometric set up | PIN fallback works on any device. After their first PIN clock-in, the app shows a one-time banner offering Face ID / fingerprint setup — not mandatory, but nudged. |
| Network drops between getting the prompt and submitting | Prompt expires at 90s. PWA quietly fetches a new one and re-prompts the user. |
| Replay the same prompt twice | Each prompt is single-use; the server deletes it on first successful submit. Re-using it returns *prompt not found*. |

---

## Scope of work

One spec, three sequential changes — shippable as one release:

**1. Worker (API) — ~2 days**
New `POST /api/clock/prompt` endpoint to issue prompts. Existing `POST /api/clock` extended to require a fresh prompt + a biometric assertion or PIN. Schema migration adds two columns to the clock-records table.

**2. Staff PWA — ~3 days**
New step 1 (fetch prompt, show number) and new step 4 (biometric / PIN modal) wired into the existing clock screen. Small new modal component for PIN fallback with rate-limit countdown.

**3. Admin portal — ~half day**
Add the two new columns to the records review page.

**Plus rollout (~3 days observation window)**: ship Worker + PWA in soft mode (records the new fields if present, doesn't reject if absent). Wait until >95% of clock-ins are carrying the new fields, then flip an `app_settings` flag to enforce. Lets stale PWA caches drain without locking anyone out.

Total: roughly **1 week of build + 3 days of observed rollout**.

---

## Decisions needed from you

Three small things to confirm:

1. **PIN lockout duration after 5 wrong attempts.** Recommend 60 seconds. Long enough to deter brute force, short enough that a fat-fingered staff member isn't punished. Acceptable?
2. **WebAuthn nudge — banner vs nothing.** After a PIN-fallback clock-in, do we show a one-time *"Want to enable Face ID?"* banner, or leave staff alone and let those who care opt-in via Settings? Recommend the banner — it's dismissable and one-time.
3. **Rollout window.** 3 days of soft-enforce before flipping the kill-switch. Too cautious, too aggressive, or fine?

---

## What this does NOT do (intentionally)

These are deliberate omissions, each with a reason:

- **Face matching against an enrolled reference photo.** Defeats the attack of holding up a photo of a colleague — but requires reference-photo enrollment, embedding storage, and an inference path (Workers AI or face-api.js). Materially bigger build, gets its own spec.
- **Passive ML liveness (blink detection, head movement).** Adds a ~3MB model download per PWA load. The random-prompt approach defeats the realistic attack (replay) without the bandwidth cost. Worth revisiting only if printed-photo attacks turn out to be common.
- **Device pinning.** Considered and dropped: WebAuthn platform credentials are already hardware-bound to the device's secure enclave, so a stolen session token can't reuse the credential on a different phone. Adding a separate device-fingerprint check would be redundant. If we later want device visibility *for audit* (not enforcement), it's a small follow-up.
- **Auto-verify the prompt is actually visible in the photo (Workers AI vision).** Considered and deferred. The framework (issuance, single-use, storage on the record) is what's worth building now. Adding `@cf/llava` inference is a bolt-on once we have real data on false-reject rates and lighting conditions. Add in v2 if admin review shows the manual check is too slow.
- **Changes to the login flow itself.** Login keeps its existing PIN-or-WebAuthn options. This spec only touches what happens at the moment of *clock-in*.

---

## Recommendation

Ship all three changes (Worker + PWA + admin column surfacing) as one release, behind a feature flag, with a 3-day soft-enforce window. The combined diff is small and the moving parts are tightly coupled — splitting into multiple deploys would create a window where the PWA expects fields the Worker doesn't yet store, or vice versa.

Once this is live, run for two weeks, then decide whether to invest in face-matching (separate spec) based on what admin review actually flags.

---

## Technical appendix (for the engineering team)

<details>
<summary>Click to expand — implementation details</summary>

### Data model

```sql
ALTER TABLE clock_records ADD COLUMN prompt_value TEXT;
ALTER TABLE clock_records ADD COLUMN reauth_method TEXT
  CHECK (reauth_method IN ('webauthn','pin') OR reauth_method IS NULL);
```

Both columns nullable so historical rows survive. New rows always populate both once `clockin_reauth_enforce` is true.

`app_settings` row:
- `clockin_reauth_enforce` (boolean, default `false` at deploy → `true` after rollout window). Kill-switch.

### KV keyspace

| Key | Value | TTL |
|---|---|---|
| `prompt:{uuid}` | `{userId, value, expiresAt}` JSON | 90s |
| `pin_attempts:{userId}` | integer counter | 60s |

Prompts are single-use: deleted on successful clock-in submit. Atomic delete via `KV.delete()` after the D1 insert succeeds (insert is the source of truth; KV is just the issued-prompt registry).

### Routes

**`POST /api/clock/prompt`** (authed, session)
- Generate random 2-digit value `10-99`.
- Generate `promptId = crypto.randomUUID()`.
- `KV.put("prompt:{promptId}", JSON.stringify({userId: session.userId, value, expiresAt: now+90_000}), {expirationTtl: 90})`.
- Return `{ promptId, value, expiresAt }`.

**`POST /api/clock`** (authed, session) — extended
Body now includes:
```ts
{
  type: 'in' | 'out',
  photo: Blob,            // existing
  lat: number,            // existing
  lng: number,            // existing
  accuracy: number,       // existing
  promptId: string,       // NEW
  assertion?: WebAuthnAssertion,  // NEW (preferred)
  pin?: string,           // NEW (fallback)
}
```

Validation order, fail-fast:
1. Session valid → derive `userId` (existing).
2. `KV.get("prompt:{promptId}")` → exists, `userId` matches, not expired.
3. Geofence + accuracy gate (existing).
4. Re-auth: if `assertion` present, verify via `verifyClockAssertion(userId, promptId, assertion)`; else if `pin`, check `pin_attempts:{userId}` < 5, then `verifyPin(userId, pin)`, increment counter on failure (KV is not atomic, but the 5-attempt threshold is intentionally soft — race conditions cost the attacker at most one extra attempt before lockout).
5. No duplicate clock-in for today / type (existing).
6. R2.put(photo) (existing).
7. D1.insert with new `prompt_value`, `reauth_method` columns.
8. `KV.delete("prompt:{promptId}")` — only after D1 insert succeeds.

If step 4 fails on PIN, increment `pin_attempts`. If step 4 fails on WebAuthn, do **not** burn the prompt — let the user try PIN fallback on the same prompt. The prompt is consumed only on full success.

### Error taxonomy

| Code | HTTP | Meaning | Client recovery |
|---|---|---|---|
| `PROMPT_EXPIRED` | 410 | Prompt > 90s old | Auto-fetch new, re-prompt user |
| `PROMPT_NOT_FOUND` | 404 | Already used or never issued | Auto-fetch new, re-prompt user |
| `PROMPT_USER_MISMATCH` | 403 | Prompt belongs to a different user | Sign-out and re-login (impossible under normal flow) |
| `REAUTH_FAILED` | 401 | Assertion invalid OR PIN wrong | Show error, allow retry on same prompt (until exhausted) |
| `REAUTH_RATE_LIMITED` | 429 | >5 PIN attempts in 60s | Show 60s lockout countdown |
| `OUTSIDE_GEOFENCE` | 400 | Existing | Existing |
| `ALREADY_CLOCKED` | 409 | Existing | Existing |

### File-by-file changes

| File | Change |
|---|---|
| `packages/api/src/db/schema.sql` | Append the two `ALTER TABLE` lines |
| `packages/api/src/db/migrations/NNNN_clockin_reauth.sql` | New migration file with the schema delta + `app_settings` row |
| `packages/api/src/routes/clock.ts` | Add `POST /api/clock/prompt`. Extend `POST /api/clock` body schema (zod), add validation steps 2 & 4, populate new columns on insert. |
| `packages/api/src/services/webauthn.ts` | Add `verifyClockAssertion(userId, promptId, assertion)` — reuses the existing credential-loading and signature-verification helpers. Challenge fed to the assertion is the `promptId` UUID bytes. |
| `packages/api/src/services/auth.ts` | Confirm existing `verifyPin` is suitable for re-auth; if it has login-only side effects (e.g. session creation), extract a pure `verifyPinValue` helper. |
| `packages/staff/src/pages/ClockPage.tsx` | New `useState` for prompt; fetch on Clock-In tap before camera opens; show prompt above viewfinder; trigger WebAuthn after photo capture; submit with new fields. |
| `packages/staff/src/components/ReauthModal.tsx` | **New.** PIN entry, shake-on-fail, lockout countdown, fallback-from-WebAuthn entry path. |
| `packages/staff/src/lib/api.ts` | New `fetchClockPrompt()`, extend `submitClockIn()` signature. |
| `packages/staff/src/components/WebAuthnNudgeBanner.tsx` | **New.** Dismissable banner shown once after a PIN-fallback clock-in, links to existing enrollment. |
| `packages/admin/src/pages/AttendancePage.tsx` (or equivalent) | Add `prompt_value` and `reauth_method` columns to the records table. |

### WebAuthn challenge binding

The WebAuthn challenge passed to `navigator.credentials.get({publicKey: {challenge}})` is the **`promptId` UUID bytes**, not a separate nonce. This:
- Saves a server roundtrip for a separate challenge fetch.
- Cryptographically binds the assertion to the same prompt being shown in the photo. An attacker can't reuse an old assertion with a new prompt or vice versa.

Server verifies the assertion's `clientDataJSON.challenge` matches the `promptId` exactly.

### UX flow ordering rationale

Biometric **after** photo, not before. If we asked for biometric first, a colleague could authenticate with their own face/finger and *then* hand the phone to a friend who takes the selfie. Putting the biometric after the photo means the same person who took the selfie is the one approving the submission — at least within the few seconds it takes. Not airtight, but materially harder than the photo-after-biometric variant.

### Rollout flag mechanics

`clockin_reauth_enforce` lives in `app_settings`, read via existing `getAppSettings()`.

- `false` → server accepts clock-ins with or without `promptId`/`assertion`/`pin`. New columns get populated when present, NULL when not.
- `true` → server requires all three. Old PWA clients without the new code get `PROMPT_NOT_FOUND` on submit and are forced to update.

Daily monitoring query during rollout window:
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE prompt_value IS NULL) AS legacy,
  100.0 * COUNT(*) FILTER (WHERE prompt_value IS NULL) / COUNT(*) AS legacy_pct
FROM clock_records
WHERE timestamp > unixepoch('now','-1 day');
```
Flip the flag when `legacy_pct < 5%`.

### Testing

**Unit (vitest, Worker):**
- Prompt issuance: returns 10-99, stores in KV, rejects unauthenticated.
- Prompt validation: accepts owning user, rejects wrong user / expired / used / malformed.
- WebAuthn re-auth: passes valid assertion over `promptId`; rejects assertion over wrong challenge; rejects another user's credential.
- PIN re-auth: passes correct PIN; rejects wrong; 6th attempt in 60s returns `REAUTH_RATE_LIMITED`.
- Single-use: replaying same `promptId` after success returns `PROMPT_NOT_FOUND`.
- Failure non-consumption: `OUTSIDE_GEOFENCE` does NOT delete the prompt (user can retry from a valid spot).

**Integration (Miniflare with in-memory D1 + KV):**
- Full happy path: issue → fetch → submit with WebAuthn → row inserted with both new columns populated → KV cleared.
- PIN fallback: WebAuthn missing → PIN supplied → succeeds → `reauth_method='pin'`.
- WebAuthn fail then PIN success on same `promptId`: succeeds, prompt still single-use.

**Manual QA on device** (gate before flipping the enforce flag):
- iOS Safari: Face ID prompt fires after photo, before submit.
- Android Chrome: Fingerprint prompt fires.
- Device with no platform authenticator: auto-falls-through to PIN modal.
- User cancels Face ID: PIN modal appears, no extra prompt fetch.
- Camera denied: existing error path unchanged.
- Slow network on submit: prompt fetched once, not re-fetched on retry.
- 5 wrong PIN attempts: 60s lockout banner with countdown.
- Network drop between prompt fetch and submit: prompt expires, PWA fetches new one.
- Admin records page shows new columns.

**Test environment:** dev/staging respects a `DEV_BYPASS_REAUTH=true` env flag that accepts any string in the `assertion` field. Production rejects this flag at boot (assert `env.ENVIRONMENT === 'production' && !DEV_BYPASS_REAUTH`).

### Reuse opportunities

- Existing WebAuthn registration/login plumbing (`packages/api/src/routes/auth-webauthn.ts`) handles credential storage and signature verification — clock-in re-auth borrows the verifier directly.
- Existing PIN verification logic in `auth.ts` is reusable; only needs a wrapper that doesn't mint a session.
- Existing geofence + duplicate-clock-in checks are unchanged and continue to run before the new re-auth step.
- Existing R2 photo upload path is unchanged.
- `app_settings` table and `getAppSettings()` helper provide the kill-switch with no new infrastructure.

</details>
