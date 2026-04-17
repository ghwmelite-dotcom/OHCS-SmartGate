# Push Triggers Wire-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up three push notification types (`clock_reminder`, `late_clock_alert`, `monthly_report_ready`) that exist in the `PUSH_WHITELIST` but have no emit path.

**Architecture:** Extract `sendTypedNotification` helper from the existing `createInAppNotification` so non-visitor notifications reuse the same in-app + push fork. Add a new `services/reminders.ts` module with three functions. Wire `sendLateClockAlert` into `POST /clock`. Add a new 08:30 Mon–Fri cron and route scheduled invocations to the right handler via a `switch (event.cron)` dispatcher.

**Tech Stack:** Cloudflare Workers + Hono + D1 (SQLite). No test runner — verification via `type-check`, `wrangler dev --test-scheduled`, and `curl`.

---

## File Structure

**New files:**
- `packages/api/src/services/reminders.ts` — `sendClockReminders`, `sendLateClockAlert`, `sendMonthlyReportReady`.

**Modified files:**
- `packages/api/src/services/notifier.ts` — export `sendTypedNotification`; refactor `createInAppNotification` to use it.
- `packages/api/src/routes/clock.ts` — fire `sendLateClockAlert` via `executionCtx.waitUntil` when a `clock_in` lands after 08:30.
- `packages/api/src/index.ts` — replace the blanket `sendDailySummaryFn(env)` call in `scheduled()` with a `switch (event.cron)` dispatcher.
- `packages/api/wrangler.toml` — append `"30 8 * * 1-5"` to `triggers.crons`.

---

## Task 1: Extract `sendTypedNotification` helper

**Files:**
- Modify: `packages/api/src/services/notifier.ts`

- [ ] **Step 1: Read the current `createInAppNotification` to confirm line ranges**

Run: `Read packages/api/src/services/notifier.ts` (look at lines 164–198).

Current shape (from the most recent T20 commit):

```ts
async function createInAppNotification(
  userId: string,
  data: VisitNotifyData,
  env: Env,
  customBody?: string
): Promise<void> {
  const notifId = crypto.randomUUID().replace(/-/g, '');
  const type = 'visitor_arrival';
  const title = `Visitor: ${data.first_name} ${data.last_name}`;
  const body = customBody ?? `${data.organisation ? `From ${data.organisation} \u2014 ` : ''}${data.purpose_raw || 'No purpose stated'}`;

  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, visit_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(notifId, userId, type, title, body, data.visit_id).run();

  if (PUSH_WHITELIST.has(type)) {
    const subs = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
      .bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();
    const url = data.visit_id ? `/visit/${data.visit_id}` : '/';
    for (const s of subs.results ?? []) {
      const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
      sendWebPush(target, { title, body, url, type }, env).catch((err) => {
        console.error('[webpush] send failed', err);
      });
    }
  }
}
```

- [ ] **Step 2: Replace the function block with the extracted helper + a thin wrapper**

Replace the entire block above (lines ~164–198) with:

```ts
export async function sendTypedNotification(env: Env, opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
  url: string;
  visitId?: string | null;
}): Promise<void> {
  const notifId = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, visit_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(notifId, opts.userId, opts.type, opts.title, opts.body, opts.visitId ?? null).run();

  if (PUSH_WHITELIST.has(opts.type)) {
    const subs = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
      .bind(opts.userId).all<{ endpoint: string; p256dh: string; auth: string }>();
    for (const s of subs.results ?? []) {
      const target: PushTarget = { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth };
      sendWebPush(target, { title: opts.title, body: opts.body, url: opts.url, type: opts.type }, env).catch((err) => {
        console.error('[webpush] send failed', err);
      });
    }
  }
}

async function createInAppNotification(
  userId: string,
  data: VisitNotifyData,
  env: Env,
  customBody?: string
): Promise<void> {
  const title = `Visitor: ${data.first_name} ${data.last_name}`;
  const body = customBody ?? `${data.organisation ? `From ${data.organisation} \u2014 ` : ''}${data.purpose_raw || 'No purpose stated'}`;
  const url = data.visit_id ? `/visit/${data.visit_id}` : '/';
  await sendTypedNotification(env, {
    userId,
    type: 'visitor_arrival',
    title,
    body,
    url,
    visitId: data.visit_id,
  });
}
```

Note: `sendTypedNotification` is exported; `createInAppNotification` stays unexported (used only within this file).

- [ ] **Step 3: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/notifier.ts
git commit -m "refactor(api): extract sendTypedNotification from createInAppNotification"
```

---

## Task 2: Create `reminders.ts` service

**Files:**
- Create: `packages/api/src/services/reminders.ts`

- [ ] **Step 1: Write the module**

Create `packages/api/src/services/reminders.ts` with exactly:

```ts
import type { Env } from '../types';
import { sendTypedNotification } from './notifier';

const LATE_THRESHOLD_MIN_OF_DAY = 8 * 60 + 30; // 08:30 UTC (Ghana time)

/**
 * 08:30 weekday cron.
 * Sends a push + in-app reminder to every active staff member who hasn't
 * clocked in yet today.
 */
export async function sendClockReminders(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT u.id, u.name FROM users u
     WHERE u.is_active = 1
       AND u.staff_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM clock_records c
         WHERE c.user_id = u.id AND c.type = 'clock_in' AND DATE(c.timestamp) = ?
       )`
  ).bind(today).all<{ id: string; name: string }>();

  for (const u of rows.results ?? []) {
    const firstName = u.name.split(' ')[0] || 'there';
    await sendTypedNotification(env, {
      userId: u.id,
      type: 'clock_reminder',
      title: "Don't forget to clock in",
      body: `Have a good day, ${firstName}.`,
      url: '/',
    }).catch((err) => console.error('[reminders] clock_reminder failed', err));
  }
  console.log(`[reminders] sent clock_reminder to ${rows.results?.length ?? 0} users`);
}

/**
 * Fired from POST /clock when a clock_in lands after 08:30.
 * Notifies directorate directors + superadmins (minus the clocker themselves).
 */
export async function sendLateClockAlert(env: Env, userId: string, clockedAtISO: string): Promise<void> {
  const clocker = await env.DB.prepare(
    'SELECT name, directorate_id FROM users WHERE id = ?'
  ).bind(userId).first<{ name: string; directorate_id: string | null }>();
  if (!clocker) return;

  const recipients = await env.DB.prepare(
    `SELECT id FROM users
     WHERE is_active = 1 AND id != ?
       AND (
         (role = 'director' AND directorate_id = ?)
         OR role = 'superadmin'
       )`
  ).bind(userId, clocker.directorate_id ?? '').all<{ id: string }>();

  const at = new Date(clockedAtISO);
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  const minOfDay = at.getUTCHours() * 60 + at.getUTCMinutes();
  const minutesLate = Math.max(0, minOfDay - LATE_THRESHOLD_MIN_OF_DAY);

  for (const r of recipients.results ?? []) {
    await sendTypedNotification(env, {
      userId: r.id,
      type: 'late_clock_alert',
      title: `${clocker.name} clocked in late`,
      body: `Clocked in at ${hh}:${mm} (${minutesLate} minutes late).`,
      url: '/attendance',
    }).catch((err) => console.error('[reminders] late_clock_alert failed', err));
  }
  console.log(`[reminders] late_clock_alert for ${clocker.name} sent to ${recipients.results?.length ?? 0} recipients`);
}

/**
 * 1st-of-month 09:00 cron.
 * Notifies directors + superadmins that the monthly attendance rollup is
 * available (the Telegram summary has already fired via sendDailySummary).
 */
export async function sendMonthlyReportReady(env: Env): Promise<void> {
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const monthName = lastMonth.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const year = lastMonth.getUTCFullYear();

  const recipients = await env.DB.prepare(
    "SELECT id FROM users WHERE is_active = 1 AND role IN ('director', 'superadmin')"
  ).all<{ id: string }>();

  for (const r of recipients.results ?? []) {
    await sendTypedNotification(env, {
      userId: r.id,
      type: 'monthly_report_ready',
      title: 'Monthly attendance summary ready',
      body: `${monthName} ${year} rollup is available.`,
      url: '/attendance',
    }).catch((err) => console.error('[reminders] monthly_report_ready failed', err));
  }
  console.log(`[reminders] monthly_report_ready sent to ${recipients.results?.length ?? 0} recipients`);
}
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/reminders.ts
git commit -m "feat(api): add reminders service (clock reminder, late alert, monthly report)"
```

---

## Task 3: Fire late-clock alert from `POST /clock`

**Files:**
- Modify: `packages/api/src/routes/clock.ts`

- [ ] **Step 1: Add import**

At the top of `packages/api/src/routes/clock.ts`, add next to other imports:

```ts
import { sendLateClockAlert } from '../services/reminders';
```

- [ ] **Step 2: Fire the alert after a late clock-in**

Find the existing streak-update block inside the `POST /` handler. After it (line ~91 — after the two UPDATE streak queries end, but before the response-building SELECT at line ~94), insert:

```ts
  // Late-clock alert: fires for clock_in after 08:30 UTC (Ghana time).
  if (type === 'clock_in') {
    const now = new Date();
    const minOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minOfDay > 8 * 60 + 30) {
      c.executionCtx.waitUntil(sendLateClockAlert(c.env, session.userId, now.toISOString()));
    }
  }
```

The `waitUntil` ensures the alert completes even after the response returns, without blocking the clock-in response.

- [ ] **Step 3: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/clock.ts
git commit -m "feat(api): trigger late_clock_alert when clock_in lands after 08:30"
```

---

## Task 4: Add 08:30 weekday cron trigger

**Files:**
- Modify: `packages/api/wrangler.toml`

- [ ] **Step 1: Extend the triggers array**

Current (line 8–9):

```toml
[triggers]
crons = ["0 9 * * 1-5", "0 16 * * 5", "0 9 1 * *", "0 9 1 1 *"]
```

Replace with:

```toml
[triggers]
crons = ["30 8 * * 1-5", "0 9 * * 1-5", "0 16 * * 5", "0 9 1 * *", "0 9 1 1 *"]
```

Also update the comment above it (line 6–7) from:

```toml
# Attendance summaries — Ghana time (UTC+0)
# Daily: 9 AM Mon-Fri | Weekly: 4 PM Friday | Monthly: 9 AM 1st | Yearly: 9 AM Jan 1
```

to:

```toml
# Attendance summaries — Ghana time (UTC+0)
# Clock reminder: 8:30 AM Mon-Fri | Daily: 9 AM Mon-Fri | Weekly: 4 PM Friday | Monthly: 9 AM 1st | Yearly: 9 AM Jan 1
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/wrangler.toml
git commit -m "chore(api): add 08:30 weekday cron for clock reminders"
```

---

## Task 5: Cron dispatcher in `scheduled()`

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/api/src/index.ts`, near the existing `import { sendDailySummary as sendDailySummaryFn } from './services/daily-summary';` line, add:

```ts
import { sendClockReminders, sendMonthlyReportReady } from './services/reminders';
```

- [ ] **Step 2: Replace the scheduled handler**

Current export at the bottom of the file:

```ts
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await sendDailySummaryFn(env);
  },
};
```

Replace with:

```ts
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      switch (event.cron) {
        case '30 8 * * 1-5':
          await sendClockReminders(env);
          break;
        case '0 9 1 * *':
          await sendDailySummaryFn(env);
          await sendMonthlyReportReady(env);
          break;
        case '0 9 * * 1-5':
        case '0 16 * * 5':
        case '0 9 1 1 *':
          await sendDailySummaryFn(env);
          break;
        default:
          console.warn(`[scheduled] unknown cron: ${event.cron}`);
      }
    })());
  },
};
```

Note: parameters are now `event` and `ctx` (no underscore prefix) because we read `event.cron` and use `ctx.waitUntil`.

- [ ] **Step 3: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat(api): route scheduled events to the right handler via event.cron"
```

---

## Task 6: Local verification

**Files:** none modified.

- [ ] **Step 1: Start `wrangler dev`**

From `packages/api`:

```bash
node ../../node_modules/wrangler/bin/wrangler.js dev --test-scheduled
```

(The `--test-scheduled` flag exposes the `/__scheduled` endpoint for manually triggering cron handlers.)

Leave it running.

- [ ] **Step 2: Trigger the clock reminder cron**

In a second terminal:

```bash
curl -i "http://localhost:8787/__scheduled?cron=30+8+*+*+1-5"
```

Expected: `200 OK`. Check the `wrangler dev` output for `[reminders] sent clock_reminder to N users`. A notification row for each active staff user without a clock-in today should be inserted.

Verify:

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT type, title, COUNT(*) as n FROM notifications WHERE type='clock_reminder' GROUP BY type, title"
```

Expected: at least one row grouped by the reminder title.

- [ ] **Step 3: Trigger the monthly report ready cron**

```bash
curl -i "http://localhost:8787/__scheduled?cron=0+9+1+*+*"
```

Expected: `200 OK`. `wrangler dev` logs a Telegram summary attempt (may no-op if TELEGRAM_BOT_TOKEN unset) AND `[reminders] monthly_report_ready sent to N recipients`.

Verify notifications inserted:

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT user_id, title FROM notifications WHERE type='monthly_report_ready' LIMIT 5"
```

- [ ] **Step 4: Manually simulate a late clock-in**

Log in as a test staff user (e.g., `1334685` / known PIN) from the staff frontend OR via curl:

```bash
# Get session
curl -c cookies.txt -X POST http://localhost:8787/api/auth/pin-login \
  -H "Content-Type: application/json" \
  -d '{"staff_id":"TEST-001","pin":"9999"}'

# Clock in (assuming within geofence)
curl -b cookies.txt -X POST http://localhost:8787/api/clock \
  -H "Content-Type: application/json" \
  -d '{"type":"clock_in","latitude":5.5526925,"longitude":-0.1974803}'
```

If the current UTC time is after 08:30, the late alert fires in the background. If it's before 08:30 when you test, temporarily change the threshold check in `clock.ts` to `minOfDay > 0` so it always fires, verify, then revert.

Verify directors received it:

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT user_id, title, body FROM notifications WHERE type='late_clock_alert' ORDER BY id DESC LIMIT 5"
```

- [ ] **Step 5: Clean up test data**

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="DELETE FROM notifications WHERE type IN ('clock_reminder','late_clock_alert','monthly_report_ready')"
```

(Optional — leaves the DB clean for next test pass.)

---

## Task 7: Deploy to production

**Files:** none modified.

- [ ] **Step 1: Deploy API Worker**

From `packages/api`:

```bash
node ../../node_modules/wrangler/bin/wrangler.js deploy
```

Expected: deploys successfully; output lists the new cron `30 8 * * 1-5` alongside the existing ones. VAPID secrets already in place from previous session.

- [ ] **Step 2: Push to GitHub**

From repo root:

```bash
git push origin main
```

- [ ] **Step 3: Smoke test via remote cron endpoint**

Cloudflare doesn't expose `/__scheduled` on deployed Workers, but the cron will fire naturally at 08:30 UTC on the next weekday. Alternatively, use the Cloudflare dashboard → Workers → Triggers → "Trigger Event" button to fire a specific cron manually.

Manual confirmation: next weekday at 08:30 UTC, check the D1 remote DB for `notifications` rows with `type='clock_reminder'`.

---

## Self-Review Notes

- **Spec coverage:**
  - Feature 1 (clock reminder) → Task 2 (function) + Task 4 (cron) + Task 5 (dispatcher).
  - Feature 2 (late clock alert) → Task 2 (function) + Task 3 (call site).
  - Feature 3 (monthly report ready) → Task 2 (function) + Task 5 (dispatcher).
  - Shared `sendTypedNotification` → Task 1.
  - Deploy → Task 7.
  - Local verification → Task 6.
- **Type consistency:** `sendTypedNotification` signature is used identically across all three reminder functions and the refactored `createInAppNotification`. `PushTarget` is reused via `notifier.ts`'s existing import.
- **Deviation from spec:** none.
- **Known risks:**
  - `wrangler dev --test-scheduled` path assumes current wrangler CLI supports it; if the flag differs, substitute `wrangler dev --local` and trigger via the Cloudflare dashboard post-deploy for verification.
  - A fresh staff user with no push subscription still gets an in-app notification row — expected. Push delivery is best-effort and opt-in.
  - The late-clock alert runs for every late clock-in, including queued/replayed ones from the offline queue. If the queue drains hours later, the alert fires hours after the event. Acceptable — the data's still useful, and directors can act on it whenever they see it.
