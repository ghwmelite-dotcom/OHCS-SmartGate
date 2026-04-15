# Phase 2: Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI classification, Telegram + in-app notifications, digital badges, and an AI assistant to SmartGate.

**Architecture:** Workers AI (Llama 3.3 70B) powers classification and the assistant via the `AI` binding. Telegram Bot API sends visitor-arrival alerts via `fetch()`. Digital badges are server-rendered HTML pages served from the Worker. In-app notifications use a D1 table polled by the frontend.

**Tech Stack:** Cloudflare Workers AI, Telegram Bot API, Hono, D1, KV, React 18, TanStack Query, Zustand, `qrcode` (npm)

---

## File Structure

### API (packages/api/src/)

| File | Action | Responsibility |
|---|---|---|
| `types.ts` | Modify | Add `AI` binding to `Env` |
| `db/migration-phase2.sql` | Create | Schema migration (notifications table, officers.telegram_chat_id) |
| `services/classifier.ts` | Create | Visit purpose classification via Workers AI |
| `services/telegram.ts` | Create | Telegram Bot API: send messages, handle webhooks |
| `services/notifier.ts` | Create | Orchestrates Telegram + in-app notifications on check-in |
| `services/assistant.ts` | Create | AI assistant: system prompt, lookup commands, Workers AI calls |
| `routes/visits.ts` | Modify | Add classifier + notifier calls to check-in handler |
| `routes/badges.ts` | Create | Public badge API + server-rendered badge HTML page |
| `routes/notifications.ts` | Create | CRUD for in-app notifications |
| `routes/telegram.ts` | Create | Webhook handler + account linking |
| `routes/assistant.ts` | Create | Chat endpoint |
| `index.ts` | Modify | Register new routes, public badge route |
| `wrangler.toml` (root of api) | Modify | Add `[ai]` binding |

### Frontend (packages/web/src/)

| File | Action | Responsibility |
|---|---|---|
| `lib/api.ts` | Modify | Add Notification type |
| `components/NotificationBell.tsx` | Create | Bell icon + dropdown in header |
| `components/chat/ChatBubble.tsx` | Create | Floating chat button |
| `components/chat/ChatPanel.tsx` | Create | Chat conversation panel |
| `stores/chat.ts` | Create | Zustand store for chat messages |
| `pages/CheckInPage.tsx` | Modify | Add QR code to success step |
| `pages/DashboardPage.tsx` | Modify | Add QR scan check-out route |
| `pages/LinkTelegramPage.tsx` | Create | Telegram account linking page |
| `components/layout/Header.tsx` | Modify | Add NotificationBell |
| `components/layout/AppLayout.tsx` | Modify | Add ChatBubble |
| `App.tsx` | Modify | Add new routes |

---

## Task 1: Schema Migration + Env Update

**Files:**
- Create: `packages/api/src/db/migration-phase2.sql`
- Modify: `packages/api/src/types.ts`
- Modify: `packages/api/wrangler.toml`

- [ ] **Step 1: Create the migration SQL**

Create `packages/api/src/db/migration-phase2.sql`:

```sql
-- Phase 2 Migration: Notifications + Telegram linking

ALTER TABLE officers ADD COLUMN telegram_chat_id TEXT;

CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id     TEXT NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL DEFAULT 'visitor_arrival',
    title       TEXT NOT NULL,
    body        TEXT,
    visit_id    TEXT REFERENCES visits(id),
    is_read     INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
cd packages/api
npx wrangler d1 execute smartgate-db --local --file=src/db/migration-phase2.sql
```
Expected: "3 commands executed successfully"

- [ ] **Step 3: Add AI binding to types.ts**

In `packages/api/src/types.ts`, replace the `Env` interface:

```typescript
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  STORAGE: R2Bucket;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  ENVIRONMENT: string;
}
```

- [ ] **Step 4: Add AI binding to wrangler.toml**

Append to `packages/api/wrangler.toml`:

```toml

[ai]
binding = "AI"
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/migration-phase2.sql packages/api/src/types.ts packages/api/wrangler.toml
git commit -m "feat: add Phase 2 schema migration and AI/Telegram bindings"
```

---

## Task 2: AI Classification Service

**Files:**
- Create: `packages/api/src/services/classifier.ts`
- Modify: `packages/api/src/routes/visits.ts`

- [ ] **Step 1: Create the classifier service**

Create `packages/api/src/services/classifier.ts`:

```typescript
import type { Env } from '../types';

const CATEGORY_SLUGS = [
  'official_meeting', 'document_submission', 'job_inquiry', 'complaint',
  'personal_visit', 'delivery', 'scheduled_appointment', 'consultation',
  'inspection', 'training', 'interview', 'other',
] as const;

const SYSTEM_PROMPT = `You are a visit classifier for OHCS (Office of the Head of Civil Service, Ghana).
Classify the visitor's stated purpose into exactly one category.
Return ONLY the slug, nothing else.

Categories:
- official_meeting: Official meetings with officers
- document_submission: Submitting or collecting documents
- job_inquiry: Job applications, recruitment inquiries
- complaint: Complaints, petitions, grievances
- personal_visit: Personal visits to staff
- delivery: Deliveries or collections
- scheduled_appointment: Pre-arranged appointments
- consultation: Advisory or consultation meetings
- inspection: Inspections, audits
- training: Training sessions, workshops
- interview: Job interviews
- other: Does not fit any category`;

export async function classifyPurpose(purposeRaw: string, env: Env): Promise<string | null> {
  try {
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: purposeRaw },
      ],
      max_tokens: 20,
    });

    const slug = (response as { response?: string }).response?.trim().toLowerCase();
    if (slug && CATEGORY_SLUGS.includes(slug as typeof CATEGORY_SLUGS[number])) {
      return slug;
    }
    return null;
  } catch (err) {
    console.error('[Classifier] Failed:', err);
    return null;
  }
}

export async function classifyAndUpdate(visitId: string, purposeRaw: string, directorate_id: string | null, env: Env): Promise<void> {
  const slug = await classifyPurpose(purposeRaw, env);
  if (!slug) return;

  const updates: string[] = ['purpose_category = ?'];
  const params: unknown[] = [slug];

  // If no directorate was selected, check if this category has a hint
  if (!directorate_id) {
    const hint = await env.DB.prepare(
      'SELECT directorate_hint_id FROM visit_categories WHERE slug = ? AND directorate_hint_id IS NOT NULL'
    ).bind(slug).first<{ directorate_hint_id: string }>();

    if (hint?.directorate_hint_id) {
      updates.push('directorate_id = ?');
      params.push(hint.directorate_hint_id);
    }
  }

  params.push(visitId);
  await env.DB.prepare(`UPDATE visits SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
}
```

- [ ] **Step 2: Wire classifier into check-in route**

In `packages/api/src/routes/visits.ts`, add the import at the top:

```typescript
import { classifyAndUpdate } from '../services/classifier';
```

Then in the `POST /check-in` handler, after `return created(c, visit);`, add the `waitUntil` call. Replace the end of the handler (after the visit SELECT query) with:

```typescript
  // Fire classification in background (non-blocking)
  c.executionCtx.waitUntil(
    classifyAndUpdate(visitId, body.purpose_raw || '', body.directorate_id || null, c.env)
  );

  return created(c, visit);
```

- [ ] **Step 3: Verify the Worker still starts**

Run:
```bash
cd packages/api && npx wrangler dev --port 8787
```
Expected: Worker starts without errors.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/classifier.ts packages/api/src/routes/visits.ts
git commit -m "feat: add AI visit purpose classification via Workers AI"
```

---

## Task 3: Telegram Service

**Files:**
- Create: `packages/api/src/services/telegram.ts`
- Create: `packages/api/src/routes/telegram.ts`

- [ ] **Step 1: Create the Telegram service**

Create `packages/api/src/services/telegram.ts`:

```typescript
import type { Env } from '../types';

interface SendMessageParams {
  chatId: string;
  text: string;
  token: string;
}

export async function sendTelegramMessage({ chatId, text, token }: SendMessageParams): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[Telegram] Send failed:', err);
    return false;
  }
}

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
    '📋 <b>Visitor Arrival — OHCS SmartGate</b>',
    '',
    `<b>${visitor.first_name} ${visitor.last_name}</b>${visitor.organisation ? ` (${visitor.organisation})` : ''}`,
  ];

  if (visitor.purpose_raw) lines.push(`Purpose: ${visitor.purpose_raw}`);
  if (visitor.badge_code) lines.push(`Badge: <code>${visitor.badge_code}</code>`);
  lines.push('');
  lines.push(`Checked in at ${time}${visitor.directorate_abbr ? ` • ${visitor.directorate_abbr} Reception` : ''}`);

  return lines.join('\n');
}

export async function generateLinkCode(chatId: string, env: Env): Promise<string> {
  const code = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await env.KV.put(`telegram-link:${code}`, chatId, { expirationTtl: 600 });
  return code;
}

export async function consumeLinkCode(code: string, env: Env): Promise<string | null> {
  const chatId = await env.KV.get(`telegram-link:${code}`);
  if (chatId) {
    await env.KV.delete(`telegram-link:${code}`);
  }
  return chatId;
}
```

- [ ] **Step 2: Create the Telegram routes**

Create `packages/api/src/routes/telegram.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { generateLinkCode, consumeLinkCode, sendTelegramMessage } from '../services/telegram';
import { success, error } from '../lib/response';

export const telegramRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Public webhook — receives updates from Telegram
telegramRoutes.post('/webhook', async (c) => {
  const body = await c.req.json() as {
    message?: { chat?: { id: number }; text?: string };
  };

  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim();

  if (!chatId || !text) return c.json({ ok: true });

  if (text === '/start') {
    const code = await generateLinkCode(String(chatId), c.env);
    const appUrl = c.env.ENVIRONMENT === 'production'
      ? 'https://smartgate.ohcs.gov.gh'
      : 'http://localhost:5173';

    await sendTelegramMessage({
      chatId: String(chatId),
      text: `Welcome to <b>OHCS SmartGate</b>! 🇬🇭\n\nTo receive visitor notifications, link your account:\n\n<a href="${appUrl}/link-telegram?code=${code}">Click here to link your account</a>\n\nThis link expires in 10 minutes.`,
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
  }

  return c.json({ ok: true });
});

// Protected — link Telegram account to officer
const linkSchema = z.object({ code: z.string().min(1) });

telegramRoutes.post('/link', zValidator('json', linkSchema), async (c) => {
  const { code } = c.req.valid('json');
  const session = c.get('session');

  const chatId = await consumeLinkCode(code, c.env);
  if (!chatId) {
    return error(c, 'INVALID_CODE', 'Link code is invalid or expired', 400);
  }

  // Find officer by the logged-in user's email
  const officer = await c.env.DB.prepare(
    'SELECT id FROM officers WHERE email = ?'
  ).bind(session.email).first<{ id: string }>();

  if (!officer) {
    return error(c, 'NOT_OFFICER', 'No officer record found for your account', 404);
  }

  await c.env.DB.prepare(
    'UPDATE officers SET telegram_chat_id = ? WHERE id = ?'
  ).bind(chatId, officer.id).run();

  // Confirm to user via Telegram
  await sendTelegramMessage({
    chatId,
    text: `✅ Account linked! You'll now receive visitor arrival notifications for <b>${session.name}</b>.`,
    token: c.env.TELEGRAM_BOT_TOKEN,
  });

  return success(c, { message: 'Telegram account linked successfully' });
});

```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/telegram.ts packages/api/src/routes/telegram.ts
git commit -m "feat: add Telegram bot service and linking routes"
```

---

## Task 4: Notification Service + Routes

**Files:**
- Create: `packages/api/src/services/notifier.ts`
- Create: `packages/api/src/routes/notifications.ts`
- Modify: `packages/api/src/routes/visits.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Create the notifier service**

Create `packages/api/src/services/notifier.ts`:

```typescript
import type { Env } from '../types';
import { sendTelegramMessage, formatVisitorArrivalMessage } from './telegram';

interface VisitNotifyData {
  visit_id: string;
  host_officer_id: string;
  first_name: string;
  last_name: string;
  organisation: string | null;
  purpose_raw: string | null;
  badge_code: string | null;
  check_in_at: string;
  directorate_abbr: string | null;
}

export async function notifyHostOfficer(data: VisitNotifyData, env: Env): Promise<void> {
  // Look up officer details
  const officer = await env.DB.prepare(
    'SELECT id, name, email, telegram_chat_id FROM officers WHERE id = ?'
  ).bind(data.host_officer_id).first<{
    id: string; name: string; email: string | null; telegram_chat_id: string | null;
  }>();

  if (!officer) return;

  // 1. Send Telegram notification
  if (officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    const message = formatVisitorArrivalMessage(data);
    await sendTelegramMessage({
      chatId: officer.telegram_chat_id,
      text: message,
      token: env.TELEGRAM_BOT_TOKEN,
    });
  }

  // 2. Create in-app notification (if officer has a user account)
  if (officer.email) {
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(officer.email).first<{ id: string }>();

    if (user) {
      const notifId = crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, visit_id)
         VALUES (?, ?, 'visitor_arrival', ?, ?, ?)`
      ).bind(
        notifId,
        user.id,
        `Visitor: ${data.first_name} ${data.last_name}`,
        `${data.organisation ? `From ${data.organisation} — ` : ''}${data.purpose_raw || 'No purpose stated'}`,
        data.visit_id
      ).run();
    }
  }
}
```

- [ ] **Step 2: Create the notifications routes**

Create `packages/api/src/routes/notifications.ts`:

```typescript
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const listSchema = z.object({
  unread_only: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

notificationRoutes.get('/', zValidator('query', listSchema), async (c) => {
  const session = c.get('session');
  const { unread_only, limit } = c.req.valid('query');

  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params: unknown[] = [session.userId];

  if (unread_only === 'true') {
    sql += ' AND is_read = 0';
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

notificationRoutes.get('/unread-count', async (c) => {
  const session = c.get('session');
  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(session.userId).first<{ count: number }>();

  return success(c, { count: result?.count ?? 0 });
});

notificationRoutes.post('/:id/read', async (c) => {
  const session = c.get('session');
  const id = c.req.param('id');

  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
  ).bind(id, session.userId).run();

  return success(c, { message: 'Marked as read' });
});

notificationRoutes.post('/read-all', async (c) => {
  const session = c.get('session');

  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
  ).bind(session.userId).run();

  return success(c, { message: 'All marked as read' });
});
```

- [ ] **Step 3: Wire notifier into check-in route**

In `packages/api/src/routes/visits.ts`, add the import:

```typescript
import { notifyHostOfficer } from '../services/notifier';
```

In the `POST /check-in` handler, after the existing `waitUntil` for classification, add another `waitUntil` for notifications. Add this right before `return created(c, visit);`:

```typescript
  // Notify host officer in background (Telegram + in-app)
  if (body.host_officer_id) {
    c.executionCtx.waitUntil(
      notifyHostOfficer({
        visit_id: visitId,
        host_officer_id: body.host_officer_id,
        first_name: (visit as { first_name: string }).first_name,
        last_name: (visit as { last_name: string }).last_name,
        organisation: (visit as { organisation: string | null }).organisation,
        purpose_raw: body.purpose_raw || null,
        badge_code: badgeCode,
        check_in_at: (visit as { check_in_at: string }).check_in_at,
        directorate_abbr: (visit as { directorate_abbr: string | null }).directorate_abbr,
      }, c.env)
    );
  }
```

- [ ] **Step 4: Register new routes in index.ts**

In `packages/api/src/index.ts`, add imports:

```typescript
import { notificationRoutes } from './routes/notifications';
import { telegramRoutes } from './routes/telegram';
```

Add the Telegram webhook route BEFORE the auth middleware (it's a public endpoint):

```typescript
app.route('/api/telegram', telegramRoutes);
```

Wait — the `/api/telegram/webhook` needs to be public, but `/api/telegram/link` needs auth. Split the registration. Instead, register the full route before the auth middleware and handle auth inside the link handler. Actually, the simpler approach: register the webhook outside the auth middleware and the link inside. Update `index.ts` to:

```typescript
// Public routes (no auth)
app.route('/api/auth', authRoutes);

// Telegram webhook is public
app.post('/api/telegram/webhook', async (c) => {
  const { telegramRoutes } = await import('./routes/telegram');
  const route = new Hono<{ Bindings: Env }>();
  route.post('/', telegramRoutes.fetch);
  return telegramRoutes.fetch(c.req.raw, c.env, c.executionCtx);
});
```

No, this is overcomplicating it. The cleanest approach: split the telegram webhook into a separate one-off route. Update `index.ts`:

```typescript
import { telegramWebhook, telegramLinkRoute } from './routes/telegram';

// ...after authRoutes, before authMiddleware:
app.post('/api/telegram/webhook', telegramWebhook);

// ...after authMiddleware:
app.post('/api/telegram/link', telegramLinkRoute);
app.route('/api/notifications', notificationRoutes);
```

And update `packages/api/src/routes/telegram.ts` to export individual handlers instead of a Hono router:

Replace the file content with:

```typescript
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { generateLinkCode, consumeLinkCode, sendTelegramMessage } from '../services/telegram';
import { success, error } from '../lib/response';

// Public — receives updates from Telegram
export async function telegramWebhook(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json() as {
    message?: { chat?: { id: number }; text?: string };
  };

  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim();

  if (!chatId || !text) return c.json({ ok: true });

  if (text === '/start') {
    const code = await generateLinkCode(String(chatId), c.env);
    const appUrl = c.env.ENVIRONMENT === 'production'
      ? 'https://smartgate.ohcs.gov.gh'
      : 'http://localhost:5173';

    await sendTelegramMessage({
      chatId: String(chatId),
      text: `Welcome to <b>OHCS SmartGate</b>! 🇬🇭\n\nTo receive visitor notifications, link your account:\n\n<a href="${appUrl}/link-telegram?code=${code}">Click here to link your account</a>\n\nThis link expires in 10 minutes.`,
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
  }

  return c.json({ ok: true });
}

// Protected — link Telegram account to officer
const linkSchema = z.object({ code: z.string().min(1) });

export async function telegramLinkRoute(c: Context<{ Bindings: Env; Variables: { session: SessionData } }>) {
  const body = await c.req.json();
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 'VALIDATION_ERROR', 'Missing link code', 400);
  }

  const { code } = parsed.data;
  const session = c.get('session');

  const chatId = await consumeLinkCode(code, c.env);
  if (!chatId) {
    return error(c, 'INVALID_CODE', 'Link code is invalid or expired', 400);
  }

  const officer = await c.env.DB.prepare(
    'SELECT id FROM officers WHERE email = ?'
  ).bind(session.email).first<{ id: string }>();

  if (!officer) {
    return error(c, 'NOT_OFFICER', 'No officer record found for your account', 404);
  }

  await c.env.DB.prepare(
    'UPDATE officers SET telegram_chat_id = ? WHERE id = ?'
  ).bind(chatId, officer.id).run();

  await sendTelegramMessage({
    chatId,
    text: `✅ Account linked! You'll now receive visitor arrival notifications for <b>${session.name}</b>.`,
    token: c.env.TELEGRAM_BOT_TOKEN,
  });

  return success(c, { message: 'Telegram account linked successfully' });
}
```

The full updated `packages/api/src/index.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { visitorRoutes } from './routes/visitors';
import { visitRoutes } from './routes/visits';
import { officerRoutes } from './routes/officers';
import { directorateRoutes } from './routes/directorates';
import { notificationRoutes } from './routes/notifications';
import { telegramWebhook, telegramLinkRoute } from './routes/telegram';
import { badgeRoutes, serveBadgePage } from './routes/badges';
import { assistantRoutes } from './routes/assistant';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';

const app = new Hono<{ Bindings: Env; Variables: { session: import('./types').SessionData } }>();

app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:8788'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.onError(errorHandler);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public routes (no auth)
app.route('/api/auth', authRoutes);
app.route('/api/badges', badgeRoutes);
app.get('/badge/:code', serveBadgePage);
app.post('/api/telegram/webhook', telegramWebhook);

// Protected routes
app.use('/api/*', authMiddleware);
app.route('/api/visitors', visitorRoutes);
app.route('/api/visits', visitRoutes);
app.route('/api/officers', officerRoutes);
app.route('/api/directorates', directorateRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/assistant', assistantRoutes);
app.post('/api/telegram/link', telegramLinkRoute);

export default app;
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/notifier.ts packages/api/src/routes/notifications.ts packages/api/src/routes/telegram.ts packages/api/src/routes/visits.ts packages/api/src/index.ts
git commit -m "feat: add notification service, Telegram integration, and notification routes"
```

---

## Task 5: Digital Badge (API + Server-Rendered Page)

**Files:**
- Create: `packages/api/src/routes/badges.ts`
- Modify: `packages/api/src/routes/visits.ts` (badge code generation)

- [ ] **Step 1: Update badge code generation**

In `packages/api/src/routes/visits.ts`, update the badge code generation in the check-in handler. Replace:

```typescript
  const badgeCode = `SG-${Date.now().toString(36).toUpperCase()}`;
```

With:

```typescript
  const randomSuffix = Array.from(crypto.getRandomValues(new Uint8Array(2)))
    .map(b => b.toString(36)).join('').slice(0, 4).toUpperCase();
  const badgeCode = `SG-${Date.now().toString(36).toUpperCase()}${randomSuffix}`;
```

- [ ] **Step 2: Create the badge routes and HTML page**

Create `packages/api/src/routes/badges.ts`:

```typescript
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { success, notFound } from '../lib/response';

export const badgeRoutes = new Hono<{ Bindings: Env }>();

interface BadgeData {
  badge_code: string;
  status: string;
  visitor_name: string;
  organisation: string | null;
  host_name: string | null;
  directorate: string | null;
  directorate_abbr: string | null;
  floor: string | null;
  wing: string | null;
  check_in_at: string;
  check_out_at: string | null;
}

// Public JSON API
badgeRoutes.get('/:code', async (c) => {
  const code = c.req.param('code');

  const visit = await c.env.DB.prepare(
    `SELECT v.badge_code, v.status, v.check_in_at, v.check_out_at,
            vis.first_name || ' ' || vis.last_name as visitor_name,
            vis.organisation,
            o.name as host_name,
            d.name as directorate, d.abbreviation as directorate_abbr,
            d.floor, d.wing
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.badge_code = ?`
  ).bind(code).first<BadgeData>();

  if (!visit) return notFound(c, 'Badge');

  return success(c, visit);
});

// Public HTML badge page
export async function serveBadgePage(c: Context<{ Bindings: Env }>) {
  const code = c.req.param('code');

  const visit = await c.env.DB.prepare(
    `SELECT v.badge_code, v.status, v.check_in_at, v.check_out_at,
            vis.first_name || ' ' || vis.last_name as visitor_name,
            vis.organisation,
            o.name as host_name,
            d.name as directorate, d.abbreviation as directorate_abbr,
            d.floor, d.wing
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.badge_code = ?`
  ).bind(code).first<BadgeData>();

  if (!visit) {
    return c.html(`<!DOCTYPE html><html><body><h1>Badge not found</h1></body></html>`, 404);
  }

  const isActive = visit.status === 'checked_in';
  const checkInTime = new Date(visit.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const checkInDate = new Date(visit.check_in_at).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visitor Badge — OHCS SmartGate</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: #F8F9FA;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
    }
    .badge {
      background: #fff;
      border-radius: 16px;
      max-width: 380px;
      width: 100%;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      border: 1px solid #E5E7EB;
    }
    .header {
      background: #1B3A5C;
      color: #fff;
      padding: 20px 24px;
      text-align: center;
    }
    .header h1 { font-size: 14px; font-weight: 600; letter-spacing: 0.5px; }
    .header .subtitle { font-size: 11px; opacity: 0.7; margin-top: 2px; }
    .status {
      padding: 12px 24px;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .status.active { background: #DCFCE7; color: #16A34A; }
    .status.expired { background: #F3F4F6; color: #6B7280; }
    .content { padding: 24px; }
    .visitor-name { font-size: 22px; font-weight: 700; color: #111827; }
    .organisation { font-size: 13px; color: #6B7280; margin-top: 2px; }
    .details { margin-top: 20px; display: flex; flex-direction: column; gap: 12px; }
    .detail { display: flex; align-items: flex-start; gap: 10px; }
    .detail-label { font-size: 11px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.5px; min-width: 80px; }
    .detail-value { font-size: 14px; color: #111827; font-weight: 500; }
    .badge-code {
      margin-top: 20px;
      text-align: center;
      padding: 16px;
      background: #FEF3C7;
      border-radius: 12px;
    }
    .badge-code span { font-family: monospace; font-size: 20px; font-weight: 700; color: #92400E; letter-spacing: 2px; }
    .badge-code .label { font-size: 11px; color: #92400E; margin-bottom: 4px; }
    .qr-container { margin-top: 20px; text-align: center; }
    .qr-container canvas { border-radius: 8px; }
    .footer {
      padding: 16px 24px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      font-size: 11px;
      color: #9CA3AF;
    }
    .gold-accent { display: block; height: 3px; background: #D4A017; }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div class="badge">
    <div class="header">
      <h1>OHCS SMARTGATE</h1>
      <div class="subtitle">Office of the Head of Civil Service, Ghana</div>
    </div>
    <div class="gold-accent"></div>
    <div class="status ${isActive ? 'active' : 'expired'}">
      ${isActive ? '● Active Visitor' : '○ Visit Ended'}
    </div>
    <div class="content">
      <div class="visitor-name">${escapeHtml(visit.visitor_name)}</div>
      ${visit.organisation ? `<div class="organisation">${escapeHtml(visit.organisation)}</div>` : ''}

      <div class="details">
        ${visit.host_name ? `
        <div class="detail">
          <div class="detail-label">Host</div>
          <div class="detail-value">${escapeHtml(visit.host_name)}</div>
        </div>` : ''}
        ${visit.directorate ? `
        <div class="detail">
          <div class="detail-label">Directorate</div>
          <div class="detail-value">${escapeHtml(visit.directorate)} (${escapeHtml(visit.directorate_abbr ?? '')})</div>
        </div>` : ''}
        ${visit.floor ? `
        <div class="detail">
          <div class="detail-label">Location</div>
          <div class="detail-value">${escapeHtml(visit.floor)}${visit.wing ? `, ${escapeHtml(visit.wing)} Wing` : ''}</div>
        </div>` : ''}
        <div class="detail">
          <div class="detail-label">Date</div>
          <div class="detail-value">${checkInDate}</div>
        </div>
        <div class="detail">
          <div class="detail-label">Check In</div>
          <div class="detail-value">${checkInTime}</div>
        </div>
      </div>

      <div class="badge-code">
        <div class="label">BADGE CODE</div>
        <span>${escapeHtml(visit.badge_code)}</span>
      </div>

      <div class="qr-container" id="qr"></div>
    </div>
    <div class="footer">
      Present this badge to security when requested
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
  <script>
    const qr = qrcode(0, 'M');
    qr.addData(window.location.href);
    qr.make();
    document.getElementById('qr').innerHTML = qr.createSvgTag(5, 0);

    // Auto-refresh status every 60s
    ${isActive ? `setTimeout(() => location.reload(), 60000);` : ''}
  </script>
</body>
</html>`;

  return c.html(html);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/badges.ts packages/api/src/routes/visits.ts
git commit -m "feat: add digital badge API and server-rendered badge page"
```

---

## Task 6: AI Assistant (API)

**Files:**
- Create: `packages/api/src/services/assistant.ts`
- Create: `packages/api/src/routes/assistant.ts`

- [ ] **Step 1: Create the assistant service**

Create `packages/api/src/services/assistant.ts`:

```typescript
import type { Env } from '../types';

const SYSTEM_PROMPT = `You are SmartGate Assistant, an AI helper for receptionists at the Office of the Head of Civil Service (OHCS) in Accra, Ghana.

Your role:
- Help receptionists route visitors to the correct directorate
- Look up officer availability and contact details
- Answer questions about visitor history
- Provide general guidance about OHCS procedures

You have access to lookup functions. When you need data, output a lookup command on its own line:
- LOOKUP_OFFICER:<name> — search officers by name
- LOOKUP_DIRECTORATE:<query> — search directorates by name or abbreviation
- LOOKUP_VISITOR:<name> — search visitors by name
- LOOKUP_STATS:today — get today's visit statistics
- LOOKUP_ACTIVE — get currently active visits

Rules:
- Only answer questions related to OHCS SmartGate operations
- You are read-only — you cannot create visitors, check anyone in, or modify any data
- Keep responses concise (2-3 sentences max)
- Use Ghana conventions: DD/MM/YYYY dates, 12hr time
- If unsure, say so rather than guessing
- Politely decline off-topic requests`;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const LOOKUP_PATTERN = /^LOOKUP_(OFFICER|DIRECTORATE|VISITOR|STATS|ACTIVE):?(.*)$/m;

async function executeLookup(type: string, query: string, env: Env): Promise<string> {
  const q = query.trim();

  switch (type) {
    case 'OFFICER': {
      const results = await env.DB.prepare(
        `SELECT o.name, o.title, o.office_number, o.is_available, o.phone, o.email,
                d.abbreviation as directorate_abbr, d.floor, d.wing
         FROM officers o JOIN directorates d ON o.directorate_id = d.id
         WHERE o.name LIKE ? LIMIT 5`
      ).bind(`%${q}%`).all();
      if (!results.results?.length) return `No officers found matching "${q}".`;
      return results.results.map((o: Record<string, unknown>) =>
        `${o.name} — ${o.title || 'Officer'} (${o.directorate_abbr}), Office: ${o.office_number || 'N/A'}, ${o.floor}/${o.wing}, ${o.is_available ? 'Available' : 'Unavailable'}`
      ).join('\n');
    }

    case 'DIRECTORATE': {
      const results = await env.DB.prepare(
        `SELECT name, abbreviation, floor, wing FROM directorates
         WHERE is_active = 1 AND (name LIKE ? OR abbreviation LIKE ?) LIMIT 5`
      ).bind(`%${q}%`, `%${q}%`).all();
      if (!results.results?.length) return `No directorates found matching "${q}".`;
      return results.results.map((d: Record<string, unknown>) =>
        `${d.abbreviation} — ${d.name}, ${d.floor}, ${d.wing} Wing`
      ).join('\n');
    }

    case 'VISITOR': {
      const results = await env.DB.prepare(
        `SELECT first_name, last_name, organisation, total_visits, last_visit_at FROM visitors
         WHERE first_name LIKE ? OR last_name LIKE ? ORDER BY last_visit_at DESC LIMIT 5`
      ).bind(`%${q}%`, `%${q}%`).all();
      if (!results.results?.length) return `No visitors found matching "${q}".`;
      return results.results.map((v: Record<string, unknown>) => {
        const lastVisit = v.last_visit_at
          ? new Date(v.last_visit_at as string).toLocaleDateString('en-GB')
          : 'Never';
        return `${v.first_name} ${v.last_name}${v.organisation ? ` (${v.organisation})` : ''} — ${v.total_visits} visits, last: ${lastVisit}`;
      }).join('\n');
    }

    case 'STATS': {
      const today = new Date().toISOString().slice(0, 10);
      const results = await env.DB.prepare(
        `SELECT status, COUNT(*) as count FROM visits WHERE DATE(check_in_at) = ? GROUP BY status`
      ).bind(today).all();
      if (!results.results?.length) return 'No visits recorded today.';
      const stats = results.results as Array<{ status: string; count: number }>;
      const total = stats.reduce((sum, s) => sum + s.count, 0);
      const checkedIn = stats.find(s => s.status === 'checked_in')?.count ?? 0;
      const checkedOut = stats.find(s => s.status === 'checked_out')?.count ?? 0;
      return `Today: ${total} total visits, ${checkedIn} currently in building, ${checkedOut} checked out.`;
    }

    case 'ACTIVE': {
      const results = await env.DB.prepare(
        `SELECT vis.first_name, vis.last_name, o.name as host_name, d.abbreviation as dir, v.check_in_at
         FROM visits v
         JOIN visitors vis ON v.visitor_id = vis.id
         LEFT JOIN officers o ON v.host_officer_id = o.id
         LEFT JOIN directorates d ON v.directorate_id = d.id
         WHERE v.status = 'checked_in' ORDER BY v.check_in_at DESC LIMIT 10`
      ).all();
      if (!results.results?.length) return 'No active visits right now.';
      return results.results.map((v: Record<string, unknown>) => {
        const time = new Date(v.check_in_at as string).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true,
        });
        return `${v.first_name} ${v.last_name} → ${v.host_name || 'No host'} (${v.dir || 'N/A'}) since ${time}`;
      }).join('\n');
    }

    default:
      return 'Unknown lookup type.';
  }
}

export async function chat(userMessages: ChatMessage[], env: Env): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...userMessages.slice(-10), // Keep last 10 messages for context window
  ];

  // First call to Workers AI
  const firstResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages,
    max_tokens: 300,
  });

  const firstReply = (firstResponse as { response?: string }).response ?? '';

  // Check for lookup commands
  const match = firstReply.match(LOOKUP_PATTERN);
  if (!match) return firstReply;

  const [, lookupType, lookupQuery] = match;
  const lookupResult = await executeLookup(lookupType!, lookupQuery!, env);

  // Second call with lookup results injected
  const secondMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: firstReply },
    { role: 'system', content: `Lookup result:\n${lookupResult}\n\nNow respond to the user using this data. Be concise.` },
  ];

  const secondResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: secondMessages,
    max_tokens: 300,
  });

  return (secondResponse as { response?: string }).response ?? 'Sorry, I could not process that request.';
}
```

- [ ] **Step 2: Create the assistant route**

Create `packages/api/src/routes/assistant.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { chat } from '../services/assistant';
import { success, error } from '../lib/response';

export const assistantRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(1000),
  })).min(1).max(20),
});

assistantRoutes.post('/chat', zValidator('json', chatSchema), async (c) => {
  const { messages } = c.req.valid('json');

  try {
    const reply = await chat(messages, c.env);
    return success(c, { reply });
  } catch (err) {
    console.error('[Assistant] Error:', err);
    return error(c, 'AI_ERROR', 'The assistant is temporarily unavailable', 503);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/assistant.ts packages/api/src/routes/assistant.ts
git commit -m "feat: add AI assistant service and chat endpoint (Workers AI)"
```

---

## Task 7: Frontend — NotificationBell Component

**Files:**
- Create: `packages/web/src/components/NotificationBell.tsx`
- Modify: `packages/web/src/components/layout/Header.tsx`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add Notification type to api.ts**

In `packages/web/src/lib/api.ts`, add after the existing type exports:

```typescript
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  visit_id: string | null;
  is_read: number;
  created_at: string;
}
```

- [ ] **Step 2: Create the NotificationBell component**

Create `packages/web/src/components/NotificationBell.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Notification } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { Bell, Check, CheckCheck } from 'lucide-react';

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: countData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 30_000,
  });

  const { data: notifData, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<Notification[]>('/notifications?limit=20'),
    enabled: isOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post('/notifications/read-all', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const unreadCount = countData?.data?.count ?? 0;
  const notifications = notifData?.data ?? [];

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative h-9 w-9 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-background transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 flex items-center justify-center rounded-full bg-danger text-white text-[10px] font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-surface rounded-xl border border-border shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllReadMutation.mutate()}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <CheckCheck className="h-3 w-3" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted">No notifications</div>
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => {
                      if (!notif.is_read) markReadMutation.mutate(notif.id);
                    }}
                    className={cn(
                      'w-full text-left px-4 py-3 transition-colors',
                      notif.is_read ? 'bg-surface' : 'bg-info/5 hover:bg-info/10'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {!notif.is_read && (
                        <div className="w-2 h-2 rounded-full bg-info mt-1.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm truncate', notif.is_read ? 'text-foreground' : 'text-foreground font-medium')}>
                          {notif.title}
                        </p>
                        {notif.body && (
                          <p className="text-xs text-muted truncate mt-0.5">{notif.body}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{timeAgo(notif.created_at)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add NotificationBell to the Header**

In `packages/web/src/components/layout/Header.tsx`, add the import:

```typescript
import { NotificationBell } from '../NotificationBell';
```

Add the bell between the date and the user info. Replace the header return with:

```typescript
  return (
    <header className="h-14 bg-surface border-b border-border px-6 flex items-center justify-between shrink-0">
      <div>
        <p className="text-xs text-muted">{formatDate(new Date().toISOString())} — Office of the Head of Civil Service</p>
      </div>
      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="text-right">
          <p className="text-sm font-medium text-foreground">{user?.name}</p>
          <p className="text-xs text-muted capitalize">{user?.role}</p>
        </div>
        <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-semibold">
          {user?.name?.charAt(0) ?? '?'}
        </div>
      </div>
    </header>
  );
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/NotificationBell.tsx packages/web/src/components/layout/Header.tsx packages/web/src/lib/api.ts
git commit -m "feat: add in-app notification bell with unread count"
```

---

## Task 8: Frontend — Chat Bubble + Panel

**Files:**
- Create: `packages/web/src/stores/chat.ts`
- Create: `packages/web/src/components/chat/ChatBubble.tsx`
- Create: `packages/web/src/components/chat/ChatPanel.tsx`
- Modify: `packages/web/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create the chat store**

Create `packages/web/src/stores/chat.ts`:

```typescript
import { create } from 'zustand';
import { api } from '@/lib/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isLoading: boolean;
  toggle: () => void;
  close: () => void;
  sendMessage: (content: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  messages: [],
  isLoading: false,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),

  sendMessage: async (content: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    set((s) => ({ messages: [...s.messages, userMessage], isLoading: true }));

    try {
      const history = get().messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await api.post<{ reply: string }>('/assistant/chat', {
        messages: history,
      });

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.data?.reply ?? 'Sorry, I could not process that.',
        timestamp: Date.now(),
      };

      set((s) => ({ messages: [...s.messages, assistantMessage], isLoading: false }));
    } catch {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Sorry, I am temporarily unavailable. Please try again later.',
        timestamp: Date.now(),
      };

      set((s) => ({ messages: [...s.messages, errorMessage], isLoading: false }));
    }
  },
}));
```

- [ ] **Step 2: Create ChatBubble component**

Create `packages/web/src/components/chat/ChatBubble.tsx`:

```typescript
import { useChatStore } from '@/stores/chat';
import { MessageCircle, X } from 'lucide-react';
import { ChatPanel } from './ChatPanel';

export function ChatBubble() {
  const { isOpen, toggle } = useChatStore();

  return (
    <>
      {isOpen && <ChatPanel />}
      <button
        onClick={toggle}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-primary text-white rounded-full shadow-lg hover:bg-primary-light transition-all flex items-center justify-center hover:scale-105 active:scale-95"
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}
```

- [ ] **Step 3: Create ChatPanel component**

Create `packages/web/src/components/chat/ChatPanel.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { Send, Bot, User } from 'lucide-react';

export function ChatPanel() {
  const { messages, isLoading, sendMessage } = useChatStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    await sendMessage(text);
  }

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[360px] h-[500px] bg-surface rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-primary px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">SmartGate Assistant</h3>
          <p className="text-[10px] text-white/60">Powered by AI</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted">Hi! I can help with:</p>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>"Which directorate handles pensions?"</p>
              <p>"Is Mr. Mensah available?"</p>
              <p>"How many visitors today?"</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'flex gap-2',
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="h-3.5 w-3.5" />
              </div>
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-xl px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-br-sm'
                  : 'bg-background text-foreground border border-border rounded-bl-sm'
              )}
            >
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2 justify-start">
            <div className="w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div className="bg-background border border-border rounded-xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border px-3 py-2.5 flex gap-2 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="h-9 w-9 bg-primary text-white rounded-lg flex items-center justify-center hover:bg-primary-light transition-colors disabled:opacity-50 shrink-0"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add ChatBubble to AppLayout**

In `packages/web/src/components/layout/AppLayout.tsx`, add the import and the component:

```typescript
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatBubble } from '../chat/ChatBubble';

export function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto bg-background p-6">
          <Outlet />
        </main>
      </div>
      <ChatBubble />
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/chat.ts packages/web/src/components/chat/ChatBubble.tsx packages/web/src/components/chat/ChatPanel.tsx packages/web/src/components/layout/AppLayout.tsx
git commit -m "feat: add AI assistant floating chat bubble and panel"
```

---

## Task 9: Frontend — QR Badge on Check-In Success + Telegram Link Page

**Files:**
- Modify: `packages/web/src/pages/CheckInPage.tsx`
- Create: `packages/web/src/pages/LinkTelegramPage.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Install qrcode package**

```bash
cd packages/web && npm install qrcode @types/qrcode
```

- [ ] **Step 2: Add QR code to CheckInPage success step**

In `packages/web/src/pages/CheckInPage.tsx`, add the import at the top:

```typescript
import QRCode from 'qrcode';
import { useEffect, useRef } from 'react';
```

(Note: `useState` and `useMemo` are already imported, add `useEffect` and `useRef` to the existing import.)

Then replace the success step (the `{step === 'success' && createdVisit && (` block) with:

```typescript
      {/* STEP 4: Success */}
      {step === 'success' && createdVisit && (
        <div className="bg-surface rounded-xl border border-border shadow-sm p-8 text-center space-y-4">
          <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Visitor Checked In</h2>
            <p className="text-sm text-muted mt-1">
              {createdVisit.first_name} {createdVisit.last_name} has been checked in successfully
            </p>
          </div>

          {createdVisit.badge_code && (
            <>
              <div className="inline-flex items-center gap-2 h-10 px-4 bg-accent/10 rounded-lg">
                <span className="text-xs text-muted">Badge:</span>
                <span className="text-sm font-mono font-bold text-accent">{createdVisit.badge_code}</span>
              </div>

              <div className="pt-2">
                <p className="text-xs text-muted mb-3">Have the visitor scan this code for their digital badge</p>
                <BadgeQRCode badgeCode={createdVisit.badge_code} />
              </div>
            </>
          )}

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={reset}
              className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
            >
              Check In Another
            </button>
            <button
              onClick={() => navigate('/')}
              className="h-10 px-5 bg-surface text-foreground text-sm font-medium rounded-lg border border-border hover:bg-background transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      )}
```

Add the `BadgeQRCode` component at the bottom of the file (before the final export or after the existing helper components):

```typescript
function BadgeQRCode({ badgeCode }: { badgeCode: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      const badgeUrl = `${window.location.origin}/badge/${badgeCode}`;
      QRCode.toCanvas(canvasRef.current, badgeUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1B3A5C', light: '#FFFFFF' },
      });
    }
  }, [badgeCode]);

  return <canvas ref={canvasRef} className="mx-auto rounded-lg" />;
}
```

- [ ] **Step 3: Create the Telegram linking page**

Create `packages/web/src/pages/LinkTelegramPage.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export function LinkTelegramPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const code = searchParams.get('code');

  const [status, setStatus] = useState<'linking' | 'success' | 'error'>('linking');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!code) {
      setStatus('error');
      setErrorMsg('No linking code provided.');
      return;
    }

    api.post('/telegram/link', { code })
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Failed to link account');
      });
  }, [code]);

  return (
    <div className="max-w-sm mx-auto text-center space-y-4">
      {status === 'linking' && (
        <>
          <Loader2 className="h-10 w-10 text-primary mx-auto animate-spin" />
          <h2 className="text-lg font-semibold text-foreground">Linking Telegram...</h2>
          <p className="text-sm text-muted">Connecting your Telegram account to SmartGate</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Telegram Linked!</h2>
          <p className="text-sm text-muted">
            You will now receive visitor arrival notifications on Telegram.
          </p>
          <button
            onClick={() => navigate('/')}
            className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
          >
            Go to Dashboard
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="w-14 h-14 bg-danger/10 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-danger" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">Linking Failed</h2>
          <p className="text-sm text-muted">{errorMsg}</p>
          <button
            onClick={() => navigate('/')}
            className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
          >
            Go to Dashboard
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update App.tsx with new routes**

In `packages/web/src/App.tsx`, add the imports:

```typescript
import { LinkTelegramPage } from './pages/LinkTelegramPage';
import { BadgeCheckoutPage } from './pages/BadgeCheckoutPage';
```

Add routes inside the protected `<Route>` group, after the visitors/:id route:

```typescript
            <Route path="link-telegram" element={<LinkTelegramPage />} />
            <Route path="checkout/:code" element={<BadgeCheckoutPage />} />
```

- [ ] **Step 4b: Create BadgeCheckoutPage**

Create `packages/web/src/pages/BadgeCheckoutPage.tsx`:

```typescript
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CheckCircle2, LogOut, Loader2 } from 'lucide-react';

interface BadgeData {
  badge_code: string;
  status: string;
  visitor_name: string;
  organisation: string | null;
  host_name: string | null;
  directorate_abbr: string | null;
}

export function BadgeCheckoutPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [checkedOut, setCheckedOut] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['badge', code],
    queryFn: () => api.get<BadgeData>(`/badges/${code}`),
    enabled: !!code,
  });

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      // Look up visit ID by badge code, then check out
      const visits = await api.get<Array<{ id: string }>>(`/visits?badge_code=${code}&limit=1`);
      const visitId = visits.data?.[0]?.id;
      if (!visitId) throw new Error('Visit not found');
      return api.post(`/visits/${visitId}/check-out`, {});
    },
    onSuccess: () => {
      setCheckedOut(true);
      queryClient.invalidateQueries({ queryKey: ['visits'] });
    },
  });

  const badge = data?.data;

  if (isLoading) {
    return (
      <div className="max-w-sm mx-auto text-center py-12">
        <Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" />
      </div>
    );
  }

  if (isError || !badge) {
    return (
      <div className="max-w-sm mx-auto text-center py-12 space-y-3">
        <p className="text-sm text-muted">Badge not found</p>
        <button onClick={() => navigate('/')} className="text-sm text-primary hover:underline">
          Go to Dashboard
        </button>
      </div>
    );
  }

  if (checkedOut || badge.status !== 'checked_in') {
    return (
      <div className="max-w-sm mx-auto text-center py-12 space-y-4">
        <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {checkedOut ? 'Visitor Checked Out' : 'Visit Already Ended'}
        </h2>
        <p className="text-sm text-muted">{badge.visitor_name} — {badge.badge_code}</p>
        <button onClick={() => navigate('/')} className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors">
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto text-center py-12 space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Check Out Visitor?</h2>
      <div className="bg-surface rounded-xl border border-border p-4 space-y-1">
        <p className="text-base font-medium text-foreground">{badge.visitor_name}</p>
        {badge.organisation && <p className="text-sm text-muted">{badge.organisation}</p>}
        <p className="text-xs text-muted">
          {badge.host_name && `Host: ${badge.host_name}`}
          {badge.directorate_abbr && ` • ${badge.directorate_abbr}`}
        </p>
        <p className="text-xs font-mono text-accent mt-2">{badge.badge_code}</p>
      </div>
      <button
        onClick={() => checkOutMutation.mutate()}
        disabled={checkOutMutation.isPending}
        className="h-10 px-5 bg-danger text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50 inline-flex items-center gap-2"
      >
        <LogOut className="h-4 w-4" />
        {checkOutMutation.isPending ? 'Checking out...' : 'Confirm Check Out'}
      </button>
    </div>
  );
}
```

Note: The `BadgeCheckoutPage` needs the visits API to support lookup by badge code. Add a query param to the existing visits list endpoint. In `packages/api/src/routes/visits.ts`, in the GET `/` handler, add a condition for `badge_code` after the existing conditions block:

In the `listSchema`, add:
```typescript
  badge_code: z.string().optional(),
```

In the conditions block, add:
```typescript
  if (badge_code) {
    conditions.push('v.badge_code = ?');
    params.push(badge_code);
  }
```

And destructure `badge_code` from `c.req.valid('query')`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/CheckInPage.tsx packages/web/src/pages/LinkTelegramPage.tsx packages/web/src/App.tsx packages/web/package.json package-lock.json
git commit -m "feat: add QR badge display on check-in and Telegram linking page"
```

---

## Task 10: Final Integration — Register All Routes + Type Check + Test

**Files:**
- Modify: `packages/api/src/index.ts` (already done in plan above, verify it's correct)
- All files from previous tasks

- [ ] **Step 1: Verify index.ts has all routes registered**

The final `packages/api/src/index.ts` should match the version shown in Task 4, Step 4. Verify it includes:
- `badgeRoutes` and `serveBadgePage` imports from `./routes/badges`
- `assistantRoutes` import from `./routes/assistant`
- `notificationRoutes` import from `./routes/notifications`
- `telegramWebhook` and `telegramLinkRoute` imports from `./routes/telegram`
- Public routes: `/api/auth`, `/api/badges`, `/badge/:code`, `/api/telegram/webhook`
- Protected routes: `/api/visitors`, `/api/visits`, `/api/officers`, `/api/directorates`, `/api/notifications`, `/api/assistant`, `/api/telegram/link`

- [ ] **Step 2: Run TypeScript type-check on API**

```bash
cd packages/api && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Run TypeScript type-check on frontend**

```bash
cd packages/web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Start both servers and verify**

Terminal 1:
```bash
cd packages/api && npx wrangler dev --port 8787
```

Terminal 2:
```bash
cd packages/web && npx vite --port 5173
```

- [ ] **Step 5: Apply migration to local DB**

```bash
cd packages/api && npx wrangler d1 execute smartgate-db --local --file=src/db/migration-phase2.sql
```

- [ ] **Step 6: Test endpoints**

Test badge endpoint:
```bash
curl -s http://localhost:8787/api/badges/SG-MO045UJ2
```
Expected: badge JSON or 404.

Test notification endpoints (with auth):
```bash
curl -s -b cookies.txt http://localhost:8787/api/notifications
curl -s -b cookies.txt http://localhost:8787/api/notifications/unread-count
```

Test assistant endpoint:
```bash
curl -s -b cookies.txt -X POST http://localhost:8787/api/assistant/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"How many visitors today?"}]}'
```

- [ ] **Step 7: Test frontend in browser**

Open http://localhost:5173, log in, verify:
- Notification bell in header (shows 0 count)
- Chat bubble in bottom-right corner
- Chat panel opens/closes
- Check-in flow shows QR code on success

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 2 — AI classification, notifications, badges, assistant"
```
