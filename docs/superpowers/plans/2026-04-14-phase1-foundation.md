# Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core visitor check-in/check-out loop with auth, CRUD API, and React frontend on the Cloudflare stack.

**Architecture:** Monorepo with npm workspaces. `packages/api` is a Cloudflare Worker using Hono for routing, D1 for storage, KV for sessions/OTP. `packages/web` is a React 18 + Vite SPA deployed to Cloudflare Pages. Auth uses email OTP with console-logged codes for dev.

**Tech Stack:** TypeScript strict, Hono, Cloudflare D1/KV/R2, React 18, Vite, Tailwind CSS v4, Zustand, TanStack Query v5, React Hook Form, Zod, Lucide React icons.

---

## File Structure

```
ohcs-smartgate/
├── package.json                          # Monorepo root (npm workspaces)
├── tsconfig.json                         # Base TS config
├── packages/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── wrangler.toml
│   │   └── src/
│   │       ├── index.ts                  # Worker entry + Hono app
│   │       ├── types.ts                  # Env bindings interface
│   │       ├── db/
│   │       │   ├── schema.sql            # Full D1 schema
│   │       │   └── seed.sql              # OHCS directorates + categories
│   │       ├── middleware/
│   │       │   ├── auth.ts               # Session validation middleware
│   │       │   └── error-handler.ts      # Global error handler
│   │       ├── routes/
│   │       │   ├── auth.ts               # Login/verify/logout/me
│   │       │   ├── visitors.ts           # Visitor CRUD + search
│   │       │   ├── visits.ts             # Check-in/check-out + list
│   │       │   ├── officers.ts           # Officer list
│   │       │   └── directorates.ts       # Directorate list
│   │       ├── lib/
│   │       │   ├── response.ts           # Envelope helper { data, error, meta }
│   │       │   └── validation.ts         # Shared Zod schemas
│   │       └── services/
│   │           └── auth.ts               # OTP generation, session mgmt
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx                  # React entry
│           ├── App.tsx                   # Router + providers
│           ├── styles/
│           │   └── tokens.css            # OHCS design tokens
│           ├── lib/
│           │   ├── api.ts                # Fetch wrapper with auth
│           │   ├── utils.ts              # cn(), formatDate, formatPhone
│           │   └── constants.ts          # Status colours, ID types, etc.
│           ├── stores/
│           │   └── auth.ts               # Zustand auth store
│           ├── hooks/
│           │   ├── use-visitors.ts       # TanStack Query hooks for visitors
│           │   ├── use-visits.ts         # TanStack Query hooks for visits
│           │   └── use-officers.ts       # TanStack Query hooks for officers
│           ├── components/
│           │   ├── ui/                   # Reusable primitives
│           │   │   ├── Button.tsx
│           │   │   ├── Input.tsx
│           │   │   ├── Select.tsx
│           │   │   ├── Badge.tsx
│           │   │   ├── Card.tsx
│           │   │   ├── Skeleton.tsx
│           │   │   ├── Toast.tsx
│           │   │   └── EmptyState.tsx
│           │   ├── layout/
│           │   │   ├── Sidebar.tsx
│           │   │   ├── Header.tsx
│           │   │   └── AppLayout.tsx
│           │   ├── check-in/
│           │   │   ├── VisitorSearch.tsx
│           │   │   ├── CheckInForm.tsx
│           │   │   └── LiveFeed.tsx
│           │   └── visitors/
│           │       ├── VisitorList.tsx
│           │       └── VisitorProfile.tsx
│           └── pages/
│               ├── LoginPage.tsx
│               ├── CheckInPage.tsx
│               ├── VisitorsPage.tsx
│               └── VisitorDetailPage.tsx
```

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git repo**

```bash
cd "/c/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate"
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "ohcs-smartgate",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:api": "npm run dev -w packages/api",
    "dev:web": "npm run dev -w packages/web",
    "build:web": "npm run build -w packages/web",
    "type-check": "tsc --noEmit -p packages/api/tsconfig.json && tsc --noEmit -p packages/web/tsconfig.json"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 3: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: Create packages/api/package.json**

```json
{
  "name": "@ohcs/api",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate": "wrangler d1 execute smartgate-db --local --file=src/db/schema.sql",
    "db:seed": "wrangler d1 execute smartgate-db --local --file=src/db/seed.sql"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250410.0",
    "typescript": "^5.8.0",
    "wrangler": "^4.10.0"
  }
}
```

- [ ] **Step 5: Create packages/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 6: Create packages/web/package.json**

```json
{
  "name": "@ohcs/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.68.0",
    "lucide-react": "^0.474.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.54.0",
    "react-router-dom": "^7.5.0",
    "zod": "^3.24.0",
    "zustand": "^5.0.0",
    "@hookform/resolvers": "^5.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.5.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0"
  }
}
```

- [ ] **Step 7: Create packages/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 8: Create .gitignore**

```
node_modules/
dist/
.wrangler/
.dev.vars
*.local
.DS_Store
```

- [ ] **Step 9: Install dependencies**

```bash
npm install
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo with api and web workspaces"
```

---

## Task 2: Wrangler Config + D1 Schema

**Files:**
- Create: `packages/api/wrangler.toml`
- Create: `packages/api/src/db/schema.sql`
- Create: `packages/api/src/db/seed.sql`

- [ ] **Step 1: Create wrangler.toml**

```toml
name = "ohcs-smartgate-api"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "development"

[[d1_databases]]
binding = "DB"
database_name = "smartgate-db"
database_id = "local"

[[kv_namespaces]]
binding = "KV"
id = "local"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "smartgate-storage"
```

- [ ] **Step 2: Create schema.sql**

```sql
-- OHCS SmartGate Schema — Phase 1

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL DEFAULT 'receptionist' CHECK(role IN ('receptionist','admin','director','officer')),
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    last_login_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS directorates (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name            TEXT NOT NULL,
    abbreviation    TEXT NOT NULL UNIQUE,
    floor           TEXT,
    wing            TEXT,
    head_officer_id TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS officers (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name            TEXT NOT NULL,
    title           TEXT,
    directorate_id  TEXT NOT NULL REFERENCES directorates(id),
    email           TEXT,
    phone           TEXT,
    office_number   TEXT,
    is_available    INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0, 1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_officers_directorate ON officers(directorate_id);

CREATE TABLE IF NOT EXISTS visitors (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    phone         TEXT,
    email         TEXT,
    organisation  TEXT,
    id_type       TEXT CHECK(id_type IN ('ghana_card','passport','drivers_license','staff_id','other')),
    id_number     TEXT,
    total_visits  INTEGER NOT NULL DEFAULT 0,
    last_visit_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_visitors_name ON visitors(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_visitors_phone ON visitors(phone);

CREATE TABLE IF NOT EXISTS visit_categories (
    id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    directorate_hint_id TEXT REFERENCES directorates(id),
    is_active           INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS visits (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    visitor_id       TEXT NOT NULL REFERENCES visitors(id),
    host_officer_id  TEXT REFERENCES officers(id),
    directorate_id   TEXT REFERENCES directorates(id),
    purpose_raw      TEXT,
    purpose_category TEXT,
    check_in_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    check_out_at     TEXT,
    duration_minutes INTEGER,
    badge_code       TEXT UNIQUE,
    status           TEXT NOT NULL DEFAULT 'checked_in' CHECK(status IN ('checked_in','checked_out','cancelled')),
    notes            TEXT,
    created_by       TEXT REFERENCES users(id),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_host ON visits(host_officer_id, check_in_at DESC);
```

- [ ] **Step 3: Create seed.sql**

```sql
-- Seed: OHCS Directorates
INSERT OR IGNORE INTO directorates (id, name, abbreviation, floor, wing) VALUES
('dir_rsimd', 'Research, Statistics & Information Management Directorate', 'RSIMD', '2nd Floor', 'East'),
('dir_hrmd', 'Human Resource Management Directorate', 'HRMD', '1st Floor', 'West'),
('dir_ppmed', 'Policy, Planning, Monitoring & Evaluation Directorate', 'PPMED', '3rd Floor', 'East'),
('dir_fad', 'Finance & Administration Directorate', 'FAD', '1st Floor', 'East'),
('dir_cstd', 'Civil Service Training Directorate', 'CSTD', '2nd Floor', 'West'),
('dir_lgs', 'Local Government Service Secretariat', 'LGS', '3rd Floor', 'West'),
('dir_psc', 'Public Services Commission', 'PSC', 'Ground Floor', 'East'),
('dir_ohcs', 'Office of the Head of Civil Service', 'OHCS', '4th Floor', 'Main'),
('dir_ocd', 'Office of the Chief Director', 'OCD', '4th Floor', 'Main');

-- Seed: Visit Categories
INSERT OR IGNORE INTO visit_categories (id, name, slug, directorate_hint_id) VALUES
('cat_meeting', 'Official Meeting', 'official_meeting', NULL),
('cat_docsub', 'Document Submission', 'document_submission', NULL),
('cat_job', 'Job Inquiry / Application', 'job_inquiry', 'dir_hrmd'),
('cat_complaint', 'Complaint / Petition', 'complaint', NULL),
('cat_personal', 'Personal Visit', 'personal_visit', NULL),
('cat_delivery', 'Delivery / Collection', 'delivery', 'dir_fad'),
('cat_appt', 'Scheduled Appointment', 'scheduled_appointment', NULL),
('cat_consult', 'Consultation / Advisory', 'consultation', NULL),
('cat_inspect', 'Inspection / Audit', 'inspection', NULL),
('cat_training', 'Training / Workshop', 'training', 'dir_cstd'),
('cat_interview', 'Interview', 'interview', 'dir_hrmd'),
('cat_other', 'Other', 'other', NULL);

-- Seed: Default admin user (receptionist)
INSERT OR IGNORE INTO users (id, name, email, role) VALUES
('user_admin', 'OHCS Reception', 'reception@ohcs.gov.gh', 'admin');

-- Seed: Sample officers
INSERT OR IGNORE INTO officers (id, name, title, directorate_id, email, office_number) VALUES
('off_mensah', 'Mr. Kwabena Mensah', 'Director', 'dir_rsimd', 'k.mensah@ohcs.gov.gh', 'R201'),
('off_addo', 'Mrs. Abena Addo', 'Deputy Director', 'dir_hrmd', 'a.addo@ohcs.gov.gh', 'H102'),
('off_owusu', 'Mr. Yaw Owusu', 'Principal Officer', 'dir_fad', 'y.owusu@ohcs.gov.gh', 'F105'),
('off_boateng', 'Ms. Akosua Boateng', 'Senior Officer', 'dir_ppmed', 'a.boateng@ohcs.gov.gh', 'P301'),
('off_asante', 'Mr. Kofi Asante', 'Chief Director', 'dir_ocd', 'k.asante@ohcs.gov.gh', 'CD401');
```

- [ ] **Step 4: Create the local D1 database, apply schema, and seed**

```bash
cd packages/api
npx wrangler d1 execute smartgate-db --local --file=src/db/schema.sql
npx wrangler d1 execute smartgate-db --local --file=src/db/seed.sql
```

- [ ] **Step 5: Commit**

```bash
cd ../..
git add -A
git commit -m "feat: add D1 schema, seed data, and wrangler config"
```

---

## Task 3: API Foundation — Types, Helpers, Entry Point

**Files:**
- Create: `packages/api/src/types.ts`
- Create: `packages/api/src/lib/response.ts`
- Create: `packages/api/src/lib/validation.ts`
- Create: `packages/api/src/index.ts`

- [ ] **Step 1: Create types.ts**

```typescript
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  STORAGE: R2Bucket;
  ENVIRONMENT: string;
}

export interface SessionData {
  userId: string;
  email: string;
  role: string;
  name: string;
}
```

- [ ] **Step 2: Create lib/response.ts**

```typescript
import type { Context } from 'hono';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta?: { cursor?: string; hasMore?: boolean; total?: number };
}

export function success<T>(c: Context, data: T, meta?: ApiResponse<T>['meta'], status = 200) {
  return c.json<ApiResponse<T>>({ data, error: null, meta }, status);
}

export function created<T>(c: Context, data: T) {
  return success(c, data, undefined, 201);
}

export function error(c: Context, code: string, message: string, status = 400, details?: unknown) {
  return c.json<ApiResponse<null>>({ data: null, error: { code, message, details } }, status);
}

export function notFound(c: Context, resource = 'Resource') {
  return error(c, 'NOT_FOUND', `${resource} not found`, 404);
}
```

- [ ] **Step 3: Create lib/validation.ts**

```typescript
import { z } from 'zod';

export const ghanaPhoneSchema = z.string()
  .regex(/^(\+233|0)\d{9}$/, 'Invalid Ghana phone number (e.g. 0241234567 or +233241234567)')
  .optional()
  .or(z.literal(''));

export const idTypeSchema = z.enum(['ghana_card', 'passport', 'drivers_license', 'staff_id', 'other']);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const CreateVisitorSchema = z.object({
  first_name: z.string().min(1).max(100).trim(),
  last_name: z.string().min(1).max(100).trim(),
  phone: ghanaPhoneSchema,
  email: z.string().email().max(255).optional().or(z.literal('')),
  organisation: z.string().max(200).optional().or(z.literal('')),
  id_type: idTypeSchema.optional(),
  id_number: z.string().max(50).optional().or(z.literal('')),
});

export const UpdateVisitorSchema = CreateVisitorSchema.partial();

export const CheckInSchema = z.object({
  visitor_id: z.string().min(1),
  host_officer_id: z.string().optional(),
  directorate_id: z.string().optional(),
  purpose_raw: z.string().max(500).optional(),
  purpose_category: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export const LoginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

export const VerifyOtpSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  code: z.string().length(6),
});
```

- [ ] **Step 4: Create index.ts (Hono app entry)**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { visitorRoutes } from './routes/visitors';
import { visitRoutes } from './routes/visits';
import { officerRoutes } from './routes/officers';
import { directorateRoutes } from './routes/directorates';
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

app.route('/api/auth', authRoutes);

app.use('/api/*', authMiddleware);
app.route('/api/visitors', visitorRoutes);
app.route('/api/visits', visitRoutes);
app.route('/api/officers', officerRoutes);
app.route('/api/directorates', directorateRoutes);

export default app;
```

- [ ] **Step 5: Create middleware/error-handler.ts**

```typescript
import type { Context } from 'hono';

export function errorHandler(err: Error, c: Context) {
  console.error(`[ERROR] ${err.message}`, err.stack);
  return c.json({
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: c.env.ENVIRONMENT === 'development' ? err.message : 'An unexpected error occurred',
    },
  }, 500);
}
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add API foundation — types, response helpers, validation schemas, Hono entry"
```

---

## Task 4: Auth Service + Routes

**Files:**
- Create: `packages/api/src/services/auth.ts`
- Create: `packages/api/src/middleware/auth.ts`
- Create: `packages/api/src/routes/auth.ts`

- [ ] **Step 1: Create services/auth.ts**

```typescript
import type { Env, SessionData } from '../types';

const OTP_TTL = 600; // 10 minutes
const SESSION_TTL = 86400; // 24 hours

export function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, '0');
}

export async function createOtp(email: string, env: Env): Promise<string> {
  const code = generateOtp();
  await env.KV.put(`otp:${email}`, JSON.stringify({ code, attempts: 0 }), { expirationTtl: OTP_TTL });
  console.log(`[DEV OTP] ${email}: ${code}`);
  return code;
}

export async function verifyOtp(email: string, code: string, env: Env): Promise<boolean> {
  const raw = await env.KV.get(`otp:${email}`);
  if (!raw) return false;

  const data = JSON.parse(raw) as { code: string; attempts: number };

  if (data.attempts >= 5) {
    await env.KV.delete(`otp:${email}`);
    return false;
  }

  if (data.code !== code) {
    data.attempts++;
    await env.KV.put(`otp:${email}`, JSON.stringify(data), { expirationTtl: OTP_TTL });
    return false;
  }

  await env.KV.delete(`otp:${email}`);
  return true;
}

export async function createSession(userId: string, email: string, role: string, name: string, env: Env): Promise<string> {
  const sessionId = crypto.randomUUID();
  const session: SessionData = { userId, email, role, name };
  await env.KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return sessionId;
}

export async function getSession(sessionId: string, env: Env): Promise<SessionData | null> {
  const raw = await env.KV.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(sessionId: string, env: Env): Promise<void> {
  await env.KV.delete(`session:${sessionId}`);
}
```

- [ ] **Step 2: Create middleware/auth.ts**

```typescript
import { createMiddleware } from 'hono/factory';
import type { Env, SessionData } from '../types';
import { getSession } from '../services/auth';
import { getCookie } from 'hono/cookie';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionData };
}>(async (c, next) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const session = await getSession(sessionId, c.env);
  if (!session) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, 401);
  }

  c.set('session', session);
  await next();
});
```

- [ ] **Step 3: Create routes/auth.ts**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { Env, SessionData } from '../types';
import { LoginSchema, VerifyOtpSchema } from '../lib/validation';
import { createOtp, verifyOtp, createSession, deleteSession, getSession } from '../services/auth';
import { success, error } from '../lib/response';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

authRoutes.post('/login', zValidator('json', LoginSchema), async (c) => {
  const { email } = c.req.valid('json');

  const user = await c.env.DB.prepare('SELECT id, name, email, role, is_active FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user || !user.is_active) {
    return error(c, 'USER_NOT_FOUND', 'No active account found with this email', 404);
  }

  await createOtp(email, c.env);

  return success(c, { message: 'OTP sent to your email' });
});

authRoutes.post('/verify', zValidator('json', VerifyOtpSchema), async (c) => {
  const { email, code } = c.req.valid('json');

  const valid = await verifyOtp(email, code, c.env);
  if (!valid) {
    return error(c, 'INVALID_OTP', 'Invalid or expired OTP', 401);
  }

  const user = await c.env.DB.prepare('SELECT id, name, email, role FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; name: string; email: string; role: string }>();

  if (!user) {
    return error(c, 'USER_NOT_FOUND', 'User not found', 404);
  }

  const sessionId = await createSession(user.id, user.email, user.role, user.name, c.env);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  setCookie(c, 'session_id', sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 86400,
  });

  return success(c, { user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

authRoutes.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (sessionId) {
    await deleteSession(sessionId, c.env);
  }
  deleteCookie(c, 'session_id', { path: '/' });
  return success(c, { message: 'Logged out' });
});

authRoutes.get('/me', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  }
  const session = await getSession(sessionId, c.env);
  if (!session) {
    return error(c, 'UNAUTHORIZED', 'Session expired', 401);
  }
  return success(c, { user: session });
});
```

- [ ] **Step 4: Add @hono/zod-validator dependency**

```bash
cd packages/api
npm install @hono/zod-validator
```

- [ ] **Step 5: Verify API starts**

```bash
npx wrangler dev
```

Expected: Worker starts on `localhost:8787`. Hit `GET /health` and get `{"status":"ok",...}`.

- [ ] **Step 6: Commit**

```bash
cd ../..
git add -A
git commit -m "feat: add email OTP auth with session management"
```

---

## Task 5: API CRUD Routes — Visitors, Visits, Officers, Directorates

**Files:**
- Create: `packages/api/src/routes/visitors.ts`
- Create: `packages/api/src/routes/visits.ts`
- Create: `packages/api/src/routes/officers.ts`
- Create: `packages/api/src/routes/directorates.ts`

- [ ] **Step 1: Create routes/visitors.ts**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { CreateVisitorSchema, UpdateVisitorSchema, paginationSchema } from '../lib/validation';
import { success, created, notFound, error } from '../lib/response';
import { z } from 'zod';

export const visitorRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const searchSchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

visitorRoutes.get('/', zValidator('query', searchSchema), async (c) => {
  const { q, limit, cursor } = c.req.valid('query');
  let sql = 'SELECT * FROM visitors';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (q && q.length > 0) {
    conditions.push('(first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR organisation LIKE ?)');
    const pattern = `%${q}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  if (cursor) {
    conditions.push('created_at < ?');
    params.push(cursor);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit + 1);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = results.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1] as { created_at: string }).created_at : undefined;

  return success(c, items, { cursor: nextCursor, hasMore });
});

visitorRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  if (!visitor) return notFound(c, 'Visitor');

  const visits = await c.env.DB.prepare(
    `SELECT v.*, o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.visitor_id = ?
     ORDER BY v.check_in_at DESC LIMIT 20`
  ).bind(id).all();

  return success(c, { ...visitor, visits: visits.results ?? [] });
});

visitorRoutes.post('/', zValidator('json', CreateVisitorSchema), async (c) => {
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    `INSERT INTO visitors (id, first_name, last_name, phone, email, organisation, id_type, id_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.first_name, body.last_name, body.phone || null, body.email || null, body.organisation || null, body.id_type || null, body.id_number || null).run();

  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  return created(c, visitor);
});

visitorRoutes.put('/:id', zValidator('json', UpdateVisitorSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(id).first();
  if (!existing) return notFound(c, 'Visitor');

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value || null);
    }
  }
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  if (fields.length > 1) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE visitors SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  return success(c, visitor);
});
```

- [ ] **Step 2: Create routes/visits.ts**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { CheckInSchema } from '../lib/validation';
import { success, created, notFound, error } from '../lib/response';
import { z } from 'zod';

export const visitRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const listSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['checked_in', 'checked_out', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

visitRoutes.get('/', zValidator('query', listSchema), async (c) => {
  const { date, status, limit, cursor } = c.req.valid('query');
  let sql = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation, vis.phone,
             o.name as host_name, d.abbreviation as directorate_abbr
             FROM visits v
             JOIN visitors vis ON v.visitor_id = vis.id
             LEFT JOIN officers o ON v.host_officer_id = o.id
             LEFT JOIN directorates d ON v.directorate_id = d.id`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (date) {
    conditions.push('DATE(v.check_in_at) = ?');
    params.push(date);
  }
  if (status) {
    conditions.push('v.status = ?');
    params.push(status);
  }
  if (cursor) {
    conditions.push('v.check_in_at < ?');
    params.push(cursor);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY v.check_in_at DESC LIMIT ?';
  params.push(limit + 1);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = results.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1] as { check_in_at: string }).check_in_at : undefined;

  return success(c, items, { cursor: nextCursor, hasMore });
});

visitRoutes.get('/active', async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.status = 'checked_in'
     ORDER BY v.check_in_at DESC`
  ).all();

  return success(c, results.results ?? []);
});

visitRoutes.post('/check-in', zValidator('json', CheckInSchema), async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session');

  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(body.visitor_id).first();
  if (!visitor) return notFound(c, 'Visitor');

  const visitId = crypto.randomUUID().replace(/-/g, '');
  const badgeCode = `SG-${Date.now().toString(36).toUpperCase()}`;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO visits (id, visitor_id, host_officer_id, directorate_id, purpose_raw, purpose_category, badge_code, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'checked_in', ?)`
    ).bind(visitId, body.visitor_id, body.host_officer_id || null, body.directorate_id || null,
           body.purpose_raw || null, body.purpose_category || null, badgeCode, session.userId),

    c.env.DB.prepare(
      `UPDATE visitors SET total_visits = total_visits + 1, last_visit_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).bind(body.visitor_id),
  ]);

  const visit = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.id = ?`
  ).bind(visitId).first();

  return created(c, visit);
});

visitRoutes.post('/:id/check-out', async (c) => {
  const id = c.req.param('id');

  const visit = await c.env.DB.prepare('SELECT id, check_in_at, status FROM visits WHERE id = ?').bind(id).first<{ id: string; check_in_at: string; status: string }>();
  if (!visit) return notFound(c, 'Visit');
  if (visit.status !== 'checked_in') return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);

  const checkOutAt = new Date().toISOString();
  const checkInDate = new Date(visit.check_in_at);
  const durationMinutes = Math.round((new Date(checkOutAt).getTime() - checkInDate.getTime()) / 60000);

  await c.env.DB.prepare(
    `UPDATE visits SET status = 'checked_out', check_out_at = ?, duration_minutes = ? WHERE id = ?`
  ).bind(checkOutAt, durationMinutes, id).run();

  const updated = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.id = ?`
  ).bind(id).first();

  return success(c, updated);
});
```

- [ ] **Step 3: Create routes/officers.ts**

```typescript
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';

export const officerRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

officerRoutes.get('/', async (c) => {
  const directorateId = c.req.query('directorate_id');
  let sql = `SELECT o.*, d.name as directorate_name, d.abbreviation as directorate_abbr
             FROM officers o
             JOIN directorates d ON o.directorate_id = d.id`;
  const params: unknown[] = [];

  if (directorateId) {
    sql += ' WHERE o.directorate_id = ?';
    params.push(directorateId);
  }
  sql += ' ORDER BY d.abbreviation, o.name';

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

officerRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const officer = await c.env.DB.prepare(
    `SELECT o.*, d.name as directorate_name, d.abbreviation as directorate_abbr
     FROM officers o JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
  ).bind(id).first();
  if (!officer) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Officer not found' } }, 404);
  return success(c, officer);
});
```

- [ ] **Step 4: Create routes/directorates.ts**

```typescript
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';

export const directorateRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

directorateRoutes.get('/', async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT * FROM directorates WHERE is_active = 1 ORDER BY abbreviation'
  ).all();
  return success(c, results.results ?? []);
});
```

- [ ] **Step 5: Test the API manually**

```bash
cd packages/api && npx wrangler dev
```

In another terminal:
```bash
# Login
curl -X POST http://localhost:8787/api/auth/login -H "Content-Type: application/json" -d '{"email":"reception@ohcs.gov.gh"}'
# Check the wrangler console output for the OTP code, then:
curl -X POST http://localhost:8787/api/auth/verify -H "Content-Type: application/json" -d '{"email":"reception@ohcs.gov.gh","code":"THE_CODE"}' -c cookies.txt
# Get directorates (using cookie)
curl http://localhost:8787/api/directorates -b cookies.txt
# Get officers
curl http://localhost:8787/api/officers -b cookies.txt
```

- [ ] **Step 6: Commit**

```bash
cd ../..
git add -A
git commit -m "feat: add CRUD routes for visitors, visits, officers, directorates"
```

---

## Task 6: Frontend Scaffold — Vite, Tailwind, Routing, Design Tokens

**Files:**
- Create: `packages/web/index.html`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/styles/tokens.css`
- Create: `packages/web/src/lib/utils.ts`
- Create: `packages/web/src/lib/constants.ts`
- Create: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OHCS SmartGate — Visitor Management</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body class="bg-background text-foreground font-body antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 3: Create src/styles/tokens.css**

```css
@import "tailwindcss";

@theme {
  --color-primary: #1B3A5C;
  --color-primary-light: #2A5A8C;
  --color-primary-dark: #0F2740;
  --color-accent: #D4A017;
  --color-accent-light: #E8BD4A;
  --color-secondary: #2A9D8F;
  --color-background: #F8F9FA;
  --color-surface: #FFFFFF;
  --color-border: #E5E7EB;
  --color-border-strong: #D1D5DB;
  --color-foreground: #111827;
  --color-muted: #6B7280;
  --color-muted-foreground: #9CA3AF;

  --color-success: #22C55E;
  --color-success-light: #DCFCE7;
  --color-warning: #F59E0B;
  --color-warning-light: #FEF3C7;
  --color-info: #3B82F6;
  --color-info-light: #DBEAFE;
  --color-danger: #EF4444;
  --color-danger-light: #FEE2E2;

  --font-body: 'Inter', system-ui, -apple-system, sans-serif;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07), 0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05);
}
```

- [ ] **Step 4: Create src/lib/utils.ts**

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(iso);
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}
```

- [ ] **Step 5: Create src/lib/constants.ts**

```typescript
export const VISIT_STATUS = {
  checked_in: { label: 'Checked In', color: 'bg-success text-white' },
  checked_out: { label: 'Checked Out', color: 'bg-muted-foreground text-white' },
  cancelled: { label: 'Cancelled', color: 'bg-danger text-white' },
} as const;

export const ID_TYPES = [
  { value: 'ghana_card', label: 'Ghana Card' },
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'staff_id', label: 'Staff ID' },
  { value: 'other', label: 'Other' },
] as const;

export const API_BASE = '/api';
```

- [ ] **Step 6: Create src/lib/api.ts**

```typescript
import { API_BASE } from './constants';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta?: { cursor?: string; hasMore?: boolean; total?: number };
}

class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const json = await res.json() as ApiResponse<T>;

  if (!res.ok || json.error) {
    throw new ApiError(
      json.error?.code ?? 'UNKNOWN',
      json.error?.message ?? 'An error occurred',
      res.status
    );
  }

  return json;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
};
```

- [ ] **Step 7: Create src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 8: Create src/App.tsx**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { CheckInPage } from './pages/CheckInPage';
import { VisitorsPage } from './pages/VisitorsPage';
import { VisitorDetailPage } from './pages/VisitorDetailPage';
import { AppLayout } from './components/layout/AppLayout';
import { useAuthStore } from './stores/auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<CheckInPage />} />
            <Route path="visitors" element={<VisitorsPage />} />
            <Route path="visitors/:id" element={<VisitorDetailPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 9: Verify frontend starts**

```bash
cd packages/web && npm run dev
```

Expected: Vite starts on `localhost:5173`. Page loads (will show routing errors for missing pages — that's fine).

- [ ] **Step 10: Commit**

```bash
cd ../..
git add -A
git commit -m "feat: scaffold React frontend with Vite, Tailwind, routing, design tokens"
```

---

## Task 7: Auth Store + Login Page

**Files:**
- Create: `packages/web/src/stores/auth.ts`
- Create: `packages/web/src/pages/LoginPage.tsx`

- [ ] **Step 1: Create stores/auth.ts**

```typescript
import { create } from 'zustand';
import { api } from '@/lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (email: string) => Promise<void>;
  verify: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  login: async (email: string) => {
    await api.post('/auth/login', { email });
  },

  verify: async (email: string, code: string) => {
    const res = await api.post<{ user: User }>('/auth/verify', { email, code });
    set({ user: res.data?.user ?? null });
  },

  logout: async () => {
    await api.post('/auth/logout', {});
    set({ user: null });
  },

  checkSession: async () => {
    try {
      const res = await api.get<{ user: User }>('/auth/me');
      set({ user: res.data?.user ?? null, isLoading: false });
    } catch {
      set({ user: null, isLoading: false });
    }
  },
}));
```

- [ ] **Step 2: Create pages/LoginPage.tsx**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';

export function LoginPage() {
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, verify } = useAuthStore();
  const navigate = useNavigate();

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await login(email);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      await verify(email, code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid OTP');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">SG</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">OHCS SmartGate</h1>
          <p className="text-muted mt-1">Visitor Management System</p>
        </div>

        <div className="bg-surface rounded-xl shadow-md p-6 border border-border">
          {step === 'email' ? (
            <form onSubmit={handleEmailSubmit}>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@ohcs.gov.gh"
                className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              {error && <p className="text-danger text-xs mt-2">{error}</p>}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 mt-4 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary-light transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Sending...' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <p className="text-sm text-muted mb-4">Enter the 6-digit code sent to <strong>{email}</strong></p>
              <label htmlFor="code" className="block text-sm font-medium text-foreground mb-1.5">
                Verification Code
              </label>
              <input
                id="code"
                type="text"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm text-center tracking-widest font-mono text-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                autoFocus
              />
              {error && <p className="text-danger text-xs mt-2">{error}</p>}
              <button
                type="submit"
                disabled={isLoading || code.length !== 6}
                className="w-full h-11 mt-4 bg-primary text-white rounded-lg font-medium text-sm hover:bg-primary-light transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
              <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); }} className="w-full text-sm text-muted mt-3 hover:text-foreground">
                Use a different email
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Office of the Head of Civil Service, Ghana
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update App.tsx to check session on mount**

Add `useEffect` to App to call `checkSession` on mount:

In `App.tsx`, add inside the `App` function before the return:
```tsx
import { useEffect } from 'react';

// Inside App component:
const { checkSession, isLoading } = useAuthStore();

useEffect(() => { checkSession(); }, [checkSession]);

if (isLoading) {
  return <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="text-muted">Loading...</div>
  </div>;
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add auth store and OTP login page"
```

---

## Task 8: Layout Shell — Sidebar, Header, AppLayout

**Files:**
- Create: `packages/web/src/components/layout/Sidebar.tsx`
- Create: `packages/web/src/components/layout/Header.tsx`
- Create: `packages/web/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create Sidebar.tsx**

```tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ClipboardCheck, Users, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';

const NAV_ITEMS = [
  { to: '/', icon: ClipboardCheck, label: 'Check-In' },
  { to: '/visitors', icon: Users, label: 'Visitors' },
];

export function Sidebar() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <aside className="w-60 bg-primary h-screen flex flex-col text-white shrink-0">
      <div className="p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-accent rounded-lg flex items-center justify-center">
            <span className="text-primary font-bold text-sm">SG</span>
          </div>
          <div>
            <h1 className="font-semibold text-sm">SmartGate</h1>
            <p className="text-xs text-white/60">OHCS VMS</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-white/10">
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white w-full transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create Header.tsx**

```tsx
import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/lib/utils';

export function Header() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="h-14 bg-surface border-b border-border px-6 flex items-center justify-between shrink-0">
      <div>
        <p className="text-xs text-muted">{formatDate(new Date().toISOString())} — Office of the Head of Civil Service</p>
      </div>
      <div className="flex items-center gap-3">
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
}
```

- [ ] **Step 3: Create AppLayout.tsx**

```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

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
    </div>
  );
}
```

- [ ] **Step 4: Create placeholder pages**

Create `packages/web/src/pages/CheckInPage.tsx`:
```tsx
export function CheckInPage() {
  return <div className="text-foreground"><h2 className="text-xl font-semibold">Check-In</h2><p className="text-muted mt-1">Coming in Task 9</p></div>;
}
```

Create `packages/web/src/pages/VisitorsPage.tsx`:
```tsx
export function VisitorsPage() {
  return <div className="text-foreground"><h2 className="text-xl font-semibold">Visitors</h2><p className="text-muted mt-1">Coming in Task 10</p></div>;
}
```

Create `packages/web/src/pages/VisitorDetailPage.tsx`:
```tsx
export function VisitorDetailPage() {
  return <div className="text-foreground"><h2 className="text-xl font-semibold">Visitor Detail</h2><p className="text-muted mt-1">Coming in Task 10</p></div>;
}
```

- [ ] **Step 5: Verify the full auth + layout flow**

Run both `npm run dev:api` and `npm run dev:web`. Open `localhost:5173`. You should be redirected to `/login`. Login with `reception@ohcs.gov.gh` (grab OTP from API console). After login, see the sidebar layout with Check-In and Visitors nav.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add sidebar navigation, header, and app layout shell"
```

---

## Task 9: TanStack Query Hooks + Check-In Page

**Files:**
- Create: `packages/web/src/hooks/use-visitors.ts`
- Create: `packages/web/src/hooks/use-visits.ts`
- Create: `packages/web/src/hooks/use-officers.ts`
- Create: `packages/web/src/components/check-in/VisitorSearch.tsx`
- Create: `packages/web/src/components/check-in/CheckInForm.tsx`
- Create: `packages/web/src/components/check-in/LiveFeed.tsx`
- Update: `packages/web/src/pages/CheckInPage.tsx`

This is the largest task. The implementation should build the query hooks, then the three check-in components, then wire them into the CheckInPage.

- [ ] **Step 1: Create hooks/use-visitors.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useVisitorSearch(query: string) {
  return useQuery({
    queryKey: ['visitors', 'search', query],
    queryFn: () => api.get<unknown[]>(`/visitors?q=${encodeURIComponent(query)}&limit=10`),
    enabled: query.length >= 2,
    select: (res) => res.data ?? [],
  });
}

export function useVisitor(id: string | undefined) {
  return useQuery({
    queryKey: ['visitors', id],
    queryFn: () => api.get<unknown>(`/visitors/${id}`),
    enabled: !!id,
    select: (res) => res.data,
  });
}

export function useCreateVisitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<unknown>('/visitors', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['visitors'] }); },
  });
}
```

- [ ] **Step 2: Create hooks/use-visits.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useTodayVisits() {
  const today = new Date().toISOString().split('T')[0];
  return useQuery({
    queryKey: ['visits', 'today', today],
    queryFn: () => api.get<unknown[]>(`/visits?date=${today}&limit=50`),
    refetchInterval: 15_000,
    select: (res) => res.data ?? [],
  });
}

export function useActiveVisits() {
  return useQuery({
    queryKey: ['visits', 'active'],
    queryFn: () => api.get<unknown[]>('/visits/active'),
    refetchInterval: 15_000,
    select: (res) => res.data ?? [],
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<unknown>('/visits/check-in', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visits'] });
      qc.invalidateQueries({ queryKey: ['visitors'] });
    },
  });
}

export function useCheckOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visitId: string) => api.post<unknown>(`/visits/${visitId}/check-out`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['visits'] }); },
  });
}
```

- [ ] **Step 3: Create hooks/use-officers.ts**

```typescript
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Officer {
  id: string;
  name: string;
  title: string;
  directorate_abbr: string;
  is_available: number;
}

export function useOfficers(directorateId?: string) {
  const params = directorateId ? `?directorate_id=${directorateId}` : '';
  return useQuery({
    queryKey: ['officers', directorateId ?? 'all'],
    queryFn: () => api.get<Officer[]>(`/officers${params}`),
    select: (res) => res.data ?? [],
  });
}

export function useDirectorates() {
  return useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Array<{ id: string; name: string; abbreviation: string }>>('/directorates'),
    staleTime: 300_000,
    select: (res) => res.data ?? [],
  });
}
```

- [ ] **Step 4: Create components/check-in/VisitorSearch.tsx**

This component is the top search bar. It searches visitors by name/phone and shows results in a dropdown. Selecting a result fills the form; "New Visitor" starts a blank form.

```tsx
import { useState, useRef, useEffect } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { useVisitorSearch } from '@/hooks/use-visitors';
import { cn, getInitials } from '@/lib/utils';

interface Visitor {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  organisation: string;
  total_visits: number;
}

interface Props {
  onSelect: (visitor: Visitor) => void;
  onNewVisitor: () => void;
}

export function VisitorSearch({ onSelect, onNewVisitor }: Props) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const { data: visitors = [], isLoading } = useVisitorSearch(query);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search visitor by name, phone, or organisation..."
          className="w-full h-12 pl-11 pr-4 rounded-xl border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary shadow-sm"
        />
      </div>

      {isOpen && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-surface border border-border rounded-xl shadow-lg z-10 max-h-80 overflow-auto">
          {isLoading ? (
            <div className="p-4 text-sm text-muted text-center">Searching...</div>
          ) : (visitors as Visitor[]).length > 0 ? (
            <>
              {(visitors as Visitor[]).map((v) => (
                <button
                  key={v.id}
                  onClick={() => { onSelect(v); setIsOpen(false); setQuery(`${v.first_name} ${v.last_name}`); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-background transition-colors text-left border-b border-border last:border-0"
                >
                  <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center text-sm font-semibold shrink-0">
                    {getInitials(v.first_name, v.last_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{v.first_name} {v.last_name}</p>
                    <p className="text-xs text-muted truncate">{v.organisation || 'No organisation'} {v.phone ? `· ${v.phone}` : ''}</p>
                  </div>
                  <span className="text-xs text-muted shrink-0">{v.total_visits} visit{v.total_visits !== 1 ? 's' : ''}</span>
                </button>
              ))}
            </>
          ) : (
            <div className="p-4 text-sm text-muted text-center">No visitors found</div>
          )}
          <button
            onClick={() => { onNewVisitor(); setIsOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-background transition-colors text-left border-t border-border text-primary"
          >
            <UserPlus className="h-5 w-5" />
            <span className="text-sm font-medium">Register New Visitor</span>
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create components/check-in/CheckInForm.tsx**

This is the check-in form. It shows visitor details (editable for new, read-only for returning) + purpose + officer selection + check-in button.

```tsx
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useOfficers, useDirectorates } from '@/hooks/use-officers';
import { useCreateVisitor } from '@/hooks/use-visitors';
import { useCheckIn } from '@/hooks/use-visits';
import { ID_TYPES } from '@/lib/constants';

const formSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  phone: z.string().optional(),
  email: z.string().optional(),
  organisation: z.string().optional(),
  id_type: z.string().optional(),
  id_number: z.string().optional(),
  host_officer_id: z.string().optional(),
  directorate_id: z.string().optional(),
  purpose_raw: z.string().optional(),
  purpose_category: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

interface Props {
  selectedVisitor: { id: string; first_name: string; last_name: string; phone: string; organisation: string } | null;
  isNewVisitor: boolean;
  onReset: () => void;
  onSuccess: () => void;
}

export function CheckInForm({ selectedVisitor, isNewVisitor, onReset, onSuccess }: Props) {
  const { data: officers = [] } = useOfficers();
  const { data: directorates = [] } = useDirectorates();
  const createVisitor = useCreateVisitor();
  const checkIn = useCheckIn();

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    values: selectedVisitor ? {
      first_name: selectedVisitor.first_name,
      last_name: selectedVisitor.last_name,
      phone: selectedVisitor.phone || '',
      organisation: selectedVisitor.organisation || '',
    } as FormData : undefined,
  });

  async function onSubmit(data: FormData) {
    let visitorId = selectedVisitor?.id;

    if (!visitorId) {
      const res = await createVisitor.mutateAsync({
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        email: data.email,
        organisation: data.organisation,
        id_type: data.id_type,
        id_number: data.id_number,
      });
      visitorId = (res.data as { id: string })?.id;
    }

    if (!visitorId) return;

    await checkIn.mutateAsync({
      visitor_id: visitorId,
      host_officer_id: data.host_officer_id || undefined,
      directorate_id: data.directorate_id || undefined,
      purpose_raw: data.purpose_raw || undefined,
      purpose_category: data.purpose_category || undefined,
    });

    reset();
    onReset();
    onSuccess();
  }

  const isSubmitting = createVisitor.isPending || checkIn.isPending;

  if (!selectedVisitor && !isNewVisitor) {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center">
        <p className="text-muted text-sm">Search for a visitor above or register a new one to begin check-in.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="bg-surface border border-border rounded-xl p-6 space-y-4">
      <h3 className="font-semibold text-foreground">{selectedVisitor ? 'Returning Visitor' : 'New Visitor'}</h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">First Name *</label>
          <input {...register('first_name')} readOnly={!!selectedVisitor} className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary read-only:bg-muted-foreground/5" />
          {errors.first_name && <p className="text-danger text-xs mt-1">{errors.first_name.message}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Last Name *</label>
          <input {...register('last_name')} readOnly={!!selectedVisitor} className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary read-only:bg-muted-foreground/5" />
          {errors.last_name && <p className="text-danger text-xs mt-1">{errors.last_name.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Phone</label>
          <input {...register('phone')} readOnly={!!selectedVisitor} placeholder="0241234567" className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary read-only:bg-muted-foreground/5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Organisation</label>
          <input {...register('organisation')} readOnly={!!selectedVisitor} className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary read-only:bg-muted-foreground/5" />
        </div>
      </div>

      {isNewVisitor && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">ID Type</label>
            <select {...register('id_type')} className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Select...</option>
              {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">ID Number</label>
            <input {...register('id_number')} className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
        </div>
      )}

      <hr className="border-border" />

      <div>
        <label className="block text-xs font-medium text-muted mb-1">Purpose of Visit</label>
        <input {...register('purpose_raw')} placeholder="e.g. Submit promotion documents" className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Directorate</label>
          <select {...register('directorate_id')} className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">Select...</option>
            {(directorates as Array<{ id: string; abbreviation: string; name: string }>).map((d) => (
              <option key={d.id} value={d.id}>{d.abbreviation} — {d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Host Officer</label>
          <select {...register('host_officer_id')} className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">Select...</option>
            {(officers as Array<{ id: string; name: string; directorate_abbr: string; is_available: number }>).map((o) => (
              <option key={o.id} value={o.id} disabled={!o.is_available}>
                {o.name} ({o.directorate_abbr}){!o.is_available ? ' — Unavailable' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full h-11 bg-success text-white rounded-lg font-medium text-sm hover:bg-success/90 transition-colors disabled:opacity-50 mt-2"
      >
        {isSubmitting ? 'Checking In...' : 'Check In Visitor'}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Create components/check-in/LiveFeed.tsx**

```tsx
import { useTodayVisits, useCheckOut } from '@/hooks/use-visits';
import { cn, timeAgo, getInitials, formatTime } from '@/lib/utils';
import { VISIT_STATUS } from '@/lib/constants';
import { LogOut } from 'lucide-react';

interface Visit {
  id: string;
  first_name: string;
  last_name: string;
  organisation: string;
  host_name: string;
  directorate_abbr: string;
  status: keyof typeof VISIT_STATUS;
  check_in_at: string;
  check_out_at: string | null;
  purpose_raw: string;
}

export function LiveFeed() {
  const { data: visits = [], isLoading } = useTodayVisits();
  const checkOut = useCheckOut();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-border rounded w-3/4 mb-2" />
            <div className="h-3 bg-border rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if ((visits as Visit[]).length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-8 text-center">
        <p className="text-muted text-sm">No visitors checked in today yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-foreground text-sm">Today's Visitors</h3>
        <span className="text-xs text-muted">{(visits as Visit[]).length} total</span>
      </div>
      {(visits as Visit[]).map((v) => {
        const status = VISIT_STATUS[v.status];
        return (
          <div key={v.id} className="bg-surface border border-border rounded-lg p-3 flex items-center gap-3">
            <div className="w-9 h-9 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-semibold shrink-0">
              {getInitials(v.first_name, v.last_name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{v.first_name} {v.last_name}</p>
              <p className="text-xs text-muted truncate">
                {v.host_name ? `→ ${v.host_name}` : ''} {v.directorate_abbr ? `(${v.directorate_abbr})` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', status.color)}>
                {status.label}
              </span>
              <span className="text-xs text-muted">{formatTime(v.check_in_at)}</span>
              {v.status === 'checked_in' && (
                <button
                  onClick={() => checkOut.mutate(v.id)}
                  disabled={checkOut.isPending}
                  className="p-1.5 rounded-md hover:bg-danger/10 text-danger transition-colors"
                  title="Check out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Update CheckInPage.tsx**

```tsx
import { useState } from 'react';
import { VisitorSearch } from '@/components/check-in/VisitorSearch';
import { CheckInForm } from '@/components/check-in/CheckInForm';
import { LiveFeed } from '@/components/check-in/LiveFeed';
import { useActiveVisits } from '@/hooks/use-visits';

interface SelectedVisitor {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  organisation: string;
}

export function CheckInPage() {
  const [selectedVisitor, setSelectedVisitor] = useState<SelectedVisitor | null>(null);
  const [isNewVisitor, setIsNewVisitor] = useState(false);
  const { data: activeVisits = [] } = useActiveVisits();

  function handleReset() {
    setSelectedVisitor(null);
    setIsNewVisitor(false);
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Visitor Check-In</h2>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted">Currently in building: <strong className="text-foreground">{(activeVisits as unknown[]).length}</strong></span>
        </div>
      </div>

      <VisitorSearch
        onSelect={(v) => { setSelectedVisitor(v as SelectedVisitor); setIsNewVisitor(false); }}
        onNewVisitor={() => { setSelectedVisitor(null); setIsNewVisitor(true); }}
      />

      <div className="flex-1 grid grid-cols-5 gap-6 min-h-0">
        <div className="col-span-3 overflow-auto">
          <CheckInForm
            selectedVisitor={selectedVisitor}
            isNewVisitor={isNewVisitor}
            onReset={handleReset}
            onSuccess={handleReset}
          />
        </div>
        <div className="col-span-2 overflow-auto">
          <LiveFeed />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Verify the full check-in flow**

1. Start API and Web dev servers
2. Login with `reception@ohcs.gov.gh`
3. Search for a visitor name — see "No visitors found" + "Register New Visitor"
4. Click "Register New Visitor", fill the form, select a directorate and officer, click "Check In Visitor"
5. See the visitor appear in the Live Feed on the right
6. Click the check-out icon — status changes to "Checked Out"

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add check-in page with visitor search, form, and live feed"
```

---

## Task 10: Visitors List + Profile Pages

**Files:**
- Update: `packages/web/src/pages/VisitorsPage.tsx`
- Update: `packages/web/src/pages/VisitorDetailPage.tsx`

- [ ] **Step 1: Update VisitorsPage.tsx**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useVisitorSearch } from '@/hooks/use-visitors';
import { Search } from 'lucide-react';
import { cn, getInitials, formatDate } from '@/lib/utils';

interface Visitor {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  organisation: string;
  total_visits: number;
  last_visit_at: string | null;
}

export function VisitorsPage() {
  const [query, setQuery] = useState('');
  const { data: visitors = [], isLoading } = useVisitorSearch(query.length >= 2 ? query : '__all__');

  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground mb-4">Visitors</h2>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone, or organisation..."
          className="w-full max-w-md h-10 pl-10 pr-4 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="px-4 py-3 text-left font-medium text-muted">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Organisation</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Phone</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Visits</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Last Visit</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="px-4 py-3" colSpan={5}><div className="h-4 bg-border rounded w-full animate-pulse" /></td>
                </tr>
              ))
            ) : (visitors as Visitor[]).length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-muted" colSpan={5}>No visitors found. Start typing to search.</td></tr>
            ) : (visitors as Visitor[]).map((v, i) => (
              <tr key={v.id} className={cn('border-b border-border last:border-0', i % 2 === 0 ? '' : 'bg-background/50')}>
                <td className="px-4 py-3">
                  <Link to={`/visitors/${v.id}`} className="flex items-center gap-2 hover:text-primary">
                    <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-semibold shrink-0">
                      {getInitials(v.first_name, v.last_name)}
                    </div>
                    <span className="font-medium text-foreground">{v.first_name} {v.last_name}</span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{v.organisation || '—'}</td>
                <td className="px-4 py-3 text-muted">{v.phone || '—'}</td>
                <td className="px-4 py-3 text-muted">{v.total_visits}</td>
                <td className="px-4 py-3 text-muted">{v.last_visit_at ? formatDate(v.last_visit_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update VisitorDetailPage.tsx**

```tsx
import { useParams, Link } from 'react-router-dom';
import { useVisitor } from '@/hooks/use-visitors';
import { ArrowLeft } from 'lucide-react';
import { cn, getInitials, formatDateTime } from '@/lib/utils';
import { VISIT_STATUS } from '@/lib/constants';

interface VisitorData {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  organisation: string;
  id_type: string;
  id_number: string;
  total_visits: number;
  created_at: string;
  visits: Array<{
    id: string;
    check_in_at: string;
    check_out_at: string | null;
    status: keyof typeof VISIT_STATUS;
    host_name: string;
    directorate_abbr: string;
    purpose_raw: string;
    duration_minutes: number | null;
  }>;
}

export function VisitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useVisitor(id);
  const visitor = data as VisitorData | undefined;

  if (isLoading) return <div className="text-muted">Loading...</div>;
  if (!visitor) return <div className="text-muted">Visitor not found</div>;

  return (
    <div>
      <Link to="/visitors" className="flex items-center gap-1 text-sm text-muted hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to Visitors
      </Link>

      <div className="bg-surface border border-border rounded-xl p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xl font-semibold">
            {getInitials(visitor.first_name, visitor.last_name)}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{visitor.first_name} {visitor.last_name}</h2>
            <p className="text-sm text-muted">{visitor.organisation || 'No organisation'}</p>
            <div className="flex gap-4 mt-1 text-xs text-muted">
              {visitor.phone && <span>{visitor.phone}</span>}
              {visitor.email && <span>{visitor.email}</span>}
              {visitor.id_type && <span>{visitor.id_type}: {visitor.id_number}</span>}
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold text-foreground">{visitor.total_visits}</p>
            <p className="text-xs text-muted">Total Visits</p>
          </div>
        </div>
      </div>

      <h3 className="font-semibold text-foreground mb-3">Visit History</h3>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="px-4 py-3 text-left font-medium text-muted">Date/Time</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Host</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Purpose</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Duration</th>
              <th className="px-4 py-3 text-left font-medium text-muted">Status</th>
            </tr>
          </thead>
          <tbody>
            {visitor.visits.length === 0 ? (
              <tr><td className="px-4 py-8 text-center text-muted" colSpan={5}>No visits recorded</td></tr>
            ) : visitor.visits.map((v, i) => (
              <tr key={v.id} className={cn('border-b border-border last:border-0', i % 2 === 0 ? '' : 'bg-background/50')}>
                <td className="px-4 py-3 text-foreground">{formatDateTime(v.check_in_at)}</td>
                <td className="px-4 py-3 text-muted">{v.host_name || '—'} {v.directorate_abbr ? `(${v.directorate_abbr})` : ''}</td>
                <td className="px-4 py-3 text-muted truncate max-w-48">{v.purpose_raw || '—'}</td>
                <td className="px-4 py-3 text-muted">{v.duration_minutes != null ? `${v.duration_minutes}min` : '—'}</td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', VISIT_STATUS[v.status].color)}>
                    {VISIT_STATUS[v.status].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify visitors pages work**

Navigate to `/visitors`. Search for a visitor name. Click a result to see their profile with visit history.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add visitors list and visitor profile pages"
```

---

## Task 11: Save Memory + Final Verification

- [ ] **Step 1: End-to-end verification**

Run through the complete flow:
1. Start API: `npm run dev:api`
2. Start Web: `npm run dev:web`
3. Open `localhost:5173` → redirected to `/login`
4. Login with `reception@ohcs.gov.gh` + OTP from console
5. See Check-In page with search bar, empty form, empty live feed
6. Click "Register New Visitor" → fill form → select directorate + officer → Check In
7. See visitor in Live Feed with "Checked In" badge
8. Click check-out button → status changes to "Checked Out"
9. Navigate to Visitors → see the visitor in the list
10. Click visitor → see profile with visit history
11. Sign out → redirected to login

- [ ] **Step 2: Commit final state**

```bash
git add -A
git commit -m "feat: complete Phase 1 — visitor check-in/check-out flow"
```
