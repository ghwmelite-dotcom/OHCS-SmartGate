# Push Triggers Wire-up — Design

**Date:** 2026-04-17
**Scope:** `packages/api` — wire up the three push notification types that exist in the whitelist but aren't yet emitted.

## Goal

Close the gap between our `PUSH_WHITELIST` (4 types) and actual delivery (1 type). Currently `visitor_arrival` fires pushes correctly; `clock_reminder`, `late_clock_alert`, and `monthly_report_ready` are declared dead code. This spec implements all three.

## Background

- Web push infrastructure shipped in prior session: `push_subscriptions` table, VAPID signing via Web Crypto, aes128gcm payload encryption, subscribe/unsubscribe endpoints, `sendWebPush` helper, SW push handler.
- `createInAppNotification` in `services/notifier.ts` (lines 164–198) is hardcoded to `type = 'visitor_arrival'` and forks to `sendWebPush` for whitelisted types.
- Daily summary service (`services/daily-summary.ts`) already computes "who hasn't clocked in" and "who's late" (> 08:30) for Telegram delivery. Reuses apply.
- Wrangler cron triggers today: `0 9 * * 1-5`, `0 16 * * 5`, `0 9 1 * *`, `0 9 1 1 *`.

## Feature 1 — Clock Reminder

### Trigger

Add a new cron `30 8 * * 1-5` (08:30 Accra time, Mon–Fri) to `packages/api/wrangler.toml`. The existing `scheduled()` handler in `src/index.ts` reads `event.cron` and dispatches; currently it ignores the cron string and always calls `sendDailySummary`. It will be refactored to switch on the cron.

### Recipients

All users matching:
- `is_active = 1`
- `staff_id IS NOT NULL`
- No `clock_records` row for today with `type = 'clock_in'`

SQL:
```sql
SELECT u.id, u.name, u.first_name FROM users u
WHERE u.is_active = 1
  AND u.staff_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM clock_records c
    WHERE c.user_id = u.id
      AND c.type = 'clock_in'
      AND DATE(c.timestamp) = ?
  );
```

(Note: the `users` table today has `name` but not `first_name`. Payload uses the first token of `name` — `name.split(' ')[0]`.)

### Payload

```json
{
  "title": "Don't forget to clock in",
  "body": "Have a good day, {FirstName}.",
  "url": "/",
  "type": "clock_reminder"
}
```

## Feature 2 — Late Clock Alert

### Trigger

Inside `POST /clock` (`src/routes/clock.ts`), AFTER the successful INSERT for `type === 'clock_in'`, AFTER the existing streak update. Check the UTC-equivalent Accra time (timezone is UTC+0 per `wrangler.toml` comment). If the minute-of-day is > 08:30, fire the alert via `c.executionCtx.waitUntil(sendLateClockAlert(...))`.

### Recipients

Union of:
- Users with `role = 'director'` AND `directorate_id = <clocking user's directorate_id>`
- Users with `role = 'superadmin'`

Deduped by user id. The clocking user themselves are excluded (no self-alert even if they're a director).

### Payload

```json
{
  "title": "{FirstName} {LastName} clocked in late",
  "body": "Clocked in at {HH:MM} ({NN minutes late}).",
  "url": "/attendance",
  "type": "late_clock_alert"
}
```

Where `{NN}` is minutes past 08:30, rounded down.

### Edge cases

- `clock_out` never triggers.
- If the clocking user has no `directorate_id`, only superadmins are notified.
- Recovery from the offline queue path: the client's queued request still POSTs `/clock` eventually, so the alert fires when the replay lands. `created_at` / `timestamp` on the server side reflects the replay moment (by design — see plan Task 10 decision).

## Feature 3 — Monthly Report Ready

### Trigger

The existing `0 9 1 * *` cron fires `sendDailySummary` (which detects it's a monthly summary via `determineSummaryType()`). After `sendDailySummary` completes, the dispatcher also calls `sendMonthlyReportReady(env)`.

### Recipients

All users with `role IN ('director', 'superadmin')` and `is_active = 1`.

### Payload

```json
{
  "title": "Monthly attendance summary ready",
  "body": "{MonthName} {Year} rollup is available.",
  "url": "/attendance",
  "type": "monthly_report_ready"
}
```

Where `{MonthName}` and `{Year}` reference the **previous** month (since the cron runs on the 1st at 09:00 for the just-ended month).

## Shared Infrastructure

### Generalize the notifier

Current state (`src/services/notifier.ts:164-198`):
- `createInAppNotification(userId, data: VisitNotifyData, env, customBody?)` — hardcoded to `visitor_arrival`.
- `PUSH_WHITELIST` set inline at top of file.

New state:
- Extract `sendTypedNotification(env, opts)` where `opts = { userId, type, title, body, url, visitId? }`. Inserts into `notifications` table with provided type/title/body/visit_id, and forks `sendWebPush` to each of the user's subscriptions when `PUSH_WHITELIST.has(type)`.
- `createInAppNotification` becomes a thin wrapper that builds title/body/url from `VisitNotifyData` and calls `sendTypedNotification` with `type='visitor_arrival'`. Zero behaviour change for existing callers.

### New service module

Create `packages/api/src/services/reminders.ts`:

```ts
export async function sendClockReminders(env: Env): Promise<void>;
export async function sendLateClockAlert(env: Env, userId: string, clockedAtISO: string): Promise<void>;
export async function sendMonthlyReportReady(env: Env): Promise<void>;
```

Each function queries recipients, builds the payload, and calls `sendTypedNotification` per recipient. No Telegram fork — these are push-only. In-app notification row is still created (so the notification bell reflects them).

### Cron dispatcher

Rewrite the `scheduled` export in `src/index.ts`:

```ts
async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil((async () => {
    switch (event.cron) {
      case '30 8 * * 1-5':
        await sendClockReminders(env);
        break;
      case '0 9 * * 1-5':
      case '0 16 * * 5':
      case '0 9 1 1 *':
        await sendDailySummaryFn(env);
        break;
      case '0 9 1 * *':
        await sendDailySummaryFn(env);
        await sendMonthlyReportReady(env);
        break;
    }
  })());
}
```

## Data Flow

```
08:30 weekday cron → sendClockReminders → SELECT staff w/o clock_in →
  for each user → sendTypedNotification(type='clock_reminder') →
    INSERT notifications + (if subscribed) sendWebPush

POST /clock (clock_in, t > 08:30) → existing INSERT +
  waitUntil(sendLateClockAlert) → SELECT directors+superadmins →
    for each (minus the clocker) → sendTypedNotification(type='late_clock_alert')

01st-of-month 09:00 cron → sendDailySummary (Telegram) +
  sendMonthlyReportReady → SELECT directors+superadmins →
    for each → sendTypedNotification(type='monthly_report_ready')
```

## Error handling

- Each `sendWebPush` call is fire-and-forget with `.catch(err => console.error(...))`, same pattern as existing `visitor_arrival` fork.
- Recipients query failures in scheduled jobs log and no-op (don't crash the cron).
- A failed `sendLateClockAlert` MUST NOT fail the `/clock` request — hence `executionCtx.waitUntil`.

## Testing

Manual verification (same project convention — no test runner):

1. **Clock reminder.** Reset a test staff member's clock state for today, invoke the cron locally (`wrangler dev --test-scheduled`, POST to `/__scheduled?cron=30+8+*+*+1-5`), confirm push arrives + in-app notification created.
2. **Late clock alert.** Subscribe a director to push. Have a staff in their directorate clock in at > 08:30 (manually set system time on the worker if needed; easier to temporarily change the threshold to a past time for the test). Confirm director gets push, staff member does not.
3. **Monthly report ready.** Similar: trigger the `0 9 1 * *` cron locally via `/__scheduled?cron=0+9+1+*+*`. Confirm directors + superadmins get the push.

## Out of Scope

- Per-user quiet hours or per-type opt-out.
- Customisable late threshold (stays at 08:30).
- Building a real monthly PDF/HTML report (Option B chosen: the push just points to existing admin attendance page).
- Multi-timezone support (Accra only).
- Aggregating the late alert (e.g., one push per director per morning listing all late staff). Each late clock-in fires a separate push to each director; could be noisy on heavily-late mornings. Accepted trade-off for implementation simplicity.

## Open Questions

None at design time. Implementation plan will confirm the exact column names (`first_name` handling) and Accra-time computation approach.
