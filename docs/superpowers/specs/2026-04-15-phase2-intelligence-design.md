# OHCS SmartGate — Phase 2: Intelligence Design

**Date:** 2026-04-15
**Status:** Approved
**Author:** Claude + Ozzy

## Goal

Add intelligence and automation to the visitor management loop: auto-classify visit purposes, notify host officers via Telegram and in-app, generate digital visitor badges (paperless), and provide an AI-powered assistant for receptionists. All AI features powered by Cloudflare Workers AI (Llama 3.3 70B) — zero external API costs.

## Scope

| Feature | Priority | Complexity |
|---|---|---|
| AI Classification | High | Low |
| Notifications (Telegram + In-App) | High | Medium |
| Digital Badge (Paperless) | High | Medium |
| AI Assistant (Floating Chat) | Medium | Medium |

**Deferred to Phase 3:** Visitor predictions (needs historical data), analytics dashboard, admin panel, PWA/offline.

---

## 1. AI Classification

### Purpose

Auto-categorize freetext visit purposes into existing `visit_categories` on check-in. Enriches data for Phase 3 analytics and reduces receptionist data-entry burden.

### Flow

1. Receptionist submits check-in with `purpose_raw` (e.g. "Here about my pension documents")
2. Visit is created and response returned immediately
3. Via `waitUntil()`, Worker calls Workers AI to classify the purpose
4. Workers AI returns a category slug (e.g. `document_submission`)
5. Worker updates `visits.purpose_category` with the result
6. If the matched category has a `directorate_hint_id` and no directorate was selected, backfill `visits.directorate_id`

### Workers AI Call

- **Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Binding:** `[ai]` in wrangler.toml
- **System prompt:**
  ```
  You are a visit classifier for OHCS (Office of the Head of Civil Service, Ghana).
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
  - other: Does not fit any category
  ```
- **User message:** The `purpose_raw` text
- **Max tokens:** 20

### Failure Handling

- If Workers AI is unavailable or returns an unrecognized slug, `purpose_category` stays null
- No retry — classification is best-effort enrichment, not critical path
- Log failures for monitoring but don't alert

### Changes Required

- Add `[ai]` binding to `wrangler.toml`
- New file: `packages/api/src/services/classifier.ts`
- Update `packages/api/src/routes/visits.ts` check-in handler to call classifier via `waitUntil()`

---

## 2. Notifications

### 2a. Telegram Bot

#### Setup

- Create bot via BotFather (one-time manual step)
- Bot token stored as Worker secret: `TELEGRAM_BOT_TOKEN`
- Bot name: `@OHCSSmartGateBot` (or similar)

#### Officer Linking Flow

1. Officer sends `/start` to the bot on Telegram
2. Bot replies with a unique linking URL: `https://smartgate.ohcs.gov.gh/link-telegram?code=XXXXXX`
3. The code is stored in KV with 10-minute TTL: `telegram-link:{code}` → `{chat_id}`
4. Officer opens the URL while logged into SmartGate
5. Frontend calls `POST /api/telegram/link` with the code
6. Worker validates the code from KV, saves the `telegram_chat_id` to the officer's record
7. Bot confirms: "Linked! You'll now receive visitor notifications."

#### Schema Change

```sql
ALTER TABLE officers ADD COLUMN telegram_chat_id TEXT;
```

#### Notification on Check-In

When a visit is created with a `host_officer_id`:

1. Look up the officer's `telegram_chat_id`
2. If present, send via Telegram Bot API (`sendMessage`):
   ```
   📋 Visitor Arrival — OHCS SmartGate

   Ama Darkwa (Ministry of Finance)
   Purpose: Procurement meeting
   Badge: SG-MO045UJ2

   Checked in at 1:56 PM • FAD Reception
   ```
3. Fire via `waitUntil()` — non-blocking

#### Telegram API

- Endpoint: `https://api.telegram.org/bot{token}/sendMessage`
- Payload: `{ chat_id, text, parse_mode: "HTML" }`
- No library needed — simple `fetch()` call

#### Telegram Bot Webhook

- Register a webhook via `setWebhook` to `https://smartgate.ohcs.gov.gh/api/telegram/webhook`
- New endpoint `POST /api/telegram/webhook` handles incoming bot messages
- On `/start` command: generate a random linking code, store in KV (`telegram-link:{code}` → `{chat_id}`, 10min TTL), reply with the linking URL
- This is a public endpoint (Telegram sends updates to it) — validate via Telegram's secret token header

### 2b. In-App Notification Bell

#### New Table

```sql
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

#### API Endpoints

```
GET  /api/notifications?unread_only=true&limit=20
POST /api/notifications/:id/read
POST /api/notifications/read-all
```

#### On Check-In

If the host officer has a corresponding `users` record (looked up via `SELECT id FROM users WHERE email = officers.email`), insert a notification:
- `type`: `visitor_arrival`
- `title`: "Visitor: Ama Darkwa"
- `body`: "From Ministry of Finance — Procurement meeting"
- `visit_id`: the created visit ID

#### Frontend: NotificationBell Component

- Bell icon in the Header, right side
- Unread count badge (red circle with number)
- Click opens a dropdown panel showing recent notifications
- Each notification shows title, body, relative time
- Click a notification → mark as read + navigate to dashboard (or visitor detail)
- "Mark all as read" link at the bottom
- Poll via TanStack Query every 30 seconds (`refetchInterval: 30_000`)

### Changes Required

- New migration: `notifications` table + `officers.telegram_chat_id` column
- New file: `packages/api/src/services/telegram.ts`
- New file: `packages/api/src/routes/notifications.ts`
- New endpoint in `packages/api/src/routes/auth.ts` or new file for Telegram linking
- Update check-in handler to create notifications and send Telegram
- Frontend: `NotificationBell` component in Header
- Frontend: Telegram linking page (simple, only needed by officers)

---

## 3. Digital Badge (Paperless Visitor Pass)

### Concept

After check-in, the visitor receives a digital badge on their phone by scanning a QR code at reception. The badge is a lightweight public web page showing their visit details and a large QR code for security verification.

### Badge URL

Format: `https://smartgate.ohcs.gov.gh/badge/{badge_code}`

Example: `https://smartgate.ohcs.gov.gh/badge/SG-MO045UJ2`

### Public Badge API

```
GET /api/badges/:code
```

Returns (no auth required):
```json
{
  "data": {
    "badge_code": "SG-MO045UJ2",
    "status": "checked_in",
    "visitor_name": "Ama Darkwa",
    "organisation": "Ministry of Finance",
    "host_name": "Mr. Yaw Owusu",
    "directorate": "Finance & Administration Directorate",
    "directorate_abbr": "FAD",
    "floor": "1st Floor",
    "wing": "East",
    "check_in_at": "2026-04-15T13:56:17Z",
    "check_out_at": null
  }
}
```

Security note: badge codes should include a random component to prevent guessing. Update generation from `SG-{base36 timestamp}` to `SG-{base36 timestamp}{4 random alphanumeric chars}` (e.g. `SG-MO045UJ2K7`). The endpoint exposes only visit-relevant info, no IDs or internal data.

### Badge Page (Server-Rendered HTML)

Served by the Worker at `GET /badge/:code` — a standalone HTML page, not part of the React SPA:

- OHCS header: navy background, gold accent, "OHCS SmartGate" text
- Large status banner:
  - Green with "ACTIVE VISITOR" when `status === 'checked_in'`
  - Grey with "VISIT ENDED" when `status === 'checked_out'`
- Visitor name (large) + organisation
- Host officer name + directorate + floor/wing (so visitor knows where to go)
- Check-in time in DD/MM/YYYY 12hr format
- Badge code displayed prominently
- Large QR code encoding the badge URL (generated inline via a lightweight JS QR library or SVG)
- Auto-refreshes status every 60 seconds
- Mobile-optimized: full-width, readable at arm's length

### QR Code at Reception (Check-In Success)

After a successful check-in, the success screen in the React app shows:
- The existing success confirmation
- A large QR code encoding the badge URL
- "Have the visitor scan this code" instruction
- The visitor scans with their phone camera → opens badge page

QR generation in the React app uses the `qrcode` npm package (renders to canvas/SVG).

### Check-Out via Badge Scan

When a receptionist (logged in) scans a visitor's badge QR code:
- The URL `/badge/SG-XXXXX` loads in their browser
- Since they're authenticated, show a "Check Out This Visitor" button on the badge page
- Or: add a route `/checkout/:code` in the React app that looks up the visit and confirms check-out

### Changes Required

- New public endpoint: `GET /api/badges/:code`
- New Worker route: `GET /badge/:code` serving standalone HTML
- Add `qrcode` package to `packages/web`
- Update `CheckInPage` success step to render QR code
- Add check-out-via-scan route in the React app

---

## 4. AI Assistant (Floating Chat)

### Concept

A floating chat bubble on all authenticated pages, powered by Llama 3.3 70B via Workers AI. Helps receptionists with directorate routing, officer lookups, visitor history, and general OHCS guidance.

### Chat Interface

- **Bubble:** 56px circle, bottom-right corner, primary navy color, chat icon
- **Panel:** 360px wide × 500px tall, slides up from bubble
- **Header:** "SmartGate Assistant" with close button
- **Messages:** alternating left (assistant) / right (user) bubbles
- **Input:** text input at bottom with send button
- **State:** conversation stored in Zustand, clears on page refresh

### API

```
POST /api/assistant/chat
```

Request:
```json
{
  "messages": [
    { "role": "user", "content": "Is Mr. Mensah available?" }
  ]
}
```

Response:
```json
{
  "data": {
    "reply": "Yes, Mr. Kwabena Mensah (Director, RSIMD) is currently marked as available. His office is R201 on the 2nd Floor, East Wing."
  }
}
```

### Backend Logic (services/assistant.ts)

#### System Prompt

```
You are SmartGate Assistant, an AI helper for receptionists at the Office of the Head of Civil Service (OHCS) in Accra, Ghana.

Your role:
- Help receptionists route visitors to the correct directorate
- Look up officer availability and contact details
- Answer questions about visitor history
- Provide general guidance about OHCS procedures

You have access to lookup functions. When you need data, output a lookup command on its own line:
- LOOKUP_OFFICER:<name> — search officers by name
- LOOKUP_DIRECTORATE:<query> — search directorates
- LOOKUP_VISITOR:<name> — search visitors by name
- LOOKUP_STATS:today — get today's visit statistics
- LOOKUP_ACTIVE — get currently active visits

Rules:
- Only answer questions related to OHCS SmartGate operations
- You are read-only — you cannot create visitors, check anyone in, or modify any data
- Keep responses concise (2-3 sentences)
- Use Ghana conventions: DD/MM/YYYY dates, 12hr time
- If unsure, say so rather than guessing
- Politely decline off-topic requests
```

#### Lookup Flow

1. Receive user messages, prepend system prompt
2. Call Workers AI with the conversation
3. Parse response for `LOOKUP_*` commands
4. If found: run D1 queries, inject results as a system message, re-prompt Workers AI
5. Return the final response (max one lookup round per message)

#### D1 Queries for Lookups

- `LOOKUP_OFFICER:<name>` → `SELECT name, title, office_number, is_available, directorate_abbr FROM officers JOIN directorates ... WHERE name LIKE ?`
- `LOOKUP_DIRECTORATE:<query>` → `SELECT name, abbreviation, floor, wing FROM directorates WHERE name LIKE ? OR abbreviation LIKE ?`
- `LOOKUP_VISITOR:<name>` → `SELECT first_name, last_name, organisation, total_visits, last_visit_at FROM visitors WHERE first_name LIKE ? OR last_name LIKE ?`
- `LOOKUP_STATS:today` → `SELECT status, COUNT(*) FROM visits WHERE DATE(check_in_at) = ? GROUP BY status`
- `LOOKUP_ACTIVE` → `SELECT first_name, last_name, host_name, directorate_abbr, check_in_at FROM visits JOIN ... WHERE status = 'checked_in'`

#### Guardrails

- Max 20 messages per minute per session (rate limited by middleware)
- Response max tokens: 300
- Single lookup round per message (prevents infinite loops)
- Off-topic requests declined by system prompt

### Changes Required

- New file: `packages/api/src/services/assistant.ts`
- New file: `packages/api/src/routes/assistant.ts`
- Frontend: `ChatBubble.tsx` + `ChatPanel.tsx` components
- Frontend: `stores/chat.ts` Zustand store
- Add to `AppLayout` — render `ChatBubble` inside the protected layout

---

## Schema Migration (Phase 2)

```sql
-- Add Telegram linking to officers
ALTER TABLE officers ADD COLUMN telegram_chat_id TEXT;

-- Notifications table
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

## New API Endpoints (Phase 2)

```
GET    /api/badges/:code              (public, no auth)
GET    /api/notifications?unread_only=&limit=
POST   /api/notifications/:id/read
POST   /api/notifications/read-all
POST   /api/telegram/link
POST   /api/assistant/chat
GET    /badge/:code                   (public HTML page, not API)
```

## New Frontend Components (Phase 2)

```
src/components/NotificationBell.tsx
src/components/chat/ChatBubble.tsx
src/components/chat/ChatPanel.tsx
src/stores/chat.ts
src/pages/LinkTelegramPage.tsx
```

## Updated wrangler.toml

```toml
[ai]
binding = "AI"
```

New secret: `TELEGRAM_BOT_TOKEN`

## Dependencies (Phase 2)

- `qrcode` (npm) — QR code generation for badge display in React app

## Ghana-Specific Considerations

- Telegram notification text uses DD/MM/YYYY and 12hr time
- Badge page displays times in Ghana format
- AI assistant uses Ghana conventions in responses
- All timestamps continue to be stored as UTC, formatted on display
