# OHCS SmartGate — Phase 1: Foundation Design

**Date:** 2026-04-14
**Status:** Approved
**Author:** Claude + Ozzy

## Goal

Build the core visitor management loop: receptionist logs in, searches/creates visitors, checks them in, sees them in the live feed, and checks them out. Cloudflare-native monorepo with D1, Workers (Hono), and React + Vite frontend.

## Architecture

- **Monorepo** with npm workspaces: `packages/api` (Cloudflare Worker) + `packages/web` (React SPA on Pages)
- **API**: Hono router on Cloudflare Workers, D1 for persistence, KV for OTP/sessions
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Zustand + TanStack Query + React Hook Form + Zod
- **Auth**: Email OTP (codes logged to console in dev, real KV-backed architecture)

## Design Tokens (OHCS Brand)

| Token | Value | Purpose |
|---|---|---|
| Primary | `#1B3A5C` | Deep navy — authority, government |
| Accent | `#D4A017` | Gold — Ghana flag reference |
| Secondary | `#2A9D8F` | Teal — modernity |
| Background | `#F8F9FA` | Off-white with warm undertone |
| Surface | `#FFFFFF` | Cards/panels |
| Success | `#22C55E` | Checked-in status |
| Warning | `#F59E0B` | Waiting status |
| Info | `#3B82F6` | With-host status |
| Muted | `#9CA3AF` | Checked-out status |
| Error | `#EF4444` | Alerts/overstay |

**Typography:** Inter for UI, system font stack fallback.

## Database Schema (Phase 1)

### users
```sql
id, name, email, role (receptionist|admin|director|officer), password_hash, is_active, last_login_at, created_at, updated_at
```

### directorates
```sql
id, name, abbreviation, floor, wing, head_officer_id, is_active, created_at
```

### officers
```sql
id, name, title, directorate_id (FK), email, phone, office_number, is_available, created_at, updated_at
```

### visitors
```sql
id, first_name, last_name, phone, email, organisation, id_type, id_number, total_visits, last_visit_at, created_at, updated_at
```

### visit_categories
```sql
id, name, slug, directorate_hint_id (FK nullable), is_active
```

### visits
```sql
id, visitor_id (FK), host_officer_id (FK), directorate_id (FK), purpose_raw, purpose_category, check_in_at, check_out_at, duration_minutes, badge_code, status (checked_in|checked_out|cancelled), notes, created_by (FK), created_at
```

## Auth Flow

1. `POST /api/auth/login` — accepts email, generates 6-digit OTP, stores in KV (10min TTL), logs to console
2. `POST /api/auth/verify` — validates OTP, creates session in KV (24h TTL), returns httpOnly cookie
3. `POST /api/auth/logout` — deletes session from KV
4. Auth middleware on all `/api/*` routes (except auth endpoints)

## API Endpoints (Phase 1)

```
POST   /api/auth/login
POST   /api/auth/verify
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/visitors?q=&limit=&cursor=
GET    /api/visitors/:id
POST   /api/visitors
PUT    /api/visitors/:id

GET    /api/visits?date=&status=&cursor=
GET    /api/visits/active
POST   /api/visits/check-in
POST   /api/visits/:id/check-out

GET    /api/officers?directorate_id=
GET    /api/officers/:id

GET    /api/directorates
```

## Frontend Routes (Phase 1)

```
/login          — OTP login
/               — Check-in page (split layout: form + live feed)
/visitors       — Visitor search
/visitors/:id   — Visitor profile
```

## Response Envelope

```json
{ "data": ..., "error": null, "meta": { "cursor": "...", "hasMore": true } }
```

## Ghana-Specific

- Phone: validate `0XX XXX XXXX` or `+233 XX XXX XXXX`
- Date display: DD/MM/YYYY
- Time: 12-hour AM/PM
- Working hours: Mon-Fri 8:00 AM - 5:00 PM
