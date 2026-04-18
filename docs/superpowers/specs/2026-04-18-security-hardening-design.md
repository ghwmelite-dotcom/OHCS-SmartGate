# Security & Operational Hardening — Design

**Date:** 2026-04-18
**Scope:** `packages/api` only (one small touch in neither frontend). Closes 12 findings from the 2026-04-18 analysis report: 5 critical, 7 high/medium. Defers testing, bundle splits, component decomposition, and shared-workspace refactor — each is its own project.

## Goals

1. Close every auditor-identified critical security issue (OTP log, PIN timing, CORS, clock-photo auth, migration tracking).
2. Harden operational surfaces (rate limiting on auth, push observability, PII log gating).
3. Land small performance wins (parallel push fanout, notifications index).
4. Zero functional regressions for legitimate end-users.

## Non-goals

- No new features.
- No architectural restructuring.
- No new dependencies beyond what's already in `packages/api/package.json`.
- No breaking changes to existing API response shapes.

---

## Fix 1 — Gate OTP log on environment

**File:** `packages/api/src/services/auth.ts:16`

Current:
```ts
console.log(`[DEV OTP] ${email}: ${code}`);
```

Replace with:
```ts
if (env.ENVIRONMENT !== 'production') {
  console.log(`[DEV OTP] ${email}: ${code}`);
}
```

## Fix 2 — Constant-time PIN compare

**File:** `packages/api/src/services/auth.ts` (`verifyPin` at line 49)

Current uses `inputHash === storedHash`. Hex-string comparison short-circuits on mismatch — exposes a measurable timing side-channel.

New implementation inside `verifyPin`:
```ts
if (inputHash.length !== storedHash.length) return false;
let diff = 0;
for (let i = 0; i < inputHash.length; i++) {
  diff |= inputHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
}
return diff === 0;
```

Length branch is acceptable — both operands are fixed SHA-256 hex (always 64 chars); a mismatch indicates corruption, not input leakage.

## Fix 3 — CORS exact allowlist

**File:** `packages/api/src/index.ts:27-42`

Replace the suffix-matching `origin` callback with an explicit set:
```ts
const ALLOWED_ORIGINS = new Set([
  'https://staff-attendance.pages.dev',
  'https://ohcs-smartgate.pages.dev',
  'http://localhost:5173',
  'http://localhost:8788',
]);

app.use('*', cors({
  origin: (origin) => (ALLOWED_ORIGINS.has(origin) ? origin : null),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));
```

Preview deploys (`https://<hash>.ohcs-smartgate.pages.dev`) will CORS-reject. Acceptable — operator can add specific hashes to the set when previewing.

## Fix 4 — Authenticate photo endpoints

**File:** `packages/api/src/index.ts`

The two public photo handlers (`/api/photos/visitors/:id` at ~line 53 and `/api/photos/clock/:id` at ~line 62) currently sit BEFORE `app.use('/api/*', authMiddleware)`, so they bypass authentication. Move both blocks AFTER the auth middleware registration. Anyone with a valid session can still fetch photos (required for success screens + admin panels); only unauthenticated access is blocked.

## Fix 5 — RBAC on visitor / analytics routes

**Files:**
- `packages/api/src/routes/visitors.ts` — list/search endpoints
- `packages/api/src/routes/visits.ts` — list endpoints (NOT check-in/check-out, which need receptionist access)
- `packages/api/src/routes/analytics.ts` — all endpoints
- New: `packages/api/src/lib/require-role.ts` — single helper.

New helper:
```ts
import type { Context } from 'hono';
import type { SessionData } from '../types';
import { error } from './response';

type Role = 'superadmin' | 'admin' | 'receptionist' | 'it' | 'director' | 'staff';

export function requireRole(c: Context<{ Variables: { session: SessionData } }>, ...roles: Role[]): Response | null {
  const session = c.get('session');
  if (!roles.includes(session.role as Role)) {
    return error(c, 'FORBIDDEN', 'You do not have access to this resource', 403);
  }
  return null;
}
```

Usage pattern inside each guarded route:
```ts
visitorRoutes.get('/', async (c) => {
  const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director');
  if (blocked) return blocked;
  // ... existing logic
});
```

**Role matrix for this fix:**

| Route | Allowed roles |
|---|---|
| `GET /visitors` (list + search) | superadmin, admin, receptionist, director |
| `GET /visits` (list, today, by-id) | superadmin, admin, receptionist, director |
| `POST /visits/check-in` | unchanged (any authenticated user; receptionist usually) |
| `POST /visits/:id/check-out` | unchanged |
| `GET /analytics/*` | superadmin, admin, director |
| `GET /officers` | unchanged (public-ish org info, all authenticated users) |
| `GET /directorates` | unchanged (public-ish org info) |
| `GET /clock/*` | unchanged (user-scoped; existing guards are correct) |
| `GET /notifications/*` | unchanged (user-scoped; existing guards are correct) |

## Fix 6 — HTML-escape Telegram content

**Files:**
- New: `packages/api/src/lib/html.ts` — `escapeHtml(str)`.
- Modify: `packages/api/src/services/telegram.ts`, `packages/api/src/services/notifier.ts`, `packages/api/src/services/daily-summary.ts` — wrap every `${userInput}` that lands in a `parse_mode: 'HTML'` Telegram payload.

`escapeHtml` implementation:
```ts
const ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ENTITY_MAP[c] ?? c);
}
```

Every `first_name`, `last_name`, `organisation`, `purpose_raw`, `directorate_abbr`, `user.name`, `staff_id` that currently appears raw inside a Telegram message template gets wrapped.

## Fix 7 — PII log gating

**Files:**
- New: `packages/api/src/lib/log.ts` — `devLog` and `devError` helpers.
- Modify: anywhere in `packages/api/src/` that `console.log`s or `console.error`s data containing names, emails, staff IDs, OTPs, endpoints, or session IDs.

Helper:
```ts
import type { Env } from '../types';

export function devLog(env: Pick<Env, 'ENVIRONMENT'>, ...args: unknown[]): void {
  if (env.ENVIRONMENT !== 'production') console.log(...args);
}

export function devError(env: Pick<Env, 'ENVIRONMENT'>, ...args: unknown[]): void {
  if (env.ENVIRONMENT !== 'production') console.error(...args);
}
```

Audit targets (will be walked during implementation):
- `routes/clock.ts` — the `[CLOCK] <name> (<staff_id>) — <type>` log.
- `services/reminders.ts` — 3 existing `[reminders] …` logs that include names.
- `services/auth.ts` — the dev OTP log (covered separately by Fix 1, but gate any others too).
- `services/daily-summary.ts` — the `[SUMMARY] … sent` log (no PII; leave).
- `services/notifier.ts` — `[webpush]` errors (keep; those go through `devError` with anonymised endpoint).

Truly critical errors (unhandled exceptions, crypto failures) can still use `console.error` directly so they surface in Cloudflare logs regardless of env. Rule of thumb: if it includes user data, use `devLog`/`devError`; if it's a bare error stack from an infrastructure failure, keep `console.error`.

## Fix 8 — Migration runner

**Files:**
- New: `packages/api/src/db/migration-applied-migrations.sql` — create the tracking table.
- New: `packages/api/src/db/migrations-index.ts` — static list of all migration filenames + their raw SQL strings (imported via Vite's `?raw` mechanism).
- New: `packages/api/src/routes/admin-migrations.ts` — exposes the runner.
- Modify: `packages/api/src/index.ts` — mount the new router under `/api/admin`.

Tracking table:
```sql
CREATE TABLE IF NOT EXISTS applied_migrations (
  filename   TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

`migrations-index.ts` shape:
```ts
import absenceNotices from './migration-absence-notices.sql?raw';
import clockIdempotency from './migration-clock-idempotency.sql?raw';
// ... one import per migration file, alphabetical
import appliedMigrations from './migration-applied-migrations.sql?raw';

export const MIGRATIONS: Array<{ filename: string; sql: string }> = [
  { filename: 'migration-applied-migrations.sql', sql: appliedMigrations },
  { filename: 'migration-absence-notices.sql', sql: absenceNotices },
  // ...
];
```

Hashing: SHA-256 of the SQL string, hex-encoded.

Runner endpoint:
- `POST /api/admin/migrations/run` — superadmin only.
- Behaviour: for each entry in `MIGRATIONS`, check the `applied_migrations` table. If not present, execute the SQL (split on `;\n` naively, tolerate multi-statement files via `DB.exec()` if available — otherwise call `DB.prepare(eachStatement).run()` in sequence), then INSERT a row. Returns `{ applied: string[], skipped: string[] }`.

**Backfill for production (one-time, operator-run):**
After the code lands and the `applied_migrations` table itself exists, run a one-time SQL against the remote DB:
```sql
INSERT INTO applied_migrations (filename, hash)
VALUES
  ('migration-attendance.sql', 'backfill'),
  ('migration-grade.sql', 'backfill'),
  ('migration-host-manual.sql', 'backfill'),
  ('migration-phase2.sql', 'backfill'),
  ('migration-photos.sql', 'backfill'),
  ('migration-pin-auth.sql', 'backfill'),
  ('migration-pin-acknowledged.sql', 'backfill'),
  ('migration-push-subscriptions.sql', 'backfill'),
  ('migration-clock-idempotency.sql', 'backfill'),
  ('migration-visits-idempotency.sql', 'backfill'),
  ('migration-absence-notices.sql', 'backfill');
```

Hash values are literally the string `'backfill'` — the runner doesn't re-verify hashes on subsequent runs, only checks presence. Future migrations added to the index will record real hashes.

## Fix 9 — Auth rate limiting

**Files:**
- New: `packages/api/src/lib/rate-limit.ts`.
- Modify: `packages/api/src/routes/auth.ts` — wrap the three rate-limited endpoints.

Helper:
```ts
import type { Env } from '../types';

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const bucketKey = `rl:${key}`;
  const raw = await env.KV.get(bucketKey);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) {
    return { allowed: false, retryAfter: windowSeconds };
  }
  await env.KV.put(bucketKey, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, retryAfter: 0 };
}
```

Note: KV's TTL is per-write; the first write in a window sets it. Subsequent writes within the window extend the TTL. Acceptable trade-off for a simple fixed-window limiter — users who pause near the end of a window start a new count from 1, not the preferred sliding semantics, but OK for abuse prevention.

**Applied limits:**

| Endpoint | Key | Limit | Window |
|---|---|---|---|
| `POST /auth/login` | `login:<email>` | 5 | 10 min (600s) |
| `POST /auth/verify` | `verify-ip:<ip>` | 10 | 5 min (300s) |
| `POST /auth/pin-login` | `pin:<staff_id>` AND `pin-ip:<ip>` | 10 / 30 | 5 min (300s) |

When blocked, return `429 TOO_MANY_REQUESTS` with body:
```json
{ "data": null, "error": { "code": "RATE_LIMITED", "message": "Too many attempts. Please try again later." } }
```
and header `Retry-After: <seconds>`.

IP source: `c.req.header('cf-connecting-ip') ?? 'unknown'`. If `unknown`, the limit still applies (bucket key `pin-ip:unknown` catches all such requests collectively — good enough).

## Fix 10 — Push observability

**Files:**
- Modify: `packages/api/src/lib/webpush.ts` — increment a KV counter after every send.
- New: `packages/api/src/routes/admin-health.ts` — exposes the dashboard JSON.
- Modify: `packages/api/src/index.ts` — mount the new router.

Counter writes: after the `fetch` call in `sendWebPush`, await a `trackPushStatus(env, status)` that:
```ts
const date = new Date().toISOString().slice(0, 10);
const key = `push-stat:${date}:${status}`;
const raw = await env.KV.get(key);
const n = raw ? parseInt(raw, 10) : 0;
await env.KV.put(key, String(n + 1), { expirationTtl: 8 * 86400 });
```

Endpoint:
- `GET /api/admin/health/push` — superadmin only.
- Reads the last 7 days × (201, 202, 400, 403, 404, 410, 500) keys.
- Returns `{ days: [{ date, statuses: Record<string, number> }, ...] }`.
- No UI in this spec — just JSON for quick curl checks.

## Fix 11 — Parallelise push fanout

**Files:**
- Modify: `packages/api/src/services/notifier.ts` — `sendTypedNotification` inner loop.
- Modify: `packages/api/src/services/reminders.ts` — `sendLateClockAlert`, `sendClockReminders`, `sendMonthlyReportReady`, `sendAbsenceNoticePush` inner loops.

Pattern for every affected site:
```ts
await Promise.all(
  (subs.results ?? []).map((s) => {
    const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
    return sendWebPush(target, payload, env).catch((err) => {
      devError(env, '[webpush] send failed', err);
    });
  }),
);
```

Preserves existing catch behaviour — one subscription's failure doesn't cancel the siblings.

## Fix 12 — Notifications index

**Files:**
- New: `packages/api/src/db/migration-notifications-index.sql`.
- Modify: `packages/api/src/db/schema.sql` — mirror the index.
- Modify: `packages/api/src/db/migrations-index.ts` — add entry.

**First check during implementation:** read the existing `notifications` table definition (likely in `migration-phase2.sql` or `migration-attendance.sql`) to confirm column names. This spec assumes `user_id TEXT` and `created_at TEXT`.

Migration:
```sql
CREATE INDEX IF NOT EXISTS idx_notifications_user_date ON notifications(user_id, created_at DESC);
```

---

## Shared Infrastructure

Three new small files act as the foundation for multiple fixes:

- `packages/api/src/lib/html.ts` — `escapeHtml` (Fix 6).
- `packages/api/src/lib/log.ts` — `devLog`, `devError` (Fix 7).
- `packages/api/src/lib/require-role.ts` — `requireRole` (Fix 5).
- `packages/api/src/lib/rate-limit.ts` — `rateLimit` (Fix 9).

Each is ≤30 lines and has one clear responsibility.

## Deployment Order

1. Code changes land on `main`, build + deploy API Worker.
2. **Before** anyone hits rate-limited endpoints in anger, run the backfill SQL from Fix 8 against remote D1 (pre-populate `applied_migrations`).
3. Run `POST /api/admin/migrations/run` as superadmin — should return `applied: []` (everything already backfilled) plus successfully create `idx_notifications_user_date` via the new Fix 12 migration.
4. Smoke-test: log in, clock in (verify no regression), check `/api/admin/health/push` returns sensible JSON.

## Rollback strategy

Each fix is independently revertible via a targeted git revert. Only Fix 8 (migration runner + table) has persistent state in D1 — the table itself is additive, so reverting the code leaves a harmless `applied_migrations` table in place; safe.

## Files Touched (summary)

**New:**
- `packages/api/src/lib/html.ts`
- `packages/api/src/lib/log.ts`
- `packages/api/src/lib/require-role.ts`
- `packages/api/src/lib/rate-limit.ts`
- `packages/api/src/db/migration-applied-migrations.sql`
- `packages/api/src/db/migration-notifications-index.sql`
- `packages/api/src/db/migrations-index.ts`
- `packages/api/src/routes/admin-migrations.ts`
- `packages/api/src/routes/admin-health.ts`

**Modified:**
- `packages/api/src/services/auth.ts` (Fixes 1, 2)
- `packages/api/src/services/telegram.ts` (Fix 6)
- `packages/api/src/services/notifier.ts` (Fixes 6, 7, 11)
- `packages/api/src/services/reminders.ts` (Fixes 7, 11)
- `packages/api/src/services/daily-summary.ts` (Fix 6, where user input hits Telegram)
- `packages/api/src/routes/auth.ts` (Fix 9)
- `packages/api/src/routes/visitors.ts` (Fix 5)
- `packages/api/src/routes/visits.ts` (Fix 5)
- `packages/api/src/routes/analytics.ts` (Fix 5)
- `packages/api/src/routes/clock.ts` (Fix 7 — the `[CLOCK]` log)
- `packages/api/src/index.ts` (Fixes 3, 4, 8, 10)
- `packages/api/src/lib/webpush.ts` (Fix 10)
- `packages/api/src/db/schema.sql` (Fix 12 — mirror index)

## Acceptance Criteria

1. Log scrubbing: `grep -n 'console.log' packages/api/src` shows only non-PII messages in production path (everything else is wrapped in `devLog`).
2. CORS: requests from a fabricated `evil.staff-attendance.pages.dev` get no CORS headers (origin not in allowlist).
3. OTP: `curl /api/auth/login` in production doesn't leak the code in logs. Dev/staging still does.
4. PIN: `verifyPin` has no short-circuit on mismatch; timing attack surface is closed.
5. Rate limiting: 11th rapid `/auth/pin-login` attempt for the same `staff_id` within 5 min returns 429 with `Retry-After`.
6. Photos: `GET /api/photos/clock/<known-id>` without session cookie returns 401.
7. RBAC: `staff`-role session GETting `/api/visitors` returns 403.
8. Push: `GET /api/admin/health/push` returns today's counters for any request that fired after deploy.
9. Migrations: `POST /api/admin/migrations/run` after backfill returns `{applied: ['migration-applied-migrations.sql', 'migration-notifications-index.sql'], skipped: [...prior migrations...] }`.
10. Parallel fanout: a visitor-arrival event for a user with 5 subscriptions completes push sends in ~200ms (was ~1s).
11. Telegram: crafting a visitor with name `<b>test</b>` and checking them in, the resulting Telegram message shows the literal text, not bold.
12. No response-shape regressions: existing `apiOrQueue`/`api.post` consumers on staff + web behave identically for happy paths.

## Out of Scope

- Vitest / automated tests for the new helpers.
- Updating any frontend to surface 429 errors more gracefully (toast etc.). Existing error handling shows the message.
- Bundle size, file decomposition, shared workspace — deferred.
- CSRF tokens (mitigated for now by CORS tightening + SameSite cookies).
- At-rest encryption of push subscription endpoints (low risk given the subscription URL is a bearer-less HTTP endpoint; attacker gaining DB access has worse problems).
- Exponential backoff / account lockout on OTP attempts (already has 5-attempt counter; rate limiting adds IP-level defence).

## Open Questions

None.
