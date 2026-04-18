# Security & Operational Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 12 targeted fixes (OTP log gate, constant-time PIN, CORS allowlist, photo auth, RBAC, Telegram HTML escape, PII log gating, migration runner, auth rate limiting, push observability, parallel push fanout, notifications index) without functional regressions.

**Architecture:** Four tiny shared libs under `packages/api/src/lib/` (`html.ts`, `log.ts`, `require-role.ts`, `rate-limit.ts`) are the foundation. Each fix applies one of them, or edits `auth.ts`/`webpush.ts` directly. Two new routers (`admin-migrations.ts`, `admin-health.ts`) expose operator tooling. Two new migration files + a tracking table cover schema evolution.

**Tech Stack:** Cloudflare Workers + Hono + D1 + KV (all existing). No new deps.

---

## File Structure

**New files (9):**
- `packages/api/src/lib/html.ts` — escapeHtml helper.
- `packages/api/src/lib/log.ts` — devLog/devError gated on env.
- `packages/api/src/lib/require-role.ts` — role guard helper.
- `packages/api/src/lib/rate-limit.ts` — KV fixed-window limiter.
- `packages/api/src/db/migration-applied-migrations.sql` — tracking table.
- `packages/api/src/db/migration-notifications-index.sql` — notifications(user_id, created_at DESC).
- `packages/api/src/db/migrations-index.ts` — static list of migrations with raw SQL.
- `packages/api/src/routes/admin-migrations.ts` — runner endpoint.
- `packages/api/src/routes/admin-health.ts` — push status endpoint.

**Modified files (~10):**
- `packages/api/src/services/auth.ts`, `services/notifier.ts`, `services/reminders.ts`, `services/telegram.ts`, `services/daily-summary.ts`, `routes/auth.ts`, `routes/visitors.ts`, `routes/visits.ts`, `routes/analytics.ts`, `routes/clock.ts`, `lib/webpush.ts`, `index.ts`, `db/schema.sql`.

---

## Task 1: Create `escapeHtml` helper

**Files:** Create `packages/api/src/lib/html.ts`.

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/lib/html.ts
git commit -m "feat(api): add escapeHtml helper"
```

---

## Task 2: Create `devLog` / `devError` helpers

**Files:** Create `packages/api/src/lib/log.ts`.

- [ ] **Step 1: Write the file**

```ts
import type { Env } from '../types';

export function devLog(env: Pick<Env, 'ENVIRONMENT'>, ...args: unknown[]): void {
  if (env.ENVIRONMENT !== 'production') console.log(...args);
}

export function devError(env: Pick<Env, 'ENVIRONMENT'>, ...args: unknown[]): void {
  if (env.ENVIRONMENT !== 'production') console.error(...args);
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/lib/log.ts
git commit -m "feat(api): add devLog/devError env-gated helpers"
```

---

## Task 3: Create `requireRole` helper

**Files:** Create `packages/api/src/lib/require-role.ts`.

- [ ] **Step 1: Write the file**

```ts
import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { error } from './response';

type Role = 'superadmin' | 'admin' | 'receptionist' | 'it' | 'director' | 'staff';

export function requireRole(
  c: Context<{ Bindings: Env; Variables: { session: SessionData } }>,
  ...roles: Role[]
): Response | null {
  const session = c.get('session');
  if (!roles.includes(session.role as Role)) {
    return error(c, 'FORBIDDEN', 'You do not have access to this resource', 403);
  }
  return null;
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/lib/require-role.ts
git commit -m "feat(api): add requireRole guard helper"
```

---

## Task 4: Create `rateLimit` helper

**Files:** Create `packages/api/src/lib/rate-limit.ts`.

- [ ] **Step 1: Write the file**

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

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/lib/rate-limit.ts
git commit -m "feat(api): add KV fixed-window rate limiter"
```

---

## Task 5: Gate OTP log + constant-time PIN compare

**Files:** Modify `packages/api/src/services/auth.ts`.

- [ ] **Step 1: Add import and gate OTP log**

Replace line 16 (`console.log('[DEV OTP] ${email}: ${code}')`).

Current block (around lines 13-18):

```ts
export async function createOtp(email: string, env: Env): Promise<string> {
  const code = generateOtp();
  await env.KV.put(`otp:${email}`, JSON.stringify({ code, attempts: 0 }), { expirationTtl: OTP_TTL });
  console.log(`[DEV OTP] ${email}: ${code}`);
  return code;
}
```

Change to:

```ts
export async function createOtp(email: string, env: Env): Promise<string> {
  const code = generateOtp();
  await env.KV.put(`otp:${email}`, JSON.stringify({ code, attempts: 0 }), { expirationTtl: OTP_TTL });
  if (env.ENVIRONMENT !== 'production') {
    console.log(`[DEV OTP] ${email}: ${code}`);
  }
  return code;
}
```

- [ ] **Step 2: Replace `verifyPin` body with constant-time compare**

Current (around lines 49-52):

```ts
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const inputHash = await hashPin(pin);
  return inputHash === storedHash;
}
```

Replace with:

```ts
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const inputHash = await hashPin(pin);
  if (inputHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < inputHash.length; i++) {
    diff |= inputHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/auth.ts
git commit -m "fix(api): gate OTP log on env + constant-time PIN compare"
```

---

## Task 6: CORS exact allowlist

**Files:** Modify `packages/api/src/index.ts` (lines 27-42).

- [ ] **Step 1: Replace the CORS config**

Current:

```ts
app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:8788',
      'https://ohcs-smartgate.pages.dev',
    ];
    if (allowed.includes(origin)) return origin;
    if (origin.endsWith('.ohcs-smartgate.pages.dev')) return origin;
    if (origin === 'https://staff-attendance.pages.dev' || origin.endsWith('.staff-attendance.pages.dev')) return origin;
    return allowed[0]!;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));
```

Replace with:

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

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/index.ts
git commit -m "fix(api): CORS exact allowlist (no subdomain wildcards)"
```

---

## Task 7: Move photo endpoints behind auth middleware

**Files:** Modify `packages/api/src/index.ts`.

- [ ] **Step 1: Relocate the two photo handlers**

Currently these two endpoints sit BEFORE the `app.use('/api/*', authMiddleware)` line and are therefore public:

```ts
app.get('/api/photos/visitors/:id', async (c) => { ... });
app.get('/api/photos/clock/:id', async (c) => { ... });
```

Move both handler blocks to AFTER the `app.use('/api/*', authMiddleware);` line. Keep their implementations identical. The existing `app.route('/api/photos', photoRoutes);` sits after the middleware and already works as intended; we just need to ensure these two individually-registered GETs are protected too.

After the edit, the order in `index.ts` should be:

```ts
// Public routes
app.route('/api/auth', authRoutes);
app.route('/api/badges', badgeRoutes);
app.get('/badge/:code', serveBadgePage);
app.post('/api/telegram/webhook', telegramWebhook);

// Protected routes
app.use('/api/*', authMiddleware);
app.get('/api/photos/visitors/:id', async (c) => { ... });  // <-- moved here
app.get('/api/photos/clock/:id', async (c) => { ... });     // <-- moved here
app.route('/api/visitors', visitorRoutes);
// ... rest unchanged
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/index.ts
git commit -m "fix(api): move photo endpoints behind auth middleware"
```

---

## Task 8: Apply `requireRole` to visitors, visits, analytics

**Files:**
- Modify: `packages/api/src/routes/visitors.ts`
- Modify: `packages/api/src/routes/visits.ts`
- Modify: `packages/api/src/routes/analytics.ts`

- [ ] **Step 1: Visitors — add role check to list/search endpoints**

In `packages/api/src/routes/visitors.ts`, add near the top imports:

```ts
import { requireRole } from '../lib/require-role';
```

Inside each GET handler (list, search, get-by-id), as the FIRST line of the handler body, add:

```ts
const blocked = requireRole(c, 'superadmin', 'admin', 'receptionist', 'director');
if (blocked) return blocked;
```

Create/Update/Delete visitor endpoints stay untouched — their existing guards are OK.

- [ ] **Step 2: Visits — gate list endpoints only**

In `packages/api/src/routes/visits.ts`:

```ts
import { requireRole } from '../lib/require-role';
```

Add the `requireRole(c, 'superadmin', 'admin', 'receptionist', 'director')` guard to each GET endpoint (e.g., `GET /today`, `GET /`, `GET /:id`, `GET /search`). Do NOT add it to `POST /check-in` or `POST /:id/check-out` — those need to stay accessible to all authenticated users.

- [ ] **Step 3: Analytics — gate every endpoint to admin + director**

In `packages/api/src/routes/analytics.ts`:

```ts
import { requireRole } from '../lib/require-role';
```

At the top of EVERY handler in this file, add:

```ts
const blocked = requireRole(c, 'superadmin', 'admin', 'director');
if (blocked) return blocked;
```

- [ ] **Step 4: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/visitors.ts packages/api/src/routes/visits.ts packages/api/src/routes/analytics.ts
git commit -m "fix(api): RBAC on visitors/visits list + analytics (block staff role)"
```

---

## Task 9: Apply rate limiting to auth routes

**Files:** Modify `packages/api/src/routes/auth.ts`.

- [ ] **Step 1: Add import**

Near the other imports at the top:

```ts
import { rateLimit } from '../lib/rate-limit';
```

- [ ] **Step 2: Limit `/login` by email**

Inside the `authRoutes.post('/login', ...)` handler, as the FIRST line after `const { email } = c.req.valid('json');`:

```ts
  const rl = await rateLimit(c.env, `login:${email}`, 5, 600);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many attempts. Please try again later.', 429);
  }
```

- [ ] **Step 3: Limit `/verify` by IP**

Inside the `authRoutes.post('/verify', ...)` handler, as the FIRST line:

```ts
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rl = await rateLimit(c.env, `verify-ip:${ip}`, 10, 300);
  if (!rl.allowed) {
    c.header('Retry-After', String(rl.retryAfter));
    return error(c, 'RATE_LIMITED', 'Too many attempts. Please try again later.', 429);
  }
```

- [ ] **Step 4: Limit `/pin-login` by staff_id AND IP**

Inside the `authRoutes.post('/pin-login', ...)` handler, as the FIRST line after `const { staff_id, pin, remember } = c.req.valid('json');`:

```ts
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const rlId = await rateLimit(c.env, `pin:${staff_id.toUpperCase()}`, 10, 300);
  const rlIp = await rateLimit(c.env, `pin-ip:${ip}`, 30, 300);
  if (!rlId.allowed || !rlIp.allowed) {
    c.header('Retry-After', String(Math.max(rlId.retryAfter, rlIp.retryAfter)));
    return error(c, 'RATE_LIMITED', 'Too many attempts. Please try again later.', 429);
  }
```

- [ ] **Step 5: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/auth.ts
git commit -m "fix(api): rate-limit /auth/login, /verify, /pin-login"
```

---

## Task 10: HTML-escape Telegram content

**Files:**
- Modify: `packages/api/src/services/telegram.ts`
- Modify: `packages/api/src/services/notifier.ts`

- [ ] **Step 1: Escape in `telegram.ts`**

Add import at top:

```ts
import { escapeHtml } from '../lib/html';
```

In `formatVisitorArrivalMessage` (lines 27-52), replace every user-input interpolation with `escapeHtml(...)`:

```ts
export function formatVisitorArrivalMessage(visitor: {
  first_name: string;
  last_name: string;
  organisation: string | null;
  purpose_raw: string | null;
  badge_code: string | null;
  check_in_at: string;
  directorate_abbr: string | null;
}): string {
  const time = new Date(visitor.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  const lines = [
    '\u{1F4CB} <b>Visitor Arrival \u2014 OHCS SmartGate</b>',
    '',
    `<b>${escapeHtml(visitor.first_name)} ${escapeHtml(visitor.last_name)}</b>${visitor.organisation ? ` (${escapeHtml(visitor.organisation)})` : ''}`,
  ];

  if (visitor.purpose_raw) lines.push(`Purpose: ${escapeHtml(visitor.purpose_raw)}`);
  if (visitor.badge_code) lines.push(`Badge: <code>${escapeHtml(visitor.badge_code)}</code>`);
  lines.push('');
  lines.push(`Checked in at ${time}${visitor.directorate_abbr ? ` \u2022 ${escapeHtml(visitor.directorate_abbr)} Reception` : ''}`);

  return lines.join('\n');
}
```

- [ ] **Step 2: Escape in `notifier.ts`**

Add import at top of `packages/api/src/services/notifier.ts`:

```ts
import { escapeHtml } from '../lib/html';
```

In `formatVisitorMessage` (lines 23-54), wrap every user-supplied field. The function body interpolates `data.first_name`, `data.last_name`, `data.organisation`, `data.purpose_raw`, `data.badge_code`, `data.directorate_abbr`. Change each to `escapeHtml(data.first_name)`, etc.

Full replacement:

```ts
function formatVisitorMessage(data: VisitNotifyData, recipientType: 'host' | 'director'): string {
  const time = new Date(data.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  if (recipientType === 'host') {
    return [
      `\u{1F464} <b>You have a visitor</b>`,
      '',
      `<b>${escapeHtml(data.first_name)} ${escapeHtml(data.last_name)}</b>${data.organisation ? ` (${escapeHtml(data.organisation)})` : ''}`,
      data.purpose_raw ? `Purpose: ${escapeHtml(data.purpose_raw)}` : '',
      data.badge_code ? `Badge: <code>${escapeHtml(data.badge_code)}</code>` : '',
      '',
      `At Reception \u2022 ${time}`,
      '',
      `\u2014 OHCS SmartGate`,
    ].filter(Boolean).join('\n');
  }

  return [
    `\u{1F4CB} <b>Directorate Visitor</b>`,
    '',
    `<b>${escapeHtml(data.first_name)} ${escapeHtml(data.last_name)}</b>${data.organisation ? ` (${escapeHtml(data.organisation)})` : ''}`,
    data.purpose_raw ? `Purpose: ${escapeHtml(data.purpose_raw)}` : '',
    data.directorate_abbr ? `Directorate: ${escapeHtml(data.directorate_abbr)}` : '',
    '',
    `Checked in at ${time}`,
    '',
    `\u2014 OHCS SmartGate`,
  ].filter(Boolean).join('\n');
}
```

Also update the in-app `createInAppNotification` call that constructs the title: the current title uses `` `Visitor: ${data.first_name} ${data.last_name}` `` — in-app notifications don't use `parse_mode: 'HTML'` so escaping isn't required, but do it anyway for defence-in-depth:

Find:
```ts
  const title = `Visitor: ${data.first_name} ${data.last_name}`;
```

Change to:
```ts
  const title = `Visitor: ${escapeHtml(data.first_name)} ${escapeHtml(data.last_name)}`;
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/telegram.ts packages/api/src/services/notifier.ts
git commit -m "fix(api): HTML-escape user input in Telegram + in-app notifications"
```

---

## Task 11: PII log gating

**Files:**
- Modify: `packages/api/src/routes/clock.ts`
- Modify: `packages/api/src/services/reminders.ts`
- Modify: `packages/api/src/services/notifier.ts`

- [ ] **Step 1: `routes/clock.ts`**

Add import at top:

```ts
import { devLog } from '../lib/log';
```

Find the line:
```ts
  console.log(`[CLOCK] ${user?.name} (${user?.staff_id}) — ${type} at ${new Date().toISOString()}`);
```

Replace with:
```ts
  devLog(c.env, `[CLOCK] ${user?.name} (${user?.staff_id}) — ${type} at ${new Date().toISOString()}`);
```

- [ ] **Step 2: `services/reminders.ts`**

Add import at top:

```ts
import { devLog, devError } from '../lib/log';
```

Replace every `console.log` and `console.error` in this file. Specifically:

- `console.log('[reminders] sent clock_reminder to ${n} users')` → `devLog(env, ...)`.
- `console.log('[reminders] late_clock_alert for ${name} sent to ${n} recipients')` → `devLog(env, ...)`.
- `console.log('[reminders] monthly_report_ready sent to ${n} recipients')` → `devLog(env, ...)`.
- `console.log('[reminders] absence_notice for ${name} sent to ${n} recipients')` → `devLog(env, ...)`.
- Every `.catch((err) => console.error('[reminders] ... failed', err))` → `.catch((err) => devError(env, ...))`.

- [ ] **Step 3: `services/notifier.ts`**

Add import at top:

```ts
import { devError } from '../lib/log';
```

Replace every `console.error('[webpush] send failed', err)` with `devError(env, '[webpush] send failed', err)`. Keep `console.error` elsewhere if it logs truly unexpected infrastructure errors (non-PII) — but the `[webpush]` one contains endpoint URLs which are sensitive.

- [ ] **Step 4: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/clock.ts packages/api/src/services/reminders.ts packages/api/src/services/notifier.ts
git commit -m "fix(api): gate PII logs on non-production env"
```

---

## Task 12: Parallelise push fanout

**Files:**
- Modify: `packages/api/src/services/notifier.ts`
- Modify: `packages/api/src/services/reminders.ts`

- [ ] **Step 1: `notifier.ts` — inside `sendTypedNotification`**

Find the loop:

```ts
    for (const s of subs.results ?? []) {
      const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
      sendWebPush(target, { title: opts.title, body: opts.body, url: opts.url, type: opts.type }, env).catch((err) => {
        devError(env, '[webpush] send failed', err);
      });
    }
```

Replace with:

```ts
    await Promise.all(
      (subs.results ?? []).map((s) => {
        const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
        return sendWebPush(target, { title: opts.title, body: opts.body, url: opts.url, type: opts.type }, env).catch((err) => {
          devError(env, '[webpush] send failed', err);
        });
      }),
    );
```

- [ ] **Step 2: `reminders.ts` — convert every `for (const r of recipients...) { await sendTypedNotification(...)` to `Promise.all`**

For `sendClockReminders`, `sendLateClockAlert`, `sendMonthlyReportReady`, `sendAbsenceNoticePush` — each has a `for (const r of recipients.results ?? []) { await sendTypedNotification(env, {...}).catch(...) }` pattern.

Replace each loop with:

```ts
await Promise.all(
  (recipients.results ?? []).map((r) =>
    sendTypedNotification(env, { /* same opts */ })
      .catch((err) => devError(env, '[reminders] <type> failed', err)),
  ),
);
```

Preserve the original opts per loop — only the iteration mechanism changes.

For `sendClockReminders`, the loop variable is `u` with `u.name`; for the others it's `r` with just `r.id`. Copy the existing body structure verbatim — only swap `for (...of...)` for `Promise.all((...).map((...) => ...))`.

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/notifier.ts packages/api/src/services/reminders.ts
git commit -m "perf(api): parallelise push fanout with Promise.all"
```

---

## Task 13: Notifications index + schema mirror

**Files:**
- Create: `packages/api/src/db/migration-notifications-index.sql`
- Modify: `packages/api/src/db/schema.sql` (if `notifications` table present; otherwise skip)

- [ ] **Step 1: Create the migration**

```sql
CREATE INDEX IF NOT EXISTS idx_notifications_user_date ON notifications(user_id, created_at DESC);
```

- [ ] **Step 2: Apply locally**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-notifications-index.sql
```

Expected: `1 command executed successfully.`

- [ ] **Step 3: Mirror in `schema.sql`**

First grep for `CREATE TABLE.*notifications` across `packages/api/src/db/*.sql`. Whichever file defines the `notifications` CREATE TABLE, append the CREATE INDEX immediately after that table definition (or, if the table is only defined in a migration file and not in `schema.sql`, skip the schema.sql mirror and note it).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migration-notifications-index.sql packages/api/src/db/schema.sql
git commit -m "feat(db): add idx_notifications_user_date"
```

---

## Task 14: Applied-migrations table + index module

**Files:**
- Create: `packages/api/src/db/migration-applied-migrations.sql`
- Create: `packages/api/src/db/migrations-index.ts`
- Modify: `packages/api/src/db/schema.sql` (append table)

- [ ] **Step 1: Create `migration-applied-migrations.sql`**

```sql
CREATE TABLE IF NOT EXISTS applied_migrations (
  filename   TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

Apply locally:

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-applied-migrations.sql
```

- [ ] **Step 2: Create `migrations-index.ts`**

Create `packages/api/src/db/migrations-index.ts`:

```ts
import appliedMigrations from './migration-applied-migrations.sql?raw';
import attendance from './migration-attendance.sql?raw';
import grade from './migration-grade.sql?raw';
import hostManual from './migration-host-manual.sql?raw';
import phase2 from './migration-phase2.sql?raw';
import photos from './migration-photos.sql?raw';
import pinAuth from './migration-pin-auth.sql?raw';
import pinAcknowledged from './migration-pin-acknowledged.sql?raw';
import pushSubscriptions from './migration-push-subscriptions.sql?raw';
import clockIdempotency from './migration-clock-idempotency.sql?raw';
import visitsIdempotency from './migration-visits-idempotency.sql?raw';
import absenceNotices from './migration-absence-notices.sql?raw';
import notificationsIndex from './migration-notifications-index.sql?raw';

export const MIGRATIONS: Array<{ filename: string; sql: string }> = [
  { filename: 'migration-applied-migrations.sql', sql: appliedMigrations },
  { filename: 'migration-attendance.sql', sql: attendance },
  { filename: 'migration-grade.sql', sql: grade },
  { filename: 'migration-host-manual.sql', sql: hostManual },
  { filename: 'migration-phase2.sql', sql: phase2 },
  { filename: 'migration-photos.sql', sql: photos },
  { filename: 'migration-pin-auth.sql', sql: pinAuth },
  { filename: 'migration-pin-acknowledged.sql', sql: pinAcknowledged },
  { filename: 'migration-push-subscriptions.sql', sql: pushSubscriptions },
  { filename: 'migration-clock-idempotency.sql', sql: clockIdempotency },
  { filename: 'migration-visits-idempotency.sql', sql: visitsIdempotency },
  { filename: 'migration-absence-notices.sql', sql: absenceNotices },
  { filename: 'migration-notifications-index.sql', sql: notificationsIndex },
];

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 3: Mirror `applied_migrations` table in `schema.sql`**

Append this block to the end of `packages/api/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS applied_migrations (
    filename   TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

- [ ] **Step 4: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/db/migration-applied-migrations.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(db): add applied_migrations table + migrations-index module"
```

---

## Task 15: Migration runner endpoint

**Files:**
- Create: `packages/api/src/routes/admin-migrations.ts`
- Modify: `packages/api/src/index.ts` (mount router)

- [ ] **Step 1: Write the router**

```ts
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { requireRole } from '../lib/require-role';
import { MIGRATIONS, sha256Hex } from '../db/migrations-index';

export const adminMigrationsRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

adminMigrationsRoutes.post('/run', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const applied: string[] = [];
  const skipped: string[] = [];
  const failures: Array<{ filename: string; errorMessage: string }> = [];

  for (const m of MIGRATIONS) {
    const existing = await c.env.DB.prepare(
      'SELECT filename FROM applied_migrations WHERE filename = ?'
    ).bind(m.filename).first<{ filename: string }>();

    if (existing) {
      skipped.push(m.filename);
      continue;
    }

    const statements = m.sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    try {
      for (const stmt of statements) {
        await c.env.DB.prepare(stmt).run();
      }
      const hash = await sha256Hex(m.sql);
      await c.env.DB.prepare(
        'INSERT INTO applied_migrations (filename, hash) VALUES (?, ?)'
      ).bind(m.filename, hash).run();
      applied.push(m.filename);
    } catch (err) {
      failures.push({ filename: m.filename, errorMessage: err instanceof Error ? err.message : String(err) });
      break; // stop on first failure — don't cascade
    }
  }

  return success(c, { applied, skipped, failures });
});
```

- [ ] **Step 2: Mount in `index.ts`**

Add import near the other route imports:

```ts
import { adminMigrationsRoutes } from './routes/admin-migrations';
```

In the protected-routes section, add:

```ts
app.route('/api/admin/migrations', adminMigrationsRoutes);
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/admin-migrations.ts packages/api/src/index.ts
git commit -m "feat(api): add POST /api/admin/migrations/run (superadmin)"
```

---

## Task 16: Push observability — counter writes

**Files:** Modify `packages/api/src/lib/webpush.ts`.

- [ ] **Step 1: Add counter helper + instrument `sendWebPush`**

At the top of `packages/api/src/lib/webpush.ts`, after the existing imports, add:

```ts
async function trackPushStatus(env: { KV: KVNamespace }, status: number): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const key = `push-stat:${date}:${status}`;
  try {
    const raw = await env.KV.get(key);
    const n = raw ? parseInt(raw, 10) : 0;
    await env.KV.put(key, String(n + 1), { expirationTtl: 8 * 86400 });
  } catch {
    // Swallow — counters are best-effort, must not break push flow.
  }
}
```

Then update `sendWebPush` — the existing function ends by returning `res.status`. Extend the `WebPushEnv` interface:

Find:
```ts
export interface WebPushEnv {
  VAPID_PUBLIC_X: string;
  VAPID_PUBLIC_Y: string;
  VAPID_PRIVATE_D: string;
  VAPID_SUBJECT: string;
}
```

Change to:
```ts
export interface WebPushEnv {
  VAPID_PUBLIC_X: string;
  VAPID_PUBLIC_Y: string;
  VAPID_PRIVATE_D: string;
  VAPID_SUBJECT: string;
  KV: KVNamespace;
}
```

Inside `sendWebPush`, after the `const res = await fetch(...)` line and BEFORE `return res.status`, insert:

```ts
  await trackPushStatus(env, res.status);
```

Also update the early-return "VAPID keys not set" path (currently `return 0`) to first call `trackPushStatus(env, 0)`:

```ts
  if (!env.VAPID_PUBLIC_X || !env.VAPID_PRIVATE_D) {
    console.warn('[webpush] VAPID keys not set; skipping');
    await trackPushStatus(env, 0);
    return 0;
  }
```

Since `Env` (in `types.ts`) already includes `KV: KVNamespace`, this signature change is satisfied by existing callers passing `c.env`.

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/lib/webpush.ts
git commit -m "feat(api): track push status counts in KV for observability"
```

---

## Task 17: Push health endpoint

**Files:**
- Create: `packages/api/src/routes/admin-health.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Write the router**

```ts
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';

export const adminHealthRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const TRACKED_STATUSES = [0, 200, 201, 202, 400, 401, 403, 404, 410, 429, 500, 502, 503];

adminHealthRoutes.get('/push', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const today = new Date();
  const days: Array<{ date: string; statuses: Record<string, number> }> = [];

  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(today.getTime() - offset * 86400000);
    const date = d.toISOString().slice(0, 10);
    const statuses: Record<string, number> = {};
    await Promise.all(
      TRACKED_STATUSES.map(async (s) => {
        const raw = await c.env.KV.get(`push-stat:${date}:${s}`);
        if (raw) statuses[String(s)] = parseInt(raw, 10);
      }),
    );
    days.push({ date, statuses });
  }

  return success(c, { days });
});
```

- [ ] **Step 2: Mount in `index.ts`**

Add import:

```ts
import { adminHealthRoutes } from './routes/admin-health';
```

Mount:

```ts
app.route('/api/admin/health', adminHealthRoutes);
```

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/admin-health.ts packages/api/src/index.ts
git commit -m "feat(api): add GET /api/admin/health/push (superadmin)"
```

---

## Task 18: Deploy + backfill + verify

**Files:** none modified — operational work.

- [ ] **Step 1: Final type-check**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
```

Expected: clean.

- [ ] **Step 2: Apply remote migrations in the right order**

From `packages/api`:

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-applied-migrations.sql
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-notifications-index.sql
```

Both should report success. (The new index is idempotent; applied_migrations table is idempotent.)

- [ ] **Step 3: Backfill `applied_migrations` for all pre-existing migrations**

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --command="INSERT OR IGNORE INTO applied_migrations (filename, hash) VALUES ('migration-applied-migrations.sql','backfill'),('migration-attendance.sql','backfill'),('migration-grade.sql','backfill'),('migration-host-manual.sql','backfill'),('migration-phase2.sql','backfill'),('migration-photos.sql','backfill'),('migration-pin-auth.sql','backfill'),('migration-pin-acknowledged.sql','backfill'),('migration-push-subscriptions.sql','backfill'),('migration-clock-idempotency.sql','backfill'),('migration-visits-idempotency.sql','backfill'),('migration-absence-notices.sql','backfill'),('migration-notifications-index.sql','backfill')"
```

- [ ] **Step 4: Deploy API Worker**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js deploy
```

- [ ] **Step 5: Push commits to GitHub**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
git push origin main
```

- [ ] **Step 6: Smoke-test each fix**

Log in as `1334685` to get a session cookie, save as `<SID>`. Then run:

**Fix 5 RBAC (staff blocked):** (Would require a `role=staff` session — create one first via the admin panel or skip.) Any `role=staff` cookie hitting `GET /api/visitors` should return 403.

**Fix 4 photo auth:**
```bash
curl -i https://ohcs-smartgate-api.ghwmelite.workers.dev/api/photos/clock/test-nonexistent-id
```
Expected: `401 Unauthorized` (not 404). With valid session: 404.

**Fix 9 rate limit:**
```bash
for i in {1..11}; do curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ohcs-smartgate-api.ghwmelite.workers.dev/api/auth/pin-login -H "Content-Type: application/json" -d '{"staff_id":"NONEXISTENT","pin":"0000"}'; done
```
Expected: ~10 × `401`, then `429`. Clean up by waiting 5 min or clearing KV.

**Fix 8 migration runner:**
```bash
curl -i -X POST https://ohcs-smartgate-api.ghwmelite.workers.dev/api/admin/migrations/run -H "Cookie: session_id=<SID>"
```
Expected: `200 OK` with `{"applied":[],"skipped":[...all 13 migration filenames...]}` since everything is backfilled.

**Fix 10 push health:**
```bash
curl -i https://ohcs-smartgate-api.ghwmelite.workers.dev/api/admin/health/push -H "Cookie: session_id=<SID>"
```
Expected: `200 OK` with `{"days":[...]}` (empty `statuses` objects early on; populate as pushes fire).

**Fix 3 CORS:**
```bash
curl -i -X OPTIONS https://ohcs-smartgate-api.ghwmelite.workers.dev/api/clock -H "Origin: https://evil.example.com" -H "Access-Control-Request-Method: POST"
```
Expected: response has no `Access-Control-Allow-Origin` header (rejected).

Confirm all pass, then:

```bash
# Smoke passed — done.
echo "All 12 fixes verified."
```

---

## Self-Review Notes

**Spec coverage:**
- Fix 1 OTP log → Task 5 Step 1.
- Fix 2 PIN constant-time → Task 5 Step 2.
- Fix 3 CORS → Task 6.
- Fix 4 photo auth → Task 7.
- Fix 5 RBAC → Task 3 (helper) + Task 8 (apply).
- Fix 6 Telegram escape → Task 1 (helper) + Task 10 (apply).
- Fix 7 PII logs → Task 2 (helper) + Task 11 (apply).
- Fix 8 migration runner → Tasks 14 + 15 + backfill in Task 18.
- Fix 9 rate limit → Task 4 (helper) + Task 9 (apply).
- Fix 10 push observability → Task 16 (counters) + Task 17 (endpoint).
- Fix 11 parallel push → Task 12.
- Fix 12 notifications index → Task 13.
- Deploy + verify → Task 18.

**Type consistency:**
- `rateLimit` returns `{ allowed: boolean; retryAfter: number }` — same used in Task 9.
- `requireRole` returns `Response | null` — same used in Tasks 8, 15, 17.
- `devLog`/`devError` take `Pick<Env, 'ENVIRONMENT'>` first arg — called with `env` or `c.env` consistently.
- `escapeHtml` takes `string | null | undefined` — called with fields that may be null.
- `MIGRATIONS` array shape matches in `migrations-index.ts` and `admin-migrations.ts` consumer.
- `trackPushStatus` takes `{ KV: KVNamespace }` — existing `Env` satisfies.

**Known risks:**
- Vite's `?raw` import suffix is used in Task 14 to inline SQL files as strings. Confirm Vite config supports this for a Workers build (it should — Wrangler/Vite standard). If not, fall back to hand-copying SQL into string literals.
- `split(/;\s*\n/)` in the migration runner is naive — SQL with semicolons inside string literals would break. None of our current migrations have such literals, so safe; document if adding any.
- The `applied_migrations` CREATE TABLE is itself the first entry in `MIGRATIONS` — it'll be skipped on first real `/run` call (already-backfilled), so no chicken-and-egg.
- `trackPushStatus` reading + writing KV is racy (concurrent pushes can lose increments). Acceptable for observability; counts are approximate.
- Rate limiter's KV TTL is per-write, so semantics are fixed-window, not sliding. Documented in spec. If abuse continues, revisit with Durable Objects.
