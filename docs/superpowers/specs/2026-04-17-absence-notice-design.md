# Absence Notice — Design

**Date:** 2026-04-17
**Scope:** `packages/api` (new endpoint, new table, notifier+reminders updates) and `packages/staff` (new button + modal). Not `packages/web`.

## Goal

Give officers a fast, self-service way to report a same-day absence (sudden illness, family emergency, transport problem, other) before the workday starts. The notice fires a push to their directorate's directors, suppresses the 8:30 clock reminder for that user, and shows up as a distinct "Notified absent" category in daily attendance summaries — separating respectful absentees from silent no-shows.

## Behaviour Summary

- Staff opens the app, taps *"Can't make it today?"*, picks a reason, optionally adds a note and an expected return date, submits.
- A push fires to the directorate's director(s) + all superadmins. An in-app notification row is also created for each recipient.
- The 8:30 clock reminder is suppressed for that user today (and through `expected_return_date` if provided).
- The daily Telegram summary gains a "Notified absent" line.
- Officer CAN still clock in later that day (per Q2.A) — the notice becomes a historical record, no auto-cancel, no block.

## Data Model

New table:

```sql
CREATE TABLE IF NOT EXISTS absence_notices (
  id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id               TEXT NOT NULL REFERENCES users(id),
  reason                TEXT NOT NULL CHECK(reason IN ('sick','family_emergency','transport','other')),
  note                  TEXT,
  notice_date           TEXT NOT NULL,
  expected_return_date  TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_absence_notices_user_date ON absence_notices(user_id, notice_date);
```

- `notice_date` is a `YYYY-MM-DD` string. Server sets it at insert time from current UTC date.
- `expected_return_date` is an INCLUSIVE end date — if set, "active today" evaluates as `today BETWEEN notice_date AND expected_return_date`.
- Multiple rows for the same `(user_id, notice_date)` are allowed (officer may submit twice with updated info) — the newest row takes precedence.
- `note` is TEXT, soft-capped at 200 chars by the API (not enforced in SQL).

### Active-notice query

```sql
SELECT * FROM absence_notices
 WHERE user_id = ?
   AND ? BETWEEN notice_date AND COALESCE(expected_return_date, notice_date)
 ORDER BY created_at DESC
 LIMIT 1;
```

## API

### `POST /attendance/absence-notice`

- Auth: session required (same pattern as other `/attendance/*` routes).
- Body:
  ```ts
  {
    reason: 'sick' | 'family_emergency' | 'transport' | 'other',
    note?: string,               // max 200 chars
    expected_return_date?: string // 'YYYY-MM-DD', must be >= today
  }
  ```
- Behaviour:
  1. Validate via zod. Reject 400 on enum miss, note too long, or `expected_return_date` before today.
  2. Insert row: `notice_date = today UTC`, other fields from body.
  3. Fire `sendAbsenceNoticePush(env, userId, noticeRow)` via `c.executionCtx.waitUntil` — fire-and-forget so the response returns immediately.
  4. Return `{ data: { id, reason, note, notice_date, expected_return_date, created_at } }`.

### `GET /attendance/absence-notice/today`

- Auth: session required.
- Returns the user's active notice for today (most-recent row where `today BETWEEN notice_date AND COALESCE(expected_return_date, notice_date)`), or `{ data: null }`.
- Frontend calls this on `ClockPage` mount to decide whether to show the submit UI or the "already reported" state.

### No cancel/delete

Per the Q2.A decision, officers who change their mind simply clock in. There is no cancel endpoint. A notice persists as a historical record regardless of whether the officer clocks in afterward.

## Push Integration

### Whitelist update

`PUSH_WHITELIST` in `packages/api/src/services/notifier.ts` gains one new type:

```ts
const PUSH_WHITELIST = new Set([
  'visitor_arrival',
  'clock_reminder',
  'late_clock_alert',
  'monthly_report_ready',
  'absence_notice',
]);
```

### Recipients

Same pattern as `late_clock_alert`:

```sql
SELECT id FROM users
 WHERE is_active = 1
   AND id != ?                           -- minus the noticing user
   AND (
     (role = 'director' AND directorate_id = ?)  -- same directorate
     OR role = 'superadmin'
   );
```

### Payload

- **Title:**
  - No `expected_return_date`: *"{FullName} won't be in today"*
  - With `expected_return_date`: *"{FullName} out through {DD MMM}"* (e.g., *"out through 22 Apr"*)
- **Body:**
  - Reason label: `sick` → *"Sick"*, `family_emergency` → *"Family emergency"*, `transport` → *"Transport"*, `other` → *"Absent"*.
  - If `note` present: `"{ReasonLabel} — {note}"`.
  - Else: just the reason label.
- **URL:** `/attendance`

### New helper

Create `sendAbsenceNoticePush(env, userId, notice)` in `packages/api/src/services/reminders.ts` — mirrors `sendLateClockAlert`'s recipient pattern but with absence-notice payload construction. Calls `sendTypedNotification` per recipient with `type: 'absence_notice'`.

## Clock Reminder Suppression

`sendClockReminders` in `reminders.ts` gets an extra clause. Current query skeleton (paraphrased):

```sql
SELECT u.id, u.name FROM users u
 WHERE u.is_active = 1
   AND u.staff_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM clock_records c WHERE ... today)
```

Adds:

```sql
   AND NOT EXISTS (
     SELECT 1 FROM absence_notices a
     WHERE a.user_id = u.id
       AND ? BETWEEN a.notice_date AND COALESCE(a.expected_return_date, a.notice_date)
   )
```

Parameter bound twice to `today`.

## Daily Summary Enhancement

In `packages/api/src/services/daily-summary.ts`'s `sendDailyReport`:

Add a fourth parallel COUNT to the existing `Promise.all`:

```sql
SELECT COUNT(DISTINCT user_id) AS c
  FROM absence_notices
 WHERE ? BETWEEN notice_date AND COALESCE(expected_return_date, notice_date)
```

Render line in the message (between Absent and Late):

```
📝 Notified absent: <b>{N}</b>
```

Only render when `N > 0`. The existing "Absent" line stays as-is — callers can infer silent absentees = `absent - notified_absent`. Alternatively, split "Absent" into "Absent (notified)" + "Absent (silent)"; if it gets busy, revisit.

## Frontend (staff app)

### New components

**`packages/staff/src/components/AbsenceNoticeButton.tsx`** — thin button that:
- On mount, calls `GET /attendance/absence-notice/today`.
- If null (no active notice), renders a small outlined button *"Can't make it today?"* that opens `AbsenceNoticeModal` on click.
- If non-null, renders a read-only badge *"Reported absence today · {ReasonLabel}"* (no cancel, no action — just confirmation).

**`packages/staff/src/components/AbsenceNoticeModal.tsx`** — modal:
- Reason chooser: four tall radio buttons, each a reason label + a lucide icon (`Thermometer` / `AlertTriangle` / `Car` / `HelpCircle`).
- Optional **Note** textarea, `maxLength={200}`, placeholder *"Optional — any context you'd like your director to know."*
- Optional **Expected back** date input, `min={today}`.
- **Submit** button (`POST /attendance/absence-notice`) — on success, 2-second success state (*"Your director has been notified."*) then auto-dismiss and invalidate the button's query so the badge replaces the button.
- Backdrop click + X button dismiss.

### ClockPage integration

Render `<AbsenceNoticeButton />` in `ClockPage.tsx` below the main clock-in/out buttons, visually subordinate (smaller, muted).

No changes to clock-in flow — per Q2.A, clock-in works even if an absence notice exists for today.

## Error Handling

- **Validation failures** → 400 with error code `INVALID_INPUT` and zod error message.
- **`expected_return_date` in the past** → 400 with code `INVALID_DATE`.
- **DB insert failure** → 500; no push fires.
- **Push failure** → logged (`console.error`), swallowed — same pattern as all other typed notifications. Does not affect the 200 response to the officer.
- **Frontend fetch failure** → modal stays open, error message shown inline, user can retry.

## Testing

Manual verification (no test runner):

1. **Happy path** — log in as staff user, open absence modal, pick "Sick", submit. Expect: 200 from API, DB row inserted, director (subscribed) receives push within seconds, 8:30 cron next morning skips this user.
2. **Expected-return** — submit with `expected_return_date = today+2`. Verify push title mentions the date. Verify cron on days today+1 and today+2 also skip this user; day today+3 resumes the reminder.
3. **Clock-in after notice** — submit notice, then attempt clock-in. Expect: clock-in succeeds, no error, notice row persists.
4. **GET endpoint** — call `/attendance/absence-notice/today` before submitting (returns null) and after (returns the row).
5. **Daily summary** — run `sendDailyReport` manually when at least one notice is active; verify "Notified absent" line renders with correct count.
6. **Directorate scoping** — submit notice as a user in directorate A; verify only directorate-A directors + superadmins get the push, NOT directors of directorate B.

## Out of Scope

- Approval workflow (no director approval needed; pure notice).
- Medical certificate / file upload.
- Admin-side UI to browse/filter all notices (covered by in-app notification bell + daily summary).
- Mid-shift emergency (officer clocks in, then leaves). Clock-out already captures that data; no new flow needed.
- Cancel/edit endpoints. Q2.A decision: officer changes their mind by clocking in; the notice stays as record.
- `packages/web` (VMS) integration. Receptionists/admins don't clock in.
- Multi-day calendar view.
- Configurable reason enum (stays hardcoded in this spec; future: admin-editable list).
- Per-directorate escalation (e.g., if no director, notify unit head instead).

## Open Questions

None at design time.
