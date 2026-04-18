# Absence Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let officers self-report a same-day absence (sick, family emergency, transport, other) with optional note and expected-return date, firing a push to their directorate's directors and suppressing the 8:30 clock reminder.

**Architecture:** New `absence_notices` table + two `/attendance/absence-notice*` endpoints. Notifier gains `absence_notice` in the push whitelist; reminders service gains `sendAbsenceNoticePush` helper. Staff frontend gets a `AbsenceNoticeButton` (renders either a submit button or an "already reported" badge) and an `AbsenceNoticeModal` for input. Daily summary gains a "Notified absent" line.

**Tech Stack:** Cloudflare Workers + Hono + D1 on the API side; React 18 + Zustand + TanStack Query on the staff frontend. No test runner — verification via type-check + `wrangler d1 execute` + curl.

---

## File Structure

**New files:**
- `packages/api/src/db/migration-absence-notices.sql` — ALTER/CREATE for the new table + index.
- `packages/staff/src/components/AbsenceNoticeModal.tsx` — the modal form.
- `packages/staff/src/components/AbsenceNoticeButton.tsx` — outer component: decides button vs badge via `GET /attendance/absence-notice/today`.

**Modified files:**
- `packages/api/src/db/schema.sql` — append the new table.
- `packages/api/src/routes/attendance.ts` — add `POST /absence-notice` and `GET /absence-notice/today`.
- `packages/api/src/services/notifier.ts` — add `absence_notice` to `PUSH_WHITELIST`.
- `packages/api/src/services/reminders.ts` — new `sendAbsenceNoticePush` helper + update `sendClockReminders` SQL.
- `packages/api/src/services/daily-summary.ts` — add "Notified absent" metric + line.
- `packages/staff/src/pages/ClockPage.tsx` — render `<AbsenceNoticeButton />`.

---

## Task 1: Add `absence_notices` table

**Files:**
- Create: `packages/api/src/db/migration-absence-notices.sql`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Write the migration**

Create `packages/api/src/db/migration-absence-notices.sql` with exactly:

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

- [ ] **Step 2: Apply to local D1**

From `packages/api`:

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-absence-notices.sql
```

Expected: `2 commands executed successfully.`

- [ ] **Step 3: Mirror in `schema.sql`**

Append the same `CREATE TABLE` + `CREATE INDEX` block to the end of `packages/api/src/db/schema.sql` (after the last existing table/index).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migration-absence-notices.sql packages/api/src/db/schema.sql
git commit -m "feat(db): add absence_notices table"
```

---

## Task 2: Add `sendAbsenceNoticePush` helper to `reminders.ts`

**Files:**
- Modify: `packages/api/src/services/reminders.ts`

- [ ] **Step 1: Add the helper function**

Read `packages/api/src/services/reminders.ts`. At the end of the file (after `sendMonthlyReportReady`), append:

```ts
export interface AbsenceNoticeInput {
  id: string;
  user_id: string;
  reason: 'sick' | 'family_emergency' | 'transport' | 'other';
  note: string | null;
  notice_date: string;
  expected_return_date: string | null;
}

const REASON_LABELS: Record<AbsenceNoticeInput['reason'], string> = {
  sick: 'Sick',
  family_emergency: 'Family emergency',
  transport: 'Transport',
  other: 'Absent',
};

/**
 * Fired from POST /attendance/absence-notice.
 * Notifies directorate directors + superadmins that a staff member has
 * reported an absence for today (and possibly beyond).
 */
export async function sendAbsenceNoticePush(env: Env, notice: AbsenceNoticeInput): Promise<void> {
  const user = await env.DB.prepare(
    'SELECT name, directorate_id FROM users WHERE id = ?'
  ).bind(notice.user_id).first<{ name: string; directorate_id: string | null }>();
  if (!user) return;

  const recipients = await env.DB.prepare(
    `SELECT id FROM users
     WHERE is_active = 1 AND id != ?
       AND (
         (role = 'director' AND directorate_id = ?)
         OR role = 'superadmin'
       )`
  ).bind(notice.user_id, user.directorate_id ?? '').all<{ id: string }>();

  const label = REASON_LABELS[notice.reason];
  const body = notice.note ? `${label} — ${notice.note}` : label;

  let title: string;
  if (notice.expected_return_date) {
    const rd = new Date(notice.expected_return_date + 'T00:00:00Z');
    const dateFmt = rd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    title = `${user.name} out through ${dateFmt}`;
  } else {
    title = `${user.name} won't be in today`;
  }

  for (const r of recipients.results ?? []) {
    await sendTypedNotification(env, {
      userId: r.id,
      type: 'absence_notice',
      title,
      body,
      url: '/attendance',
    }).catch((err) => console.error('[reminders] absence_notice failed', err));
  }
  console.log(`[reminders] absence_notice for ${user.name} sent to ${recipients.results?.length ?? 0} recipients`);
}
```

- [ ] **Step 2: Type-check**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/reminders.ts
git commit -m "feat(api): add sendAbsenceNoticePush helper"
```

---

## Task 3: Add `absence_notice` to PUSH_WHITELIST

**Files:**
- Modify: `packages/api/src/services/notifier.ts`

- [ ] **Step 1: Update the whitelist**

Find the line in `packages/api/src/services/notifier.ts`:

```ts
const PUSH_WHITELIST = new Set(['visitor_arrival', 'clock_reminder', 'late_clock_alert', 'monthly_report_ready']);
```

Replace with:

```ts
const PUSH_WHITELIST = new Set(['visitor_arrival', 'clock_reminder', 'late_clock_alert', 'monthly_report_ready', 'absence_notice']);
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/notifier.ts
git commit -m "feat(api): add absence_notice to PUSH_WHITELIST"
```

---

## Task 4: Suppress clock reminder for active notices

**Files:**
- Modify: `packages/api/src/services/reminders.ts`

- [ ] **Step 1: Update `sendClockReminders` query**

In `packages/api/src/services/reminders.ts`, find `sendClockReminders`. The current SELECT is:

```ts
const rows = await env.DB.prepare(
  `SELECT u.id, u.name FROM users u
   WHERE u.is_active = 1
     AND u.staff_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM clock_records c
       WHERE c.user_id = u.id AND c.type = 'clock_in' AND DATE(c.timestamp) = ?
     )`
).bind(today).all<{ id: string; name: string }>();
```

Replace with:

```ts
const rows = await env.DB.prepare(
  `SELECT u.id, u.name FROM users u
   WHERE u.is_active = 1
     AND u.staff_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM clock_records c
       WHERE c.user_id = u.id AND c.type = 'clock_in' AND DATE(c.timestamp) = ?
     )
     AND NOT EXISTS (
       SELECT 1 FROM absence_notices a
       WHERE a.user_id = u.id
         AND ? BETWEEN a.notice_date AND COALESCE(a.expected_return_date, a.notice_date)
     )`
).bind(today, today).all<{ id: string; name: string }>();
```

Note the `.bind(today, today)` — two positional parameters now.

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/reminders.ts
git commit -m "feat(api): skip clock reminder for users with active absence notice"
```

---

## Task 5: Add absence-notice endpoints

**Files:**
- Modify: `packages/api/src/routes/attendance.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/api/src/routes/attendance.ts`, near the existing imports, add:

```ts
import { sendAbsenceNoticePush, type AbsenceNoticeInput } from '../services/reminders';
```

- [ ] **Step 2: Add the POST endpoint**

At the end of the file (before the final `export` or after the last existing route — wherever the router ends), add:

```ts
const absenceNoticeSchema = z.object({
  reason: z.enum(['sick', 'family_emergency', 'transport', 'other']),
  note: z.string().max(200).optional(),
  expected_return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

attendanceRoutes.post('/absence-notice', zValidator('json', absenceNoticeSchema), async (c) => {
  const session = c.get('session');
  const body = c.req.valid('json');
  const today = new Date().toISOString().slice(0, 10);

  if (body.expected_return_date && body.expected_return_date < today) {
    return error(c, 'INVALID_DATE', 'expected_return_date cannot be in the past', 400);
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO absence_notices (id, user_id, reason, note, notice_date, expected_return_date)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, session.userId, body.reason, body.note ?? null, today, body.expected_return_date ?? null).run();

  const notice: AbsenceNoticeInput = {
    id,
    user_id: session.userId,
    reason: body.reason,
    note: body.note ?? null,
    notice_date: today,
    expected_return_date: body.expected_return_date ?? null,
  };

  c.executionCtx.waitUntil(sendAbsenceNoticePush(c.env, notice));

  return success(c, notice);
});
```

- [ ] **Step 3: Add the GET endpoint**

Immediately after the POST endpoint (same file), add:

```ts
attendanceRoutes.get('/absence-notice/today', async (c) => {
  const session = c.get('session');
  const today = new Date().toISOString().slice(0, 10);

  const row = await c.env.DB.prepare(
    `SELECT id, user_id, reason, note, notice_date, expected_return_date, created_at
     FROM absence_notices
     WHERE user_id = ?
       AND ? BETWEEN notice_date AND COALESCE(expected_return_date, notice_date)
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(session.userId, today).first();

  return success(c, row ?? null);
});
```

- [ ] **Step 4: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/routes/attendance.ts
git commit -m "feat(api): add POST /attendance/absence-notice + GET .../today"
```

---

## Task 6: Daily summary "Notified absent" line

**Files:**
- Modify: `packages/api/src/services/daily-summary.ts`

- [ ] **Step 1: Add a fourth count to `Promise.all`**

In `packages/api/src/services/daily-summary.ts`, find the `sendDailyReport` function (around line 34). The existing `Promise.all` (around lines 38–46) has three queries: `totalStaff`, `clockedIn`, `lateCount`.

Replace the `const [totalStaff, clockedIn, lateCount] = await Promise.all([...])` block with:

```ts
const [totalStaff, clockedIn, lateCount, noticedCount] = await Promise.all([
  env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').first<{ c: number }>(),
  env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) as c FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) = ?`
  ).bind(today).first<{ c: number }>(),
  env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) as c FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) = ? AND TIME(timestamp) > '08:30:00'`
  ).bind(today).first<{ c: number }>(),
  env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) as c FROM absence_notices
     WHERE ? BETWEEN notice_date AND COALESCE(expected_return_date, notice_date)`
  ).bind(today).first<{ c: number }>(),
]);
```

- [ ] **Step 2: Add the message line**

In the same function, find the `message` array that's `join('\n')`'d. It currently contains a "Late" line. Add a "Notified absent" line AFTER the "Late" line. The current block:

```ts
const message = [
  `\u{1F4CA} <b>Daily Attendance</b>`,
  `${dateFormatted} \u2014 ${time}`,
  '',
  `\u2705 Present: <b>${present}</b>/${total} (${rate}%)`,
  `\u{1F534} Absent: <b>${absent}</b>`,
  lateCount?.c ? `\u26A0\uFE0F Late: <b>${lateCount.c}</b>` : '',
  '',
  dirLines ? `<b>By Directorate:</b>\n${dirLines}` : '',
  '',
  `\u2014 OHCS SmartGate`,
].filter(Boolean).join('\n');
```

Replace with:

```ts
const message = [
  `\u{1F4CA} <b>Daily Attendance</b>`,
  `${dateFormatted} \u2014 ${time}`,
  '',
  `\u2705 Present: <b>${present}</b>/${total} (${rate}%)`,
  `\u{1F534} Absent: <b>${absent}</b>`,
  lateCount?.c ? `\u26A0\uFE0F Late: <b>${lateCount.c}</b>` : '',
  noticedCount?.c ? `\u{1F4DD} Notified absent: <b>${noticedCount.c}</b>` : '',
  '',
  dirLines ? `<b>By Directorate:</b>\n${dirLines}` : '',
  '',
  `\u2014 OHCS SmartGate`,
].filter(Boolean).join('\n');
```

(The 📝 emoji signals the new category.)

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/api/tsconfig.json
git add packages/api/src/services/daily-summary.ts
git commit -m "feat(api): add 'Notified absent' line to daily summary"
```

---

## Task 7: `AbsenceNoticeModal` component

**Files:**
- Create: `packages/staff/src/components/AbsenceNoticeModal.tsx`

- [ ] **Step 1: Write the component**

Create `packages/staff/src/components/AbsenceNoticeModal.tsx` with exactly:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { X, Thermometer, AlertTriangle, Car, HelpCircle, Check } from 'lucide-react';

type Reason = 'sick' | 'family_emergency' | 'transport' | 'other';

const REASONS: { value: Reason; label: string; Icon: typeof Thermometer }[] = [
  { value: 'sick', label: 'Sick', Icon: Thermometer },
  { value: 'family_emergency', label: 'Family emergency', Icon: AlertTriangle },
  { value: 'transport', label: 'Transport', Icon: Car },
  { value: 'other', label: 'Other', Icon: HelpCircle },
];

export function AbsenceNoticeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [expectedReturn, setExpectedReturn] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const today = new Date().toISOString().slice(0, 10);

  const mutation = useMutation({
    mutationFn: (body: { reason: Reason; note?: string; expected_return_date?: string }) =>
      api.post('/attendance/absence-notice', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['absence-notice-today'] });
      setTimeout(() => onClose(), 2000);
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    setErrorMsg('');
    const body: { reason: Reason; note?: string; expected_return_date?: string } = { reason };
    if (note.trim()) body.note = note.trim();
    if (expectedReturn) body.expected_return_date = expectedReturn;
    mutation.mutate(body);
  }

  const isSuccess = mutation.isSuccess;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="p-6">
          {isSuccess ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check className="h-7 w-7 text-green-600" />
              </div>
              <p className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Notice sent</p>
              <p className="text-[14px] text-gray-500 mt-1">Your director has been notified.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[18px] font-bold text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
                  Can't make it today
                </h3>
                <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Reason</label>
                  <div className="grid grid-cols-2 gap-2">
                    {REASONS.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setReason(value)}
                        className={`h-14 px-3 rounded-xl border-2 flex items-center gap-2 text-[14px] font-semibold transition-all ${
                          reason === value
                            ? 'border-[#1A4D2E] bg-[#1A4D2E]/5 text-[#1A4D2E]'
                            : 'border-gray-200 text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="text-left">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Note <span className="text-gray-400 normal-case">(optional)</span></label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    maxLength={200}
                    rows={2}
                    placeholder="Any context you'd like your director to know."
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E] resize-none"
                  />
                  <p className="text-[11px] text-gray-400 mt-1 text-right">{note.length}/200</p>
                </div>

                <div>
                  <label className="block text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Expected back <span className="text-gray-400 normal-case">(optional)</span></label>
                  <input
                    type="date"
                    min={today}
                    value={expectedReturn}
                    onChange={(e) => setExpectedReturn(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-gray-200 bg-gray-50 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#1A4D2E]/20 focus:border-[#1A4D2E]"
                  />
                </div>

                {errorMsg && <p className="text-red-600 text-[13px] font-medium">{errorMsg}</p>}

                <button
                  type="submit"
                  disabled={!reason || mutation.isPending}
                  className="w-full h-12 bg-[#1A4D2E] text-white rounded-xl font-bold text-[15px] hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  {mutation.isPending ? 'Sending...' : 'Send notice'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/AbsenceNoticeModal.tsx
git commit -m "feat(staff): add AbsenceNoticeModal component"
```

---

## Task 8: `AbsenceNoticeButton` component

**Files:**
- Create: `packages/staff/src/components/AbsenceNoticeButton.tsx`

- [ ] **Step 1: Write the component**

Create `packages/staff/src/components/AbsenceNoticeButton.tsx` with exactly:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, Check } from 'lucide-react';
import { AbsenceNoticeModal } from './AbsenceNoticeModal';

type Reason = 'sick' | 'family_emergency' | 'transport' | 'other';

interface Notice {
  id: string;
  reason: Reason;
  note: string | null;
  notice_date: string;
  expected_return_date: string | null;
}

const REASON_LABELS: Record<Reason, string> = {
  sick: 'Sick',
  family_emergency: 'Family emergency',
  transport: 'Transport',
  other: 'Other',
};

export function AbsenceNoticeButton() {
  const [showModal, setShowModal] = useState(false);
  const { data } = useQuery({
    queryKey: ['absence-notice-today'],
    queryFn: () => api.get<Notice | null>('/attendance/absence-notice/today'),
    staleTime: 60_000,
  });

  const notice = data?.data ?? null;

  if (notice) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-white/60 text-[12px] font-medium">
        <Check className="h-3.5 w-3.5" />
        Reported absence today · {REASON_LABELS[notice.reason]}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/5 text-[12px] font-medium transition-colors"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Can't make it today?
      </button>
      {showModal && <AbsenceNoticeModal onClose={() => setShowModal(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/AbsenceNoticeButton.tsx
git commit -m "feat(staff): add AbsenceNoticeButton (query + render button or badge)"
```

---

## Task 9: Render `AbsenceNoticeButton` on `ClockPage`

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Add import**

Near the other imports in `packages/staff/src/pages/ClockPage.tsx`, add:

```tsx
import { AbsenceNoticeButton } from '@/components/AbsenceNoticeButton';
```

- [ ] **Step 2: Render in the layout**

Read `ClockPage.tsx` to locate the main content area. The primary page layout is inside `<div className="flex-1 flex flex-col items-center px-5 py-6 safe-area-bottom">` (around line 228 after prior changes).

At the end of that main content flex container, immediately BEFORE the closing `</div>` that ends `flex-1 ...`, add:

```tsx
<div className="w-full flex justify-center mt-8">
  <AbsenceNoticeButton />
</div>
```

This places the button at the bottom of the clock UI, visually subordinate, without interfering with clock-in / clock-out flow.

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): render AbsenceNoticeButton on ClockPage"
```

---

## Task 10: Local smoke test

**Files:** none modified.

- [ ] **Step 1: Start both dev servers**

Terminal A (API):

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js dev
```

Terminal B (staff frontend):

```bash
cd packages/staff
npm run dev
```

- [ ] **Step 2: Submit a notice**

Log in to the staff app as `1334685` / acknowledged PIN. Click **Can't make it today?**.

- Select **Sick**, leave note + date blank, submit.
- Expected: 2-second "Notice sent" confirmation, modal dismisses, the button is replaced by *"Reported absence today · Sick"* badge.

Verify in DB:

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT user_id, reason, note, notice_date, expected_return_date FROM absence_notices ORDER BY created_at DESC LIMIT 5"
```

Expected: one row for staff `1334685`, reason `sick`, `notice_date` = today.

- [ ] **Step 3: Verify GET endpoint**

In a new tab, refresh the staff app. Expected: the button loads directly as the badge (no flash of the button state), because `GET /attendance/absence-notice/today` returns the existing notice.

- [ ] **Step 4: Verify clock-in still works**

Click **Clock In**, follow the camera+GPS flow. Expected: clock-in succeeds with no error; `absence_notices` row persists; `clock_records` row is inserted as normal.

- [ ] **Step 5: Verify clock reminder is suppressed**

Trigger the cron locally:

```bash
curl -i "http://localhost:8787/__scheduled?cron=30+8+*+*+1-5"
```

Check DB:

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT user_id FROM notifications WHERE type='clock_reminder' AND user_id = 'user_superadmin'"
```

Expected: no row. The user with an active notice didn't get a clock reminder.

- [ ] **Step 6: Clean up test data**

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="DELETE FROM absence_notices; DELETE FROM notifications WHERE type='absence_notice'"
```

---

## Task 11: Deploy

**Files:** none modified.

- [ ] **Step 1: Apply migration to remote D1**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --remote --file=src/db/migration-absence-notices.sql
```

Expected: `2 commands executed successfully.`

- [ ] **Step 2: Deploy API Worker**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js deploy
```

Expected: deploy succeeds, lists 5 schedule triggers (unchanged).

- [ ] **Step 3: Rebuild + deploy staff Pages**

From repo root:

```bash
node node_modules/typescript/bin/tsc -b packages/staff
node node_modules/vite/bin/vite.js build packages/staff
cd packages/staff
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=staff-attendance --branch=main --commit-dirty=true
```

Expected: deployment URL printed.

- [ ] **Step 4: Push to GitHub**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
git push origin main
```

- [ ] **Step 5: Production smoke test**

On `staff-attendance.pages.dev`, log in, submit a test absence notice, verify in Cloudflare D1 dashboard that the row was created.

---

## Self-Review Notes

- **Spec coverage:**
  - New table → Task 1.
  - `POST /attendance/absence-notice` + `GET /attendance/absence-notice/today` → Task 5.
  - `absence_notice` in PUSH_WHITELIST → Task 3.
  - `sendAbsenceNoticePush` helper → Task 2.
  - Clock reminder suppression → Task 4.
  - Daily summary "Notified absent" line → Task 6.
  - `AbsenceNoticeModal` → Task 7.
  - `AbsenceNoticeButton` → Task 8.
  - ClockPage integration → Task 9.
  - Local smoke test → Task 10.
  - Deploy → Task 11.
- **Ordering:** Table first (Task 1), so migrations land before any query references the table. `sendAbsenceNoticePush` (Task 2) is written before the route (Task 5) imports it. `absence_notice` whitelist (Task 3) is before the helper actually fires push so types match. Clock reminder update (Task 4) requires the table (Task 1) — ordered correctly. Task 6 (daily summary) likewise requires the table. Frontend (Tasks 7–9) depend on the API (Tasks 2,3,5) being in place.
- **Type consistency:**
  - `Reason` type: `'sick' | 'family_emergency' | 'transport' | 'other'` — same enum across `reminders.ts`, `attendance.ts` zod, `AbsenceNoticeModal`, `AbsenceNoticeButton`.
  - `AbsenceNoticeInput` shape matches what the POST handler constructs and passes to `sendAbsenceNoticePush`.
  - `notice_date`, `expected_return_date` field names consistent end-to-end.
- **Known risks:**
  - `wrangler dev --test-scheduled` flag assumption in Task 10 Step 5; if the flag is missing on this wrangler version, trigger via the Cloudflare dashboard post-deploy instead.
  - If the user has no subscribed directors at the time of submission, the push helper silently sends to zero recipients. That's expected behaviour — in-app notification bell still works via the `INSERT INTO notifications` side effect inside `sendTypedNotification`.
  - Two absence-notice submissions on the same day don't merge — "newest wins" via the GET endpoint's `ORDER BY created_at DESC LIMIT 1`. Spec note confirms this.
