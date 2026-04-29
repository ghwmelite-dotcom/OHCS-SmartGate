# Clock-In Re-Auth & Liveness Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-clock-in WebAuthn re-auth (with PIN fallback) and a single-use 2-digit "show this number" prompt that must be visible in the captured selfie. Closes the realistic colleague-impersonation attacks described in the spec.

**Architecture:** New `POST /api/clock/prompt` issues a fresh prompt stored in KV (90s TTL, single-use). Existing `POST /api/clock` is extended to require `prompt_id` + WebAuthn assertion *or* PIN, validated server-side before the row is inserted. Two new columns on `clock_records` (`prompt_value`, `reauth_method`) + new `app_settings` columns for thresholds and the kill-switch flag. Staff PWA clock flow inserts a prompt-fetch step before the camera and a re-auth step after the photo. Admin attendance tab gains two new columns.

**Tech Stack:** Cloudflare Workers + Hono, D1, KV, R2 (R2 unchanged in this plan), `@simplewebauthn/server` for assertion verification, React + TypeScript PWA, Tailwind.

**Companion spec:** `docs/superpowers/specs/2026-04-29-clockin-reauth-and-liveness-design.md`.

**Note on TDD:** The project does not have a unit-test harness. Per-task verification uses `curl` against `wrangler dev` for Worker changes and manual browser checks for PWA changes. Each task ends with a verification step before commit.

---

## Task 1: Migration — schema delta for re-auth + liveness columns

**Files:**
- Create: `packages/api/src/db/migration-clockin-reauth.sql`
- Modify: `packages/api/src/db/migrations-index.ts`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Create the migration file**

Create `packages/api/src/db/migration-clockin-reauth.sql`:

```sql
-- Clock-in re-auth + liveness prompt (companion spec: 2026-04-29-clockin-reauth-and-liveness-design.md)
-- Adds prompt_value + reauth_method columns to clock_records, plus three new
-- app_settings columns: enforcement flag, PIN attempt cap, prompt TTL seconds.

ALTER TABLE clock_records ADD COLUMN prompt_value TEXT;
ALTER TABLE clock_records ADD COLUMN reauth_method TEXT
  CHECK (reauth_method IN ('webauthn','pin') OR reauth_method IS NULL);

-- New columns on app_settings (singleton row id=1).
-- D1/SQLite ALTER TABLE ADD COLUMN cannot have non-constant DEFAULTs, so we
-- add nullable columns and backfill with UPDATE.
ALTER TABLE app_settings ADD COLUMN clockin_reauth_enforce INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_pin_attempt_cap INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_prompt_ttl_seconds INTEGER;

UPDATE app_settings
   SET clockin_reauth_enforce      = COALESCE(clockin_reauth_enforce, 0),
       clockin_pin_attempt_cap     = COALESCE(clockin_pin_attempt_cap, 5),
       clockin_prompt_ttl_seconds  = COALESCE(clockin_prompt_ttl_seconds, 90)
 WHERE id = 1;
```

- [ ] **Step 2: Register the migration**

Modify `packages/api/src/db/migrations-index.ts` — add the import and the registry entry. The registry is order-sensitive; append to the end so it runs after every existing migration.

```typescript
// Add near the other imports (alphabetical-ish, mirror existing style)
import clockinReauth from './migration-clockin-reauth.sql';

// In the MIGRATIONS array, append:
  { filename: 'migration-clockin-reauth.sql', sql: clockinReauth },
```

- [ ] **Step 3: Mirror the change in `schema.sql`**

Modify `packages/api/src/db/schema.sql`. Two edits:

(a) Update the `clock_records` CREATE TABLE — add the two new columns just after `idempotency_key`:

```sql
CREATE TABLE IF NOT EXISTS clock_records (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id         TEXT NOT NULL REFERENCES users(id),
    type            TEXT NOT NULL CHECK(type IN ('clock_in', 'clock_out')),
    timestamp       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    latitude        REAL,
    longitude       REAL,
    within_geofence INTEGER NOT NULL DEFAULT 0 CHECK(within_geofence IN (0, 1)),
    photo_url       TEXT,
    device_info     TEXT,
    idempotency_key TEXT,
    prompt_value    TEXT,
    reauth_method   TEXT CHECK (reauth_method IN ('webauthn','pin') OR reauth_method IS NULL),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

(b) Update the `app_settings` CREATE TABLE — add the three new columns:

```sql
CREATE TABLE IF NOT EXISTS app_settings (
    id                          INTEGER PRIMARY KEY CHECK (id = 1),
    work_start_time             TEXT NOT NULL,
    late_threshold_time         TEXT NOT NULL,
    work_end_time               TEXT NOT NULL,
    updated_by                  TEXT,
    updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    clockin_reauth_enforce      INTEGER NOT NULL DEFAULT 0 CHECK(clockin_reauth_enforce IN (0,1)),
    clockin_pin_attempt_cap     INTEGER NOT NULL DEFAULT 5,
    clockin_prompt_ttl_seconds  INTEGER NOT NULL DEFAULT 90
);

INSERT OR IGNORE INTO app_settings (id, work_start_time, late_threshold_time, work_end_time)
VALUES (1, '08:00', '08:30', '17:00');
```

- [ ] **Step 4: Verify migration applies cleanly on a fresh local D1**

Run from `packages/api`:

```bash
npx wrangler d1 execute ohcs-smartgate --local --file=src/db/schema.sql
npx wrangler d1 execute ohcs-smartgate --local --command="PRAGMA table_info(clock_records);"
npx wrangler d1 execute ohcs-smartgate --local --command="PRAGMA table_info(app_settings);"
```

Expected: `prompt_value` and `reauth_method` listed for `clock_records`. `clockin_reauth_enforce`, `clockin_pin_attempt_cap`, `clockin_prompt_ttl_seconds` listed for `app_settings`.

- [ ] **Step 5: Verify migration applies as a delta (existing DB)**

Apply the bare migration file to a copy of the existing schema (without the schema.sql edits) and confirm the ALTER+UPDATE statements succeed:

```bash
# Reset local D1 to a known prior state, then apply only the migration:
npx wrangler d1 execute ohcs-smartgate --local --command="DROP TABLE IF EXISTS clock_records; DROP TABLE IF EXISTS app_settings;"
# Re-create the OLD shape (without our new columns) inline:
npx wrangler d1 execute ohcs-smartgate --local --command="CREATE TABLE clock_records (id TEXT PRIMARY KEY, user_id TEXT, type TEXT, timestamp TEXT, latitude REAL, longitude REAL, within_geofence INTEGER, photo_url TEXT, device_info TEXT, idempotency_key TEXT, created_at TEXT); CREATE TABLE app_settings (id INTEGER PRIMARY KEY, work_start_time TEXT, late_threshold_time TEXT, work_end_time TEXT, updated_by TEXT, updated_at TEXT); INSERT INTO app_settings VALUES (1, '08:00','08:30','17:00',NULL,'2026-04-29T00:00:00Z');"
# Now apply our migration:
npx wrangler d1 execute ohcs-smartgate --local --file=src/db/migration-clockin-reauth.sql
# Confirm:
npx wrangler d1 execute ohcs-smartgate --local --command="SELECT clockin_reauth_enforce, clockin_pin_attempt_cap, clockin_prompt_ttl_seconds FROM app_settings WHERE id=1;"
```

Expected: row with `0, 5, 90`.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/db/migration-clockin-reauth.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(db): clock-in re-auth + liveness schema delta

Adds prompt_value + reauth_method on clock_records and three app_settings
columns (enforcement flag, PIN attempt cap, prompt TTL). Mirrored in
schema.sql; migration registered in migrations-index.

Companion to spec docs/superpowers/specs/2026-04-29-clockin-reauth-and-liveness-design.md"
```

---

## Task 2: Settings — extend `AppSettings` type & `getAppSettings`

**Files:**
- Modify: `packages/api/src/services/settings.ts`

- [ ] **Step 1: Extend the `AppSettings` interface**

In `packages/api/src/services/settings.ts`, replace the existing `AppSettings` interface and `DEFAULTS` constant with:

```typescript
export interface AppSettings {
  work_start_time: string;      // "HH:MM"
  late_threshold_time: string;  // "HH:MM"
  work_end_time: string;        // "HH:MM"
  updated_by: string | null;
  updated_at: string;
  // Clock-in re-auth + liveness (added by migration-clockin-reauth.sql)
  clockin_reauth_enforce: number;       // 0 = soft (record but don't reject), 1 = enforce
  clockin_pin_attempt_cap: number;      // PIN re-auth attempts allowed before lockout
  clockin_prompt_ttl_seconds: number;   // Prompt validity window
}

const KV_KEY = 'app-settings:v1';
const KV_TTL = 300;          // 5 min KV cache
const MEMO_TTL_MS = 60_000;  // 60s per-isolate memo

const DEFAULTS: AppSettings = {
  work_start_time: '08:00',
  late_threshold_time: '08:30',
  work_end_time: '17:00',
  updated_by: null,
  updated_at: '1970-01-01T00:00:00Z',
  clockin_reauth_enforce: 0,
  clockin_pin_attempt_cap: 5,
  clockin_prompt_ttl_seconds: 90,
};
```

- [ ] **Step 2: Update the SELECT statement in `getAppSettings`**

In the same file, update the SELECT inside `getAppSettings` to include the new columns:

```typescript
  const row = await env.DB.prepare(
    `SELECT work_start_time, late_threshold_time, work_end_time, updated_by, updated_at,
            clockin_reauth_enforce, clockin_pin_attempt_cap, clockin_prompt_ttl_seconds
     FROM app_settings WHERE id = 1`
  ).first<AppSettings>();
```

- [ ] **Step 3: Bump the KV cache key**

Cached settings under `app-settings:v1` won't have the new fields. Bump to `v2`:

```typescript
const KV_KEY = 'app-settings:v2';
```

This is a one-line change but critical — without it, stale `v1` cache entries will keep returning the old shape until KV expires.

- [ ] **Step 4: Verify type-check passes**

Run the project type-check (per memory: root `npm run type-check` may fail with path-spaces; use direct tsc invocation):

```bash
cd packages/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/settings.ts
git commit -m "feat(api): extend AppSettings with clock-in re-auth flags

Adds clockin_reauth_enforce, clockin_pin_attempt_cap,
clockin_prompt_ttl_seconds to AppSettings interface, DEFAULTS,
and getAppSettings SELECT. Bumps KV cache key to v2 to evict
stale shape."
```

---

## Task 3: Worker — `POST /api/clock/prompt` route

**Files:**
- Modify: `packages/api/src/routes/clock.ts`

- [ ] **Step 1: Add prompt issuance helpers at the top of `clock.ts`**

In `packages/api/src/routes/clock.ts`, add — after the existing `pointInPolygon`-related helpers and before the `clockSchema`:

```typescript
// ---- Clock-in re-auth + liveness prompt ----
// 2-digit prompt (10..99) issued at the start of every clock-in. Must be
// visible in the captured selfie. Stored single-use in KV with the user
// binding so a session swap can't replay another user's prompt.

interface ClockPrompt {
  userId: string;
  value: string;        // "10".."99"
  expiresAt: number;    // unix ms
}

function generatePromptValue(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // 10..99 inclusive
  return String(10 + (array[0]! % 90));
}

function promptKey(promptId: string): string {
  return `clock-prompt:${promptId}`;
}

function pinAttemptKey(userId: string, isoDate: string): string {
  return `clock-pin-attempts:${userId}:${isoDate}`;
}
```

- [ ] **Step 2: Add the route handler**

In the same file, add the new route — anywhere after `clockRoutes` is declared and before the existing `clockRoutes.post('/', ...)`:

```typescript
// Issue a fresh 2-digit prompt for the next clock-in. Single-use, 90s TTL
// (configurable via app_settings.clockin_prompt_ttl_seconds).
clockRoutes.post('/prompt', async (c) => {
  const session = c.get('session');
  const settings = await getAppSettings(c.env);
  const ttl = Math.max(30, Math.min(300, settings.clockin_prompt_ttl_seconds));

  const promptId = crypto.randomUUID();
  const value = generatePromptValue();
  const expiresAt = Date.now() + ttl * 1000;

  const data: ClockPrompt = { userId: session.userId, value, expiresAt };
  await c.env.KV.put(promptKey(promptId), JSON.stringify(data), { expirationTtl: ttl });

  devLog(c.env, `[CLOCK_PROMPT] issued ${promptId} value=${value} ttl=${ttl}s user=${session.userId}`);
  return success(c, { prompt_id: promptId, prompt_value: value, expires_at: expiresAt });
});
```

- [ ] **Step 3: Type-check**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Integration verify with `wrangler dev`**

Start the Worker locally:

```bash
cd packages/api && npx wrangler dev --local --port 8787
```

In another terminal, log in (use a seeded test user — see `project_seeded_users.md`):

```bash
# Acquire a session_id token via existing PIN login (replace creds)
TOKEN=$(curl -s -X POST http://localhost:8787/api/auth/pin-login \
  -H 'Content-Type: application/json' \
  -d '{"staff_id":"OHCS-TEST-1","pin":"123456"}' | jq -r '.data.session_token')
echo "TOKEN=$TOKEN"

# Hit the new endpoint
curl -s -X POST http://localhost:8787/api/clock/prompt \
  -H "Authorization: Bearer $TOKEN" | jq
```

Expected: `{ "data": { "prompt_id": "<uuid>", "prompt_value": "<10-99>", "expires_at": <millis> } }`.

- [ ] **Step 5: Verify the prompt landed in KV with the right shape**

```bash
# Replace <uuid> with the prompt_id from the previous response
npx wrangler kv key get --binding=KV --local "clock-prompt:<uuid>"
```

Expected: a JSON value with `userId`, `value`, `expiresAt`.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/clock.ts
git commit -m "feat(api): add POST /api/clock/prompt for liveness prompt issuance

Issues a fresh 2-digit prompt (10..99) bound to the session's userId,
stored single-use in KV with TTL from app_settings.clockin_prompt_ttl_seconds.
Companion endpoint to be consumed by extended POST /api/clock."
```

---

## Task 4: Worker — clock-in re-auth helper (WebAuthn)

**Files:**
- Create: `packages/api/src/services/clock-reauth.ts`

- [ ] **Step 1: Create the re-auth service**

Create `packages/api/src/services/clock-reauth.ts`:

```typescript
import {
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/types';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { Env } from '../types';
import { resolveRp } from '../lib/webauthn-rp';
import { verifyPin } from './auth';
import type { Context } from 'hono';

export type ReauthOutcome =
  | { ok: true; method: 'webauthn' | 'pin' }
  | { ok: false; reason: 'no_credential' | 'verification_failed' | 'rate_limited' | 'no_pin_set' };

/**
 * Verify a WebAuthn assertion produced for a clock-in.
 *
 * The assertion's `clientDataJSON.challenge` MUST equal the prompt_id (UUID
 * string) that was issued by POST /api/clock/prompt. We use the same UUID
 * for both the cryptographic challenge and the visible prompt to bind the
 * assertion to the same prompt the staff member is showing in the photo.
 */
export async function verifyClockWebAuthnAssertion(
  c: Context<{ Bindings: Env }>,
  userId: string,
  promptId: string,
  assertion: AuthenticationResponseJSON,
): Promise<ReauthOutcome> {
  const rp = resolveRp(c);
  if (!rp) return { ok: false, reason: 'verification_failed' };

  const credentialId = assertion.id;
  const cred = await c.env.DB.prepare(
    `SELECT id, user_id, public_key, counter, transports
     FROM webauthn_credentials WHERE id = ? AND user_id = ?`
  ).bind(credentialId, userId).first<{
    id: string; user_id: string; public_key: string; counter: number; transports: string | null;
  }>();
  if (!cred) return { ok: false, reason: 'no_credential' };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      // The challenge issued to the browser is the prompt_id. simplewebauthn
      // expects base64url; the spec's assumption is that the PWA passes the
      // raw UUID string, base64url-encoded, as the WebAuthn challenge.
      expectedChallenge: isoBase64URL.fromUTF8String(promptId),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: cred.id,
        publicKey: isoBase64URL.toBuffer(cred.public_key),
        counter: cred.counter,
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, reason: 'verification_failed' };
  }

  if (!verification.verified) return { ok: false, reason: 'verification_failed' };

  // Bump counter + last_used so a replayed assertion is rejected next time.
  await c.env.DB.prepare(
    `UPDATE webauthn_credentials SET counter = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`
  ).bind(verification.authenticationInfo.newCounter, cred.id).run();

  return { ok: true, method: 'webauthn' };
}

/**
 * Verify a PIN re-auth attempt for the given user, with KV-backed daily
 * rate-limiting. Returns 'rate_limited' when the user has exceeded
 * `clockin_pin_attempt_cap` failed attempts on the current ISO date.
 *
 * On a wrong PIN, the attempt counter is incremented (best-effort; KV is not
 * atomic but the cap is intentionally soft — a race costs at most one extra
 * attempt before lockout).
 */
export async function verifyClockPin(
  env: Env,
  userId: string,
  pin: string,
  attemptCap: number,
): Promise<ReauthOutcome> {
  const isoDate = new Date().toISOString().slice(0, 10);
  const key = `clock-pin-attempts:${userId}:${isoDate}`;

  const currentRaw = await env.KV.get(key);
  const current = currentRaw ? Number(currentRaw) : 0;
  if (current >= attemptCap) return { ok: false, reason: 'rate_limited' };

  const row = await env.DB.prepare(
    'SELECT pin_hash FROM users WHERE id = ?'
  ).bind(userId).first<{ pin_hash: string | null }>();
  if (!row || !row.pin_hash) return { ok: false, reason: 'no_pin_set' };

  const ok = await verifyPin(pin, row.pin_hash);
  if (!ok) {
    // Best-effort increment, 24h TTL.
    await env.KV.put(key, String(current + 1), { expirationTtl: 86400 });
    return { ok: false, reason: 'verification_failed' };
  }

  // Successful auth — clear the counter so a fat-finger run doesn't carry over.
  await env.KV.delete(key);
  return { ok: true, method: 'pin' };
}
```

- [ ] **Step 2: Type-check**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/clock-reauth.ts
git commit -m "feat(api): clock-in re-auth helpers (WebAuthn + PIN)

Adds verifyClockWebAuthnAssertion (binds assertion challenge to the
prompt_id UUID, bumps WebAuthn counter on success) and verifyClockPin
(KV-backed daily attempt cap, clears counter on success).

Pure helpers — wired into POST /api/clock in the next task."
```

---

## Task 5: Worker — extend `POST /api/clock` with prompt + re-auth

**Files:**
- Modify: `packages/api/src/routes/clock.ts`

- [ ] **Step 1: Update imports at the top of `clock.ts`**

Add the new imports:

```typescript
import { verifyClockWebAuthnAssertion, verifyClockPin } from '../services/clock-reauth';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
```

- [ ] **Step 2: Extend `clockSchema`**

Replace the existing `clockSchema` declaration with:

```typescript
const clockSchema = z.object({
  type: z.enum(['clock_in', 'clock_out']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
  idempotency_key: z.string().min(1).max(100).optional(),
  // New: re-auth + liveness
  prompt_id: z.string().uuid().optional(),
  webauthn_assertion: z.unknown().optional(),
  pin: z.string().min(4).max(10).optional(),
});
```

`prompt_id`, `webauthn_assertion`, `pin` are all optional in the zod schema because:
- During soft-rollout (`clockin_reauth_enforce=0`), legacy PWA clients still work without them.
- The handler enforces presence at runtime when the flag is on.

- [ ] **Step 3: Insert the prompt + re-auth validation block**

Modify `clockRoutes.post('/', ...)` — insert this block immediately after the idempotency-key short-circuit (around line 146 in the current file) and before the GPS-accuracy check. Use the exact code:

```typescript
  // ---- Prompt + re-auth gate (post-idempotency, pre-geofence) ----
  const settings = await getAppSettings(c.env);
  const enforce = settings.clockin_reauth_enforce === 1;
  const promptId = c.req.valid('json').prompt_id;
  const webauthnAssertion = c.req.valid('json').webauthn_assertion as AuthenticationResponseJSON | undefined;
  const pin = c.req.valid('json').pin;

  let promptValue: string | null = null;
  let reauthMethod: 'webauthn' | 'pin' | null = null;

  if (promptId) {
    // Verify the prompt was issued to THIS user, is unexpired, and is unused.
    const raw = await c.env.KV.get(promptKey(promptId));
    if (!raw) {
      return error(c, 'PROMPT_NOT_FOUND', 'Your clock-in prompt has expired or was already used. Please try again.', 410);
    }
    const stored = JSON.parse(raw) as ClockPrompt;
    if (stored.userId !== session.userId) {
      return error(c, 'PROMPT_USER_MISMATCH', 'Prompt does not belong to this user', 403);
    }
    if (stored.expiresAt < Date.now()) {
      await c.env.KV.delete(promptKey(promptId));
      return error(c, 'PROMPT_EXPIRED', 'Your clock-in prompt has expired. Please try again.', 410);
    }
    promptValue = stored.value;
  } else if (enforce) {
    return error(c, 'PROMPT_REQUIRED', 'A fresh clock-in prompt is required.', 400);
  }

  // Re-auth — try WebAuthn first; on absence/failure, fall back to PIN.
  if (webauthnAssertion && promptId) {
    const outcome = await verifyClockWebAuthnAssertion(c, session.userId, promptId, webauthnAssertion);
    if (outcome.ok) {
      reauthMethod = 'webauthn';
    } else if (pin === undefined) {
      // No PIN fallback supplied — fail.
      if (enforce) {
        return error(c, 'REAUTH_FAILED', 'Biometric verification failed. Try your PIN.', 401);
      }
    }
  }

  if (reauthMethod === null && pin !== undefined) {
    const outcome = await verifyClockPin(c.env, session.userId, pin, settings.clockin_pin_attempt_cap);
    if (outcome.ok) {
      reauthMethod = 'pin';
    } else if (outcome.reason === 'rate_limited') {
      return error(c, 'REAUTH_RATE_LIMITED', `Too many wrong PIN attempts. Try again tomorrow.`, 429);
    } else {
      if (enforce) {
        return error(c, 'REAUTH_FAILED', 'PIN verification failed.', 401);
      }
    }
  }

  if (enforce && reauthMethod === null) {
    return error(c, 'REAUTH_REQUIRED', 'Biometric or PIN verification is required to clock in.', 401);
  }
```

- [ ] **Step 4: Update the INSERT statement to include the new columns**

Replace the existing `INSERT INTO clock_records` statement with:

```typescript
  await c.env.DB.prepare(
    `INSERT INTO clock_records (id, user_id, type, latitude, longitude, within_geofence, idempotency_key, prompt_value, reauth_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    session.userId,
    type,
    latitude,
    longitude,
    withinGeofence ? 1 : 0,
    idempotency_key ?? null,
    promptValue,
    reauthMethod,
  ).run();
```

- [ ] **Step 5: Consume the prompt after a successful insert**

Immediately after the INSERT call (and before the streak update), add:

```typescript
  // Consume the prompt — single-use enforced by KV.delete.
  if (promptId) {
    await c.env.KV.delete(promptKey(promptId));
  }
```

- [ ] **Step 6: Type-check**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Integration verify — soft-rollout path (legacy client)**

With `clockin_reauth_enforce=0` (default after migration), legacy clients without `prompt_id` should still succeed:

```bash
# wrangler dev still running from Task 3
TOKEN=...  # from earlier
# OHCS coords: 5.5526, -0.1972
curl -s -X POST http://localhost:8787/api/clock/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"clock_in","latitude":5.5527,"longitude":-0.1975,"accuracy":10}' | jq
```

Expected: 200 OK with the existing payload shape. `prompt_value` and `reauth_method` should be NULL on the inserted row:

```bash
npx wrangler d1 execute ohcs-smartgate --local \
  --command="SELECT id, type, prompt_value, reauth_method FROM clock_records ORDER BY created_at DESC LIMIT 1;"
```

- [ ] **Step 8: Integration verify — prompt path (new client)**

```bash
# 1. Issue a prompt
PROMPT=$(curl -s -X POST http://localhost:8787/api/clock/prompt \
  -H "Authorization: Bearer $TOKEN")
PROMPT_ID=$(echo "$PROMPT" | jq -r '.data.prompt_id')
PROMPT_VAL=$(echo "$PROMPT" | jq -r '.data.prompt_value')
echo "PROMPT_ID=$PROMPT_ID VALUE=$PROMPT_VAL"

# 2. Clock in with prompt + PIN (skip WebAuthn for curl test)
curl -s -X POST http://localhost:8787/api/clock/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"clock_in\",\"latitude\":5.5527,\"longitude\":-0.1975,\"accuracy\":10,\"prompt_id\":\"$PROMPT_ID\",\"pin\":\"123456\"}" | jq

# 3. Verify the row has prompt_value + reauth_method=pin
npx wrangler d1 execute ohcs-smartgate --local \
  --command="SELECT id, type, prompt_value, reauth_method FROM clock_records ORDER BY created_at DESC LIMIT 1;"

# 4. Verify the prompt is gone from KV (single-use)
npx wrangler kv key get --binding=KV --local "clock-prompt:$PROMPT_ID"
# Expected: not found / null
```

Note: First clear the existing clock-in row from step 7, otherwise step 2 hits `ALREADY_CLOCKED`:

```bash
npx wrangler d1 execute ohcs-smartgate --local --command="DELETE FROM clock_records WHERE user_id = (SELECT id FROM users WHERE staff_id='OHCS-TEST-1');"
```

- [ ] **Step 9: Integration verify — enforce path**

Flip the flag and verify legacy clients are rejected:

```bash
npx wrangler d1 execute ohcs-smartgate --local --command="UPDATE app_settings SET clockin_reauth_enforce = 1 WHERE id = 1;"
# Bust the KV cache:
npx wrangler kv key delete --binding=KV --local "app-settings:v2"

# Try a clock-in WITHOUT prompt_id:
npx wrangler d1 execute ohcs-smartgate --local --command="DELETE FROM clock_records WHERE user_id = (SELECT id FROM users WHERE staff_id='OHCS-TEST-1');"
curl -s -X POST http://localhost:8787/api/clock/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"clock_in","latitude":5.5527,"longitude":-0.1975,"accuracy":10}' | jq
# Expected: 400 PROMPT_REQUIRED

# Reset the flag for now:
npx wrangler d1 execute ohcs-smartgate --local --command="UPDATE app_settings SET clockin_reauth_enforce = 0 WHERE id = 1;"
npx wrangler kv key delete --binding=KV --local "app-settings:v2"
```

- [ ] **Step 10: Integration verify — PIN rate-limit**

```bash
# Issue a fresh prompt
PROMPT_ID=$(curl -s -X POST http://localhost:8787/api/clock/prompt \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data.prompt_id')

# Hit it 5 times with the wrong PIN — each returns REAUTH_FAILED (or 200 under soft mode without enforce; flip enforce on for this test)
npx wrangler d1 execute ohcs-smartgate --local --command="UPDATE app_settings SET clockin_reauth_enforce = 1 WHERE id = 1;"
npx wrangler kv key delete --binding=KV --local "app-settings:v2"

for i in 1 2 3 4 5 6; do
  curl -s -X POST http://localhost:8787/api/clock/ \
    -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"type\":\"clock_in\",\"latitude\":5.5527,\"longitude\":-0.1975,\"accuracy\":10,\"prompt_id\":\"$PROMPT_ID\",\"pin\":\"000000\"}" \
    | jq -r '.error.code'
done
# Expected: REAUTH_FAILED, REAUTH_FAILED, REAUTH_FAILED, REAUTH_FAILED, REAUTH_FAILED, REAUTH_RATE_LIMITED

# Reset:
npx wrangler kv key delete --binding=KV --local "clock-pin-attempts:$(npx wrangler d1 execute ohcs-smartgate --local --command='SELECT id FROM users WHERE staff_id=\"OHCS-TEST-1\";' --json | jq -r '.[0].results[0].id'):$(date -u +%Y-%m-%d)"
npx wrangler d1 execute ohcs-smartgate --local --command="UPDATE app_settings SET clockin_reauth_enforce = 0 WHERE id = 1;"
npx wrangler kv key delete --binding=KV --local "app-settings:v2"
```

- [ ] **Step 11: Commit**

```bash
git add packages/api/src/routes/clock.ts
git commit -m "feat(api): require prompt + re-auth at POST /api/clock under enforcement

Extends clockSchema with prompt_id, webauthn_assertion, pin. Inserts a
validation block after the idempotency short-circuit: KV-backed prompt
single-use check, WebAuthn-first re-auth with PIN fallback, daily PIN
attempt cap. Stores prompt_value + reauth_method on the new row.

Soft-rollout default (clockin_reauth_enforce=0): legacy clients keep
working; new fields populated when present."
```

---

## Task 6: PWA — API client extension (`fetchClockPrompt`, extend `submitClockIn`)

**Files:**
- Modify: `packages/staff/src/lib/api.ts` (or actual location of clock-related API helpers — verify)

- [ ] **Step 1: Locate the clock API client**

```bash
grep -rn "POST.*clock" packages/staff/src
```

Identify the file that currently calls `POST /api/clock` (likely `packages/staff/src/lib/api.ts` or `packages/staff/src/pages/ClockPage.tsx` directly).

- [ ] **Step 2: Add `fetchClockPrompt`**

In the identified API client file, add:

```typescript
export interface ClockPrompt {
  promptId: string;
  promptValue: string;
  expiresAt: number;
}

export async function fetchClockPrompt(): Promise<ClockPrompt> {
  const res = await apiFetch('/api/clock/prompt', { method: 'POST' });
  // apiFetch convention in this project: throws on non-2xx, returns parsed body
  return {
    promptId: res.data.prompt_id,
    promptValue: res.data.prompt_value,
    expiresAt: res.data.expires_at,
  };
}
```

If the existing API helper has a different shape (e.g. returns the raw envelope), match that shape — verify against another existing helper in the same file.

- [ ] **Step 3: Extend the existing `submitClockIn` (or equivalent) signature**

Locate the existing helper that calls `POST /api/clock` and extend it to accept the new optional fields:

```typescript
export interface ClockSubmission {
  type: 'clock_in' | 'clock_out';
  latitude: number;
  longitude: number;
  accuracy?: number;
  idempotencyKey?: string;
  promptId?: string;
  webauthnAssertion?: unknown;   // AuthenticationResponseJSON from @simplewebauthn/browser
  pin?: string;
}

export async function submitClockIn(input: ClockSubmission) {
  return apiFetch('/api/clock/', {
    method: 'POST',
    body: JSON.stringify({
      type: input.type,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      idempotency_key: input.idempotencyKey,
      prompt_id: input.promptId,
      webauthn_assertion: input.webauthnAssertion,
      pin: input.pin,
    }),
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 4: Type-check**

```bash
cd packages/staff && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/staff/src/lib/api.ts
git commit -m "feat(staff): API client for clock prompt + re-auth submission

Adds fetchClockPrompt() and extends the existing clock-in submit
helper with optional prompt_id, webauthn_assertion, pin fields.
Wiring into ClockPage in next task."
```

---

## Task 7: PWA — `ReauthModal` component

**Files:**
- Create: `packages/staff/src/components/ReauthModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `packages/staff/src/components/ReauthModal.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';

interface ReauthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<{ ok: boolean; rateLimited?: boolean; message?: string }>;
  /**
   * If true, rendered directly after a WebAuthn failure — copy reflects "PIN fallback"
   * rather than "PIN required".
   */
  fallback?: boolean;
}

export function ReauthModal({ isOpen, onClose, onSubmit, fallback }: ReauthModalProps) {
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(null);
      // Focus shortly after mount so iOS Safari opens the keyboard
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4 || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await onSubmit(pin);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.message ?? (res.rateLimited ? 'Too many wrong attempts. Try tomorrow.' : 'Wrong PIN'));
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setPin('');
      inputRef.current?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className={`w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl ${shake ? 'animate-shake' : ''}`}
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {fallback ? 'Enter your PIN' : 'Confirm clock-in'}
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          {fallback
            ? 'Biometric is unavailable on this device. Enter your PIN to continue.'
            : 'Enter your PIN to confirm this clock-in.'}
        </p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={10}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          className="mt-4 w-full px-4 py-3 text-2xl text-center tracking-widest border-2 border-slate-200 rounded-2xl focus:border-emerald-500 focus:outline-none"
          placeholder="••••••"
          aria-label="PIN"
        />
        {error && (
          <p className="mt-2 text-sm text-rose-600 text-center" role="alert">{error}</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-3 rounded-2xl text-slate-700 bg-slate-100 font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pin.length < 4 || submitting}
            className="px-4 py-3 rounded-2xl text-white bg-emerald-600 font-medium disabled:opacity-50"
          >
            {submitting ? '…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add the shake animation to the global stylesheet**

Locate the staff PWA's main stylesheet (likely `packages/staff/src/index.css` or `packages/staff/src/main.css`). Append:

```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}
.animate-shake { animation: shake 0.4s ease-in-out; }

@media (prefers-reduced-motion: reduce) {
  .animate-shake { animation: none; }
}
```

- [ ] **Step 3: Type-check**

```bash
cd packages/staff && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/staff/src/components/ReauthModal.tsx packages/staff/src/index.css
git commit -m "feat(staff): ReauthModal for clock-in PIN fallback

Bottom-sheet modal with single PIN input, shake-on-fail, rate-limit
message, reduced-motion respect. Used by ClockPage when WebAuthn is
unavailable or fails."
```

---

## Task 8: PWA — `WebAuthnNudgeBanner` component

**Files:**
- Create: `packages/staff/src/components/WebAuthnNudgeBanner.tsx`

- [ ] **Step 1: Create the nudge banner**

Create `packages/staff/src/components/WebAuthnNudgeBanner.tsx`:

```typescript
import { useState } from 'react';

const STORAGE_KEY = 'webauthn-nudge-dismissed';

interface WebAuthnNudgeBannerProps {
  /** Show only when last clock-in fell back to PIN AND user has no enrolled credential. */
  shouldShow: boolean;
  onEnroll: () => void;
}

export function WebAuthnNudgeBanner({ shouldShow, onEnroll }: WebAuthnNudgeBannerProps) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  if (!shouldShow || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="mx-4 my-3 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-600 text-white grid place-items-center text-lg" aria-hidden>
        🔒
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-emerald-900">Faster clock-in with Face ID</p>
        <p className="text-sm text-emerald-800 mt-1">
          You used your PIN this time. Set up Face ID or fingerprint so next time it's instant.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={onEnroll}
            className="px-3 py-1.5 text-sm font-medium rounded-xl bg-emerald-600 text-white"
          >
            Set up
          </button>
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 text-sm font-medium rounded-xl text-emerald-700"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd packages/staff && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/staff/src/components/WebAuthnNudgeBanner.tsx
git commit -m "feat(staff): WebAuthnNudgeBanner for biometric setup

Dismissable banner shown after a PIN-fallback clock-in. localStorage
flag keeps it dismissed across sessions. Wired into ClockPage in
next task."
```

---

## Task 9: PWA — wire prompt + re-auth into `ClockPage` flow

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Read the existing ClockPage to understand the current flow**

```bash
cat packages/staff/src/pages/ClockPage.tsx
```

Identify:
- Where `submitClockIn` is called (the existing flow's submit point).
- Where the camera capture happens (likely a `getUserMedia` or `<input type="file" capture>` block).
- Where the location is acquired.

- [ ] **Step 2: Add imports**

At the top of `ClockPage.tsx`:

```typescript
import { useState } from 'react';
import { ReauthModal } from '../components/ReauthModal';
import { WebAuthnNudgeBanner } from '../components/WebAuthnNudgeBanner';
import { fetchClockPrompt, submitClockIn, type ClockPrompt } from '../lib/api';
import { startAuthentication } from '@simplewebauthn/browser';
```

- [ ] **Step 3: Add state for the new flow**

Inside the `ClockPage` component:

```typescript
  const [prompt, setPrompt] = useState<ClockPrompt | null>(null);
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<{
    type: 'clock_in' | 'clock_out';
    latitude: number;
    longitude: number;
    accuracy?: number;
  } | null>(null);
  const [showNudge, setShowNudge] = useState(false);
```

- [ ] **Step 4: Replace the existing clock-in start with a prompt-first flow**

The new flow:

1. User taps "Clock In" / "Clock Out".
2. **Fetch prompt FIRST** (before the camera).
3. Show prompt on screen.
4. Open camera, capture selfie (existing logic, unchanged).
5. After photo capture, get location (existing).
6. **Try WebAuthn** (`startAuthentication` with `challenge=prompt_id`).
7. On WebAuthn success: submit with `webauthn_assertion`.
8. On WebAuthn fail/no-credential: open `ReauthModal` for PIN entry, submit with `pin`.

Replace the existing submit flow (or wrap it) with:

```typescript
  const handleClockAction = async (type: 'clock_in' | 'clock_out') => {
    try {
      // 1. Get fresh prompt
      const fresh = await fetchClockPrompt();
      setPrompt(fresh);

      // 2. Show prompt to user (rendered conditionally below); user has 90s to capture.
      // 3. Camera + photo (existing flow — adapted to wait for prompt + capture combined)
      const photoBlob = await captureSelfie(); // existing helper

      // 4. Location (existing)
      const position = await getCurrentPosition();
      const submission = {
        type,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };

      // 5. Try WebAuthn (challenge = prompt_id, encoded as base64url of UTF-8 bytes)
      let assertion: unknown | null = null;
      try {
        assertion = await startAuthentication({
          challenge: utf8ToBase64Url(fresh.promptId),
          // allowCredentials omitted — browser uses any platform authenticator
          userVerification: 'required',
        });
      } catch {
        assertion = null;
      }

      if (assertion) {
        // 6a. WebAuthn path
        await submitClockIn({
          ...submission,
          promptId: fresh.promptId,
          webauthnAssertion: assertion,
        });
        // Upload photo (existing flow; uses returned record id)
        await uploadPhotoForRecord(/* recordId from submit response */);
      } else {
        // 6b. Open PIN modal — submission stashed for the modal callback
        setPendingSubmit({ ...submission });
        setReauthModalOpen(true);
      }
    } catch (err) {
      // surface the error in existing UI
      handleClockError(err);
      setPrompt(null);
    }
  };

  const handlePinSubmit = async (pin: string) => {
    if (!pendingSubmit || !prompt) return { ok: false, message: 'No pending clock-in' };
    try {
      const res = await submitClockIn({
        ...pendingSubmit,
        promptId: prompt.promptId,
        pin,
      });
      // Success — upload photo, close modal, set nudge flag.
      await uploadPhotoForRecord(/* recordId from res */);
      setReauthModalOpen(false);
      setShowNudge(true);  // PIN fallback used → nudge to enroll WebAuthn
      setPrompt(null);
      setPendingSubmit(null);
      return { ok: true };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'REAUTH_RATE_LIMITED') {
        return { ok: false, rateLimited: true, message: 'Too many wrong attempts. Try again tomorrow.' };
      }
      return { ok: false, message: 'Wrong PIN' };
    }
  };

  // Helper: encode a UTF-8 string to base64url (for WebAuthn challenge)
  function utf8ToBase64Url(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }
```

- [ ] **Step 5: Add the prompt display + modal + banner to the rendered JSX**

Inside the existing `ClockPage` return body, add — near the top, before the existing camera UI:

```tsx
{prompt && (
  <div className="mx-4 mt-3 p-4 rounded-2xl bg-amber-50 border-2 border-amber-200">
    <p className="text-sm text-amber-900">Show this number to the camera:</p>
    <p className="text-5xl font-extrabold text-amber-900 tracking-widest text-center my-2">
      {prompt.promptValue}
    </p>
    <p className="text-xs text-amber-800 text-center">
      Hold it on your screen, write it on paper, or signal with fingers.
    </p>
  </div>
)}

<WebAuthnNudgeBanner
  shouldShow={showNudge}
  onEnroll={() => { /* navigate to existing biometric setup screen */ }}
/>
```

And, near the end of the JSX (so it sits on top):

```tsx
<ReauthModal
  isOpen={reauthModalOpen}
  onClose={() => { setReauthModalOpen(false); setPendingSubmit(null); }}
  onSubmit={handlePinSubmit}
  fallback
/>
```

- [ ] **Step 6: Type-check**

```bash
cd packages/staff && npx tsc --noEmit
```

Resolve any type mismatches against the actual existing helpers in ClockPage. The skeleton above assumes a `captureSelfie()`, `getCurrentPosition()`, `uploadPhotoForRecord()`, `handleClockError()` pattern — adapt to the actual function names and shapes in the file.

- [ ] **Step 7: Manual browser verification**

```bash
cd packages/staff && npm run dev
```

Open the staff PWA in Chrome (or Safari on a connected iPhone via the `--host 0.0.0.0` flag). Sign in with a seeded user.

Verify:
- Tapping Clock In shows the 2-digit prompt at the top of the screen.
- Camera opens, selfie capture proceeds.
- After capture, the OS biometric prompt fires (or falls through to PIN modal on a desktop browser without a platform authenticator).
- PIN modal shake-on-fail works.
- Wrong PIN 5x in a row shows the rate-limit message.
- After a successful PIN clock-in, the nudge banner appears.

- [ ] **Step 8: Commit**

```bash
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): ClockPage prompt + re-auth flow

Inserts prompt fetch before camera, WebAuthn prompt after photo, PIN
modal fallback. Shows the issued 2-digit prompt above the viewfinder.
Surfaces the WebAuthn-enrollment nudge banner after PIN fallback."
```

---

## Task 10: Admin — surface `prompt_value` and `reauth_method` columns

**Files:**
- Modify: `packages/web/src/components/admin/AttendanceTab.tsx`

- [ ] **Step 1: Read the existing AttendanceTab**

```bash
cat packages/web/src/components/admin/AttendanceTab.tsx
```

Identify:
- The data-fetch shape (likely a hook or `useEffect` calling an `/api/admin/...` endpoint).
- Where the table columns are defined (header + row cells).
- Whether the API already returns all `clock_records` columns or whitelists fields.

- [ ] **Step 2: Update the admin records-fetch endpoint to return the new fields**

Find the admin route that returns clock-records:

```bash
grep -rn "clock_records" packages/api/src/routes/admin*
```

Likely candidates: `packages/api/src/routes/admin.ts` or `admin-attendance.ts`. Add `prompt_value` and `reauth_method` to the SELECT projection. Example:

```typescript
const records = await c.env.DB.prepare(
  `SELECT cr.id, cr.user_id, cr.type, cr.timestamp, cr.latitude, cr.longitude,
          cr.within_geofence, cr.photo_url, cr.prompt_value, cr.reauth_method,
          u.name, u.staff_id
   FROM clock_records cr
   JOIN users u ON u.id = cr.user_id
   WHERE DATE(cr.timestamp) = ?
   ORDER BY cr.timestamp DESC`
).bind(date).all();
```

- [ ] **Step 3: Add the columns to `AttendanceTab`**

In `packages/web/src/components/admin/AttendanceTab.tsx`, add two new `<th>` cells in the header:

```tsx
<th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Prompt</th>
<th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Verified by</th>
```

And the corresponding row cells:

```tsx
<td className="px-3 py-2 text-sm font-mono">{record.prompt_value ?? '—'}</td>
<td className="px-3 py-2 text-sm">
  {record.reauth_method === 'webauthn' && (
    <span className="inline-flex items-center gap-1 text-emerald-700">🔒 Biometric</span>
  )}
  {record.reauth_method === 'pin' && (
    <span className="inline-flex items-center gap-1 text-amber-700">🔢 PIN</span>
  )}
  {!record.reauth_method && <span className="text-slate-400">—</span>}
</td>
```

- [ ] **Step 4: Update the row TypeScript shape**

Find the type that describes a row (often inline or in a sibling `types.ts`) and add:

```typescript
prompt_value: string | null;
reauth_method: 'webauthn' | 'pin' | null;
```

- [ ] **Step 5: Type-check**

```bash
cd packages/web && npx tsc --noEmit
```

- [ ] **Step 6: Manual browser verification**

```bash
cd packages/web && npm run dev
```

Sign in as admin. Open the Attendance tab. Confirm:
- New "Prompt" and "Verified by" columns are visible.
- Rows from the new flow (under wrangler dev) show prompt + Biometric/PIN.
- Legacy rows show "—" in both new columns.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/admin/AttendanceTab.tsx packages/api/src/routes/admin.ts  # or whichever admin route file
git commit -m "feat(web): surface clock-in prompt + re-auth method in attendance review

Admin attendance table now shows the issued prompt value and the
verification method (biometric / PIN / —) for each clock-in record.
Backed by the new prompt_value and reauth_method columns added in
the clock-in re-auth migration."
```

---

## Task 11: Dev-only `DEV_BYPASS_REAUTH` env flag

**Files:**
- Modify: `packages/api/src/routes/clock.ts`
- Modify: `packages/api/wrangler.toml` (or equivalent — verify name)

- [ ] **Step 1: Add a guarded bypass branch**

In `clock.ts`, inside the prompt+re-auth block (Task 5), update the re-auth section to check the bypass flag at the very start:

```typescript
  // Dev/staging bypass: any non-empty webauthn_assertion is accepted.
  // Production must reject this flag at boot (asserted in main.ts on env load).
  const devBypass = c.env.DEV_BYPASS_REAUTH === 'true';

  if (webauthnAssertion && promptId) {
    if (devBypass) {
      reauthMethod = 'webauthn';
    } else {
      const outcome = await verifyClockWebAuthnAssertion(c, session.userId, promptId, webauthnAssertion);
      if (outcome.ok) {
        reauthMethod = 'webauthn';
      } else if (pin === undefined && enforce) {
        return error(c, 'REAUTH_FAILED', 'Biometric verification failed. Try your PIN.', 401);
      }
    }
  }
```

- [ ] **Step 2: Add the boot-time assertion in `packages/api/src/main.ts` (or `index.ts`)**

Find the entry file:

```bash
grep -rn "fetch(req" packages/api/src
```

Add at the top of the fetch handler (or in module init):

```typescript
if (env.ENVIRONMENT === 'production' && env.DEV_BYPASS_REAUTH === 'true') {
  throw new Error('Refusing to start: DEV_BYPASS_REAUTH must not be true in production');
}
```

- [ ] **Step 3: Add the env binding to `wrangler.toml`**

Find `wrangler.toml` (or `wrangler.jsonc`) and add `DEV_BYPASS_REAUTH = "false"` under the `[vars]` section. Document:

```toml
[vars]
# Dev/staging only — accept any webauthn_assertion at clock-in for testing.
# Production deploy MUST set this to "false" or omit. The Worker refuses to
# start with this set to "true" in production.
DEV_BYPASS_REAUTH = "false"
```

- [ ] **Step 4: Update the `Env` type in `packages/api/src/types.ts`**

```typescript
export interface Env {
  // ... existing
  DEV_BYPASS_REAUTH?: string;
}
```

- [ ] **Step 5: Type-check + commit**

```bash
cd packages/api && npx tsc --noEmit

git add packages/api/src/routes/clock.ts packages/api/src/main.ts packages/api/src/types.ts packages/api/wrangler.toml
git commit -m "feat(api): DEV_BYPASS_REAUTH env flag for dev/staging WebAuthn testing

Skips WebAuthn signature verification when DEV_BYPASS_REAUTH=true; any
non-empty webauthn_assertion is accepted. Worker refuses to start
with the flag set in production."
```

---

## Task 12: Manual QA gate before flipping enforcement

**Files:**
- None (verification-only).

- [ ] **Step 1: Deploy to staging**

```bash
# From repo root, push to main triggers GitHub Actions deploy (per memory)
git push origin main
```

Wait for the GitHub Actions workflow to finish (Worker + both Pages).

- [ ] **Step 2: Apply the migration in staging D1**

```bash
cd packages/api
npx wrangler d1 execute ohcs-smartgate --remote --file=src/db/migration-clockin-reauth.sql
```

(Or trigger via the existing migration-runner if there is one — check `migrations-index.ts` callsite.)

- [ ] **Step 3: Confirm `clockin_reauth_enforce=0` in staging**

```bash
npx wrangler d1 execute ohcs-smartgate --remote \
  --command="SELECT clockin_reauth_enforce, clockin_pin_attempt_cap, clockin_prompt_ttl_seconds FROM app_settings WHERE id=1;"
```

Expected: `0, 5, 90`.

- [ ] **Step 4: Run the manual QA checklist on real devices**

Test on at least:
- An iPhone with Face ID enrolled and a WebAuthn credential previously registered to the test user.
- An Android with fingerprint enrolled.
- A device without a platform authenticator (older Android tablet, desktop browser) — confirms PIN-fallback path.

For each device, verify:
- [ ] Tapping Clock In shows a 2-digit prompt above the camera.
- [ ] Camera opens; selfie capture proceeds.
- [ ] After capture, biometric prompt fires.
- [ ] Successful biometric → clock-in row created with `prompt_value` populated and `reauth_method='webauthn'`.
- [ ] Cancel biometric → PIN modal appears, no extra prompt fetched.
- [ ] 5 wrong PINs in a row → REAUTH_RATE_LIMITED message with countdown to tomorrow.
- [ ] On a device without a platform authenticator, PIN modal appears immediately after photo.
- [ ] Network drop between prompt fetch and submit → prompt expires; PWA fetches a new one transparently on retry.
- [ ] Admin attendance page shows the prompt value and "Biometric" / "PIN" badge for new rows.
- [ ] Old rows (pre-migration) still display correctly with "—" in the new columns.

- [ ] **Step 5: Monitor the soft-rollout legacy ratio for 3 days**

Daily query against staging then production D1:

```bash
npx wrangler d1 execute ohcs-smartgate --remote --command="
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE prompt_value IS NULL) AS legacy,
  ROUND(100.0 * COUNT(*) FILTER (WHERE prompt_value IS NULL) / NULLIF(COUNT(*), 0), 1) AS legacy_pct
FROM clock_records
WHERE timestamp > strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now','-1 day'));
"
```

Acceptance: legacy_pct < 5% over a 24h window before flipping enforcement.

---

## Task 13: Flip enforcement on

**Files:**
- None (D1 update).

- [ ] **Step 1: Final pre-flip check**

Re-run the legacy_pct query from Task 12 step 5. Confirm < 5%.

- [ ] **Step 2: Flip the flag**

```bash
npx wrangler d1 execute ohcs-smartgate --remote \
  --command="UPDATE app_settings SET clockin_reauth_enforce = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_by = 'rollout' WHERE id = 1;"
```

- [ ] **Step 3: Bust the KV cache**

```bash
# The settings cache key is 'app-settings:v2' (from Task 2)
npx wrangler kv key delete --binding=KV --remote "app-settings:v2"
```

- [ ] **Step 4: Smoke-test enforcement is on**

Sign in to the production staff PWA on a clean device profile. Attempt a clock-in by manually crafting a request without `prompt_id`:

```bash
TOKEN=...  # session token from a real session
curl -s -X POST https://api.ohcsghana.org/api/clock/ \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"clock_in","latitude":5.5527,"longitude":-0.1975,"accuracy":10}' | jq
```

Expected: `{"error":{"code":"PROMPT_REQUIRED",...}}`.

- [ ] **Step 5: Document the rollout in the project README or runbook**

Append to `docs/runbooks/clockin-reauth.md` (create if absent):

```markdown
# Clock-in re-auth runbook

- **Kill-switch:** UPDATE app_settings SET clockin_reauth_enforce = 0 WHERE id = 1; then DELETE the KV key 'app-settings:v2'. Effect: next clock-in onwards.
- **Prompt TTL:** 90s default, tunable via app_settings.clockin_prompt_ttl_seconds.
- **PIN attempt cap:** 5/day default, tunable via app_settings.clockin_pin_attempt_cap.
- **Common issues:**
  - "PROMPT_NOT_FOUND" → user took >90s between prompt fetch and submit. PWA auto-retries on next tap.
  - "REAUTH_RATE_LIMITED" → user wrong-PIN'd 5x today. Resets at midnight UTC. HR can manually delete the KV key `clock-pin-attempts:{userId}:{YYYY-MM-DD}`.
```

- [ ] **Step 6: Commit the runbook**

```bash
git add docs/runbooks/clockin-reauth.md
git commit -m "docs: clock-in re-auth runbook

Kill-switch instructions, common error codes, manual recovery steps."
```

---

## Done

At this point: all clock-ins on production require a fresh prompt + WebAuthn (or PIN), the prompt is captured in the photo, admin reviews the prompt-vs-photo alongside the verification method, and HR has a kill-switch.

Next plan in sequence: `2026-04-29-clockin-face-match.md` — gates clock-in further by matching the captured selfie against a per-staff enrolled reference photo. Recommended to wait at least 2 weeks after this plan ships so face-match threshold tuning runs against real prompt-bound photos.
