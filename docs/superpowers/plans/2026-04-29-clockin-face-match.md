# Clock-In Face-Match Against Enrolled Reference — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side face-match between each clock-in selfie and a per-staff HR-approved reference photo. Hard-reject confident mismatches under enforcement; flag borderline matches for HR review; silently approve confident matches.

**Architecture:** Staff self-enrolls a reference selfie via the PWA. HR approves it through a new admin queue. At each clock-in, the existing photo upload endpoint computes an embedding from the just-uploaded selfie via Workers AI, compares to the stored reference embedding, decides accept/flag/reject by threshold band, and writes the result on the `clock_records` row. Two new columns on `clock_records`; four new tables for references, pending submissions, archive, and unlock audit. Graduated enforcement (off → flag → enforce) gated by a runtime `app_settings` flag.

**Tech Stack:** Cloudflare Workers + Hono, Workers AI, D1, KV, R2, React + TypeScript PWA, `@simplewebauthn/server` already in use (no new auth infra).

**Companion spec:** `docs/superpowers/specs/2026-04-29-clockin-face-match-design.md`.

**Prerequisite:** This plan depends on Plan 1 (`2026-04-29-clockin-reauth-and-liveness.md`) being shipped to production for at least 2 weeks. Threshold tuning needs photos taken under the new prompt+biometric flow.

**Note on TDD:** No project-wide unit-test harness. Per-task verification uses `curl` against `wrangler dev`, manual D1 inspection, and on-device PWA checks before commit. Pure-logic helpers (cosine similarity, status decision matrix) get small inline `vitest` smoke files in the same task that introduces them — kept self-contained so they don't require a project-wide test framework.

---

## Task 1: Spike — Workers AI face model selection

**Files:**
- Create: `packages/api/scripts/spike-face-model.ts`
- Update: `docs/superpowers/specs/2026-04-29-clockin-face-match-design.md` (technical appendix only)

This task is the gating decision for the rest of the plan. Output is a documented model choice and a working `computeEmbedding(photoBlob) → vector` interface that subsequent tasks consume.

- [ ] **Step 1: Inventory Workers AI face/embedding models**

```bash
npx wrangler ai models | grep -iE 'face|embed|vision|image'
```

Record the output verbatim into the spec's technical appendix under a new "Spike findings" section.

- [ ] **Step 2: Create the spike script**

Create `packages/api/scripts/spike-face-model.ts` — runs as a one-off Worker, accepts two photo URLs, returns embeddings + cosine similarity using the model under test.

```typescript
// One-off spike Worker. Deploy with `npx wrangler deploy --name face-spike scripts/spike-face-model.ts`
// then DELETE after the decision is made.
//
// Endpoints:
//   POST /embed   { url: string }     → { embedding: number[], model: string, ms: number }
//   POST /compare { urlA, urlB }      → { score: number, model: string, ms: number }

interface Env {
  AI: Ai;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('vector length mismatch');
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/embed') {
      const { url: imgUrl } = await req.json() as { url: string };
      const bytes = await fetchImageBytes(imgUrl);
      const t0 = Date.now();
      // CHOOSE THE MODEL HERE. Examples — verify which exist:
      //   '@cf/microsoft/resnet-50'              (image classification, last hidden state can serve as embedding)
      //   '@cf/baai/bge-large-en-v1.5'           (text embeddings — NOT FACE)
      //   '@cf/meta/llama-3.2-11b-vision-instruct' (vision LLM — yes/no path, not embeddings)
      const result = await env.AI.run('@cf/microsoft/resnet-50', { image: Array.from(bytes) });
      const ms = Date.now() - t0;
      return Response.json({ embedding: result, model: '@cf/microsoft/resnet-50', ms });
    }
    if (req.method === 'POST' && url.pathname === '/compare') {
      const { urlA, urlB } = await req.json() as { urlA: string; urlB: string };
      const [a, b] = await Promise.all([fetchImageBytes(urlA), fetchImageBytes(urlB)]);
      const t0 = Date.now();
      const [eA, eB] = await Promise.all([
        env.AI.run('@cf/microsoft/resnet-50', { image: Array.from(a) }),
        env.AI.run('@cf/microsoft/resnet-50', { image: Array.from(b) }),
      ]);
      const ms = Date.now() - t0;
      const score = cosineSimilarity(eA as unknown as number[], eB as unknown as number[]);
      return Response.json({ score, model: '@cf/microsoft/resnet-50', ms });
    }
    return new Response('ok', { status: 200 });
  },
};
```

- [ ] **Step 3: Deploy the spike Worker and run the comparison test**

```bash
cd packages/api
npx wrangler deploy --name face-spike scripts/spike-face-model.ts
```

Test data: 5 staff volunteers, each provides 2 photos taken at different times.

```bash
# For each pair (same-person), expect HIGH score
curl -X POST https://face-spike.<account>.workers.dev/compare \
  -H 'Content-Type: application/json' \
  -d '{"urlA":"https://example.com/staffA-photo1.jpg","urlB":"https://example.com/staffA-photo2.jpg"}' | jq

# For each cross-pair (different person), expect LOW score
curl -X POST https://face-spike.<account>.workers.dev/compare \
  -H 'Content-Type: application/json' \
  -d '{"urlA":"https://example.com/staffA-photo1.jpg","urlB":"https://example.com/staffB-photo1.jpg"}' | jq
```

Build a small CSV: `pair,kind,score`. Compute:
- `same_p99`: 99th percentile of same-person scores.
- `cross_p99`: 99th percentile of cross-person scores.

**Pass criterion:** `same_p99 > cross_p99 + 0.05` — there is a usable gap. Defaults `LOW = same_p99 - 0.05`, `HIGH = cross_p99 + 0.05`.

**Fail criterion:** scores overlap. → switch to vision-LLM yes/no mode (option 2 in the spec) and re-run the comparison test, recording confidence values instead of cosine similarities.

- [ ] **Step 4: Document the chosen path**

Update `docs/superpowers/specs/2026-04-29-clockin-face-match-design.md` — replace the "Workers AI model selection" section's TBD lines with the chosen model name, sample scores, and chosen thresholds. Commit the spec update.

- [ ] **Step 5: Tear down the spike**

```bash
npx wrangler delete face-spike
git rm packages/api/scripts/spike-face-model.ts
git commit -m "chore: remove face-model spike Worker"
```

The interface (`computeEmbedding`, `cosineSimilarity`) is now locked in for the next tasks.

---

## Task 2: Migration — face-match schema

**Files:**
- Create: `packages/api/src/db/migration-face-match.sql`
- Modify: `packages/api/src/db/migrations-index.ts`
- Modify: `packages/api/src/db/schema.sql`

- [ ] **Step 1: Create the migration**

Create `packages/api/src/db/migration-face-match.sql`:

```sql
-- Face-match against enrolled reference photo
-- Companion spec: docs/superpowers/specs/2026-04-29-clockin-face-match-design.md

-- Approved reference embedding (one per user, replaced on re-enrollment)
CREATE TABLE IF NOT EXISTS face_references (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo_key    TEXT NOT NULL,
  embedding    BLOB NOT NULL,
  model_id     TEXT NOT NULL,
  approved_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  approved_by  TEXT NOT NULL REFERENCES users(id)
);

-- Pending self-enrollments awaiting HR approval
CREATE TABLE IF NOT EXISTS face_references_pending (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo_key        TEXT NOT NULL,
  embedding        BLOB NOT NULL,
  model_id         TEXT NOT NULL,
  submitted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  rejected_at      TEXT,
  rejected_reason  TEXT,
  rejected_by      TEXT REFERENCES users(id)
);

-- Archived previous references (kept 30 days for audit/appeal, then GC'd)
CREATE TABLE IF NOT EXISTS face_references_archive (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_key        TEXT NOT NULL,
  embedding        BLOB NOT NULL,
  model_id         TEXT NOT NULL,
  approved_at      TEXT NOT NULL,
  archived_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  archived_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_face_archive_user ON face_references_archive(user_id);
CREATE INDEX IF NOT EXISTS idx_face_archive_archived ON face_references_archive(archived_at);

-- HR overrides on retry-lockout, audit-only
CREATE TABLE IF NOT EXISTS face_match_unlocks (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unlocked_by  TEXT NOT NULL REFERENCES users(id),
  unlocked_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  reason       TEXT
);

-- Two new columns on clock_records
ALTER TABLE clock_records ADD COLUMN match_score REAL;
ALTER TABLE clock_records ADD COLUMN match_status TEXT
  CHECK (match_status IN
    ('not_enforced','no_reference','match_strong','match_weak','match_fail','match_error')
    OR match_status IS NULL);

CREATE INDEX IF NOT EXISTS idx_clock_records_match_status
  ON clock_records(match_status)
  WHERE match_status IN ('match_weak','match_fail','no_reference','match_error');

-- Three new app_settings columns: enforcement state + thresholds
ALTER TABLE app_settings ADD COLUMN face_match_enforcement TEXT;
ALTER TABLE app_settings ADD COLUMN face_match_low_threshold REAL;
ALTER TABLE app_settings ADD COLUMN face_match_high_threshold REAL;

UPDATE app_settings
   SET face_match_enforcement   = COALESCE(face_match_enforcement, 'off'),
       face_match_low_threshold = COALESCE(face_match_low_threshold, 0.55),
       face_match_high_threshold= COALESCE(face_match_high_threshold, 0.85)
 WHERE id = 1;
```

- [ ] **Step 2: Register the migration**

Add to `packages/api/src/db/migrations-index.ts`:

```typescript
import faceMatch from './migration-face-match.sql';
// In MIGRATIONS array, append:
  { filename: 'migration-face-match.sql', sql: faceMatch },
```

- [ ] **Step 3: Mirror in `schema.sql`**

In `packages/api/src/db/schema.sql`:

(a) Add the four new tables after the `webauthn_credentials` block.

(b) Update the `clock_records` CREATE TABLE — add `match_score REAL` and `match_status TEXT CHECK(...)` columns (next to `prompt_value` from Plan 1).

(c) Update the `app_settings` CREATE TABLE — add the three new face-match columns with NOT NULL DEFAULT clauses:

```sql
    face_match_enforcement      TEXT NOT NULL DEFAULT 'off' CHECK(face_match_enforcement IN ('off','flag','enforce')),
    face_match_low_threshold    REAL NOT NULL DEFAULT 0.55,
    face_match_high_threshold   REAL NOT NULL DEFAULT 0.85
```

- [ ] **Step 4: Apply locally and verify**

```bash
cd packages/api
# Reset local D1 to ensure clean apply, then full schema
npx wrangler d1 execute ohcs-smartgate --local --file=src/db/schema.sql
npx wrangler d1 execute ohcs-smartgate --local --command="PRAGMA table_info(face_references);"
npx wrangler d1 execute ohcs-smartgate --local --command="PRAGMA table_info(clock_records);"
npx wrangler d1 execute ohcs-smartgate --local --command="SELECT face_match_enforcement, face_match_low_threshold, face_match_high_threshold FROM app_settings WHERE id=1;"
```

Expected: all four new tables present, two new columns on `clock_records`, three new columns on `app_settings` with defaults `('off', 0.55, 0.85)`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/migration-face-match.sql packages/api/src/db/migrations-index.ts packages/api/src/db/schema.sql
git commit -m "feat(db): face-match against enrolled reference schema

Adds face_references, face_references_pending, face_references_archive,
face_match_unlocks tables. Adds match_score + match_status columns
on clock_records and three face-match settings columns on app_settings."
```

---

## Task 3: Settings — extend `AppSettings` type for face-match flags

**Files:**
- Modify: `packages/api/src/services/settings.ts`

- [ ] **Step 1: Extend the interface and DEFAULTS**

Add to `AppSettings`:

```typescript
  face_match_enforcement: 'off' | 'flag' | 'enforce';
  face_match_low_threshold: number;
  face_match_high_threshold: number;
```

Add to `DEFAULTS`:

```typescript
  face_match_enforcement: 'off',
  face_match_low_threshold: 0.55,
  face_match_high_threshold: 0.85,
```

- [ ] **Step 2: Update the SELECT in `getAppSettings`**

```typescript
  const row = await env.DB.prepare(
    `SELECT work_start_time, late_threshold_time, work_end_time, updated_by, updated_at,
            clockin_reauth_enforce, clockin_pin_attempt_cap, clockin_prompt_ttl_seconds,
            face_match_enforcement, face_match_low_threshold, face_match_high_threshold
     FROM app_settings WHERE id = 1`
  ).first<AppSettings>();
```

- [ ] **Step 3: Bump the KV cache key to v3**

```typescript
const KV_KEY = 'app-settings:v3';
```

- [ ] **Step 4: Type-check + commit**

```bash
cd packages/api && npx tsc --noEmit

git add packages/api/src/services/settings.ts
git commit -m "feat(api): extend AppSettings with face-match enforcement + thresholds"
```

---

## Task 4: Worker — face-match service (`computeEmbedding`, `cosineSimilarity`)

**Files:**
- Create: `packages/api/src/services/face-match.ts`
- Create: `packages/api/src/services/face-match.test.ts`

- [ ] **Step 1: Create the service module**

Create `packages/api/src/services/face-match.ts`:

```typescript
import type { Env } from '../types';
import { getAppSettings } from './settings';

// Replace MODEL_ID after Task 1's spike — pin the chosen model here.
export const FACE_MODEL_ID = '@cf/microsoft/resnet-50';

/**
 * Pure cosine similarity. Used both at clock-in and at HR-approval enrollment
 * checks. Inputs are equal-length number arrays; scores are in [-1, 1] and
 * normalized to [0, 1] by the caller when needed.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error('cosineSimilarity: vector length mismatch or zero');
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Normalize a cosine similarity in [-1, 1] to [0, 1] for the threshold bands. */
export function normalizeScore(cos: number): number {
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}

/** Float32Array → ArrayBuffer for D1 BLOB storage. */
export function serializeEmbedding(embedding: readonly number[]): ArrayBuffer {
  const arr = new Float32Array(embedding);
  return arr.buffer;
}

/** D1 BLOB → number[] for cosineSimilarity. */
export function deserializeEmbedding(blob: ArrayBuffer): number[] {
  return Array.from(new Float32Array(blob));
}

/** Compute an embedding from raw image bytes via Workers AI. */
export async function computeEmbedding(
  env: Env,
  imageBytes: Uint8Array,
): Promise<number[]> {
  const result = await env.AI.run(FACE_MODEL_ID, { image: Array.from(imageBytes) });
  // Adjust the result-shape unwrap based on the model chosen in the spike.
  // For an image-classification model, the embedding is the last hidden state
  // or a flattened logits array — the spike script returns the right shape
  // already; mirror it here.
  if (Array.isArray(result)) return result as number[];
  if (typeof result === 'object' && result !== null && 'embedding' in result) {
    return (result as { embedding: number[] }).embedding;
  }
  throw new Error('Unexpected embedding result shape');
}

export type MatchStatus =
  | 'not_enforced'
  | 'no_reference'
  | 'match_strong'
  | 'match_weak'
  | 'match_fail'
  | 'match_error';

/**
 * Pure decision matrix — given an enforcement mode, whether a reference
 * exists, and an optional similarity score, return the resulting status.
 * Used at clock-in to decide accept/flag/reject.
 */
export function decideMatchStatus(input: {
  enforcement: 'off' | 'flag' | 'enforce';
  hasReference: boolean;
  score: number | null;            // null → inference error or no reference
  lowThreshold: number;
  highThreshold: number;
}): MatchStatus {
  const { enforcement, hasReference, score, lowThreshold, highThreshold } = input;

  if (!hasReference) return 'no_reference';
  if (score === null) return 'match_error';
  if (score >= highThreshold) return 'match_strong';
  if (score >= lowThreshold)  return 'match_weak';
  return 'match_fail';
}

/** Whether the resolved status should block the clock-in under the given enforcement. */
export function shouldRejectStatus(
  status: MatchStatus,
  enforcement: 'off' | 'flag' | 'enforce',
): boolean {
  if (enforcement !== 'enforce') return false;
  return status === 'match_fail' || status === 'no_reference';
}

export interface FaceMatchSettings {
  enforcement: 'off' | 'flag' | 'enforce';
  low: number;
  high: number;
}

export async function getFaceMatchSettings(env: Env): Promise<FaceMatchSettings> {
  const s = await getAppSettings(env);
  return {
    enforcement: s.face_match_enforcement,
    low: s.face_match_low_threshold,
    high: s.face_match_high_threshold,
  };
}
```

- [ ] **Step 2: Create a self-contained smoke test for the pure helpers**

Create `packages/api/src/services/face-match.test.ts`. This is a one-off vitest file — install vitest as a dev dep if absent.

```bash
cd packages/api
# Install vitest only if missing
node -e "try { require.resolve('vitest'); } catch { process.exit(1); }" || npm install --save-dev vitest
```

```typescript
import { describe, it, expect } from 'vitest';
import {
  cosineSimilarity,
  normalizeScore,
  serializeEmbedding,
  deserializeEmbedding,
  decideMatchStatus,
  shouldRejectStatus,
} from './face-match';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('returns -1 for anti-parallel vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 6);
  });
  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });
});

describe('normalizeScore', () => {
  it('maps -1 → 0, 0 → 0.5, 1 → 1', () => {
    expect(normalizeScore(-1)).toBe(0);
    expect(normalizeScore(0)).toBe(0.5);
    expect(normalizeScore(1)).toBe(1);
  });
});

describe('serialize/deserialize embedding', () => {
  it('roundtrips a vector', () => {
    const original = [0.1, -0.2, 0.3, 0.4];
    const blob = serializeEmbedding(original);
    const restored = deserializeEmbedding(blob);
    expect(restored.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5);
    }
  });
});

describe('decideMatchStatus', () => {
  const base = { lowThreshold: 0.55, highThreshold: 0.85 };
  it('no reference → no_reference regardless of score', () => {
    expect(decideMatchStatus({ ...base, enforcement: 'enforce', hasReference: false, score: 0.99 }))
      .toBe('no_reference');
  });
  it('null score with reference → match_error', () => {
    expect(decideMatchStatus({ ...base, enforcement: 'flag', hasReference: true, score: null }))
      .toBe('match_error');
  });
  it('score above high → match_strong', () => {
    expect(decideMatchStatus({ ...base, enforcement: 'enforce', hasReference: true, score: 0.86 }))
      .toBe('match_strong');
  });
  it('score exactly at high → match_strong', () => {
    expect(decideMatchStatus({ ...base, enforcement: 'enforce', hasReference: true, score: 0.85 }))
      .toBe('match_strong');
  });
  it('score in band → match_weak', () => {
    expect(decideMatchStatus({ ...base, enforcement: 'enforce', hasReference: true, score: 0.7 }))
      .toBe('match_weak');
  });
  it('score exactly at low → match_weak', () => {
    expect(decideMatchStatus({ ...base, enforcement: 'enforce', hasReference: true, score: 0.55 }))
      .toBe('match_weak');
  });
  it('score below low → match_fail', () => {
    expect(decideMatchStatus({ ...base, enforcement: 'enforce', hasReference: true, score: 0.3 }))
      .toBe('match_fail');
  });
});

describe('shouldRejectStatus', () => {
  it('never rejects under off', () => {
    expect(shouldRejectStatus('match_fail', 'off')).toBe(false);
    expect(shouldRejectStatus('no_reference', 'off')).toBe(false);
  });
  it('never rejects under flag', () => {
    expect(shouldRejectStatus('match_fail', 'flag')).toBe(false);
    expect(shouldRejectStatus('no_reference', 'flag')).toBe(false);
  });
  it('rejects only match_fail and no_reference under enforce', () => {
    expect(shouldRejectStatus('match_fail', 'enforce')).toBe(true);
    expect(shouldRejectStatus('no_reference', 'enforce')).toBe(true);
    expect(shouldRejectStatus('match_weak', 'enforce')).toBe(false);
    expect(shouldRejectStatus('match_strong', 'enforce')).toBe(false);
    expect(shouldRejectStatus('match_error', 'enforce')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
cd packages/api && npx vitest run src/services/face-match.test.ts
```

Expected: all green. If the project has no vitest config, vitest's defaults (Node env, glob pattern) work for this file standalone.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/face-match.ts packages/api/src/services/face-match.test.ts packages/api/package.json packages/api/package-lock.json
git commit -m "feat(api): face-match service (embedding, similarity, decision matrix)

Pure helpers (cosineSimilarity, normalizeScore, serialize/deserialize)
plus the Workers AI computeEmbedding wrapper and the decideMatchStatus
state-machine. Vitest smoke covers all pure functions."
```

---

## Task 5: Worker — staff-side face routes (`/api/face/me`, `/api/face/enroll`)

**Files:**
- Create: `packages/api/src/routes/face.ts`
- Modify: `packages/api/src/index.ts` (or wherever routes are mounted)

- [ ] **Step 1: Create the route module**

Create `packages/api/src/routes/face.ts`:

```typescript
import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import {
  computeEmbedding,
  serializeEmbedding,
  FACE_MODEL_ID,
} from '../services/face-match';
import { devLog } from '../lib/log';

export const faceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const RE_ENROLL_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

faceRoutes.get('/me', async (c) => {
  const session = c.get('session');

  const approved = await c.env.DB.prepare(
    'SELECT approved_at FROM face_references WHERE user_id = ?'
  ).bind(session.userId).first<{ approved_at: string }>();

  const pending = await c.env.DB.prepare(
    'SELECT submitted_at, rejected_at, rejected_reason FROM face_references_pending WHERE user_id = ?'
  ).bind(session.userId).first<{ submitted_at: string; rejected_at: string | null; rejected_reason: string | null }>();

  // Status precedence: pending (live) > rejected > approved > none
  if (pending && !pending.rejected_at) {
    return success(c, { status: 'pending', submitted_at: pending.submitted_at });
  }
  if (pending && pending.rejected_at) {
    return success(c, {
      status: 'rejected',
      submitted_at: pending.submitted_at,
      rejected_reason: pending.rejected_reason,
    });
  }
  if (approved) {
    const cooldownUntil = new Date(approved.approved_at).getTime() + RE_ENROLL_COOLDOWN_MS;
    return success(c, {
      status: 'approved',
      approved_at: approved.approved_at,
      cooldown_until: cooldownUntil,
    });
  }
  return success(c, { status: 'none' });
});

faceRoutes.post('/enroll', async (c) => {
  const session = c.get('session');

  // Already pending?
  const pending = await c.env.DB.prepare(
    'SELECT submitted_at, rejected_at FROM face_references_pending WHERE user_id = ?'
  ).bind(session.userId).first<{ submitted_at: string; rejected_at: string | null }>();
  if (pending && !pending.rejected_at) {
    return error(c, 'ALREADY_PENDING', 'A face enrollment is already pending HR approval', 409);
  }

  // Approved + still in 90-day cooldown?
  const approved = await c.env.DB.prepare(
    'SELECT approved_at FROM face_references WHERE user_id = ?'
  ).bind(session.userId).first<{ approved_at: string }>();
  if (approved) {
    const cooldownUntil = new Date(approved.approved_at).getTime() + RE_ENROLL_COOLDOWN_MS;
    if (Date.now() < cooldownUntil) {
      return error(c, 'COOLDOWN', `You can re-enrol after ${new Date(cooldownUntil).toISOString().slice(0, 10)}`, 429);
    }
  }

  // Receive raw image bytes (mirror existing /api/clock/:id/photo pattern)
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY', 'No photo', 400);
  if (body.byteLength > 2_000_000) return error(c, 'TOO_LARGE', 'Photo must be under 2MB', 400);

  const bytes = new Uint8Array(body);

  // Compute embedding now (also serves as a single-face sanity check —
  // a vision-LLM choice in face-match.ts would short-circuit on multi-face).
  let embedding: number[];
  try {
    embedding = await computeEmbedding(c.env, bytes);
  } catch (e) {
    devLog(c.env, `[FACE_ENROLL] embedding failed: ${e}`);
    return error(c, 'EMBEDDING_FAILED', 'Could not process the photo. Try better lighting or a closer crop.', 400);
  }

  // Store photo in R2 under pending/ prefix
  const photoKey = `face-references/pending/${session.userId}-${Date.now()}.jpg`;
  await c.env.STORAGE.put(photoKey, body, { httpMetadata: { contentType: 'image/jpeg' } });

  // Replace any prior pending row (rejected or otherwise — since we only get
  // here if not actively pending, this handles the resubmit-after-rejection case).
  await c.env.DB.prepare('DELETE FROM face_references_pending WHERE user_id = ?').bind(session.userId).run();

  await c.env.DB.prepare(
    `INSERT INTO face_references_pending (user_id, photo_key, embedding, model_id)
     VALUES (?, ?, ?, ?)`
  ).bind(session.userId, photoKey, serializeEmbedding(embedding), FACE_MODEL_ID).run();

  devLog(c.env, `[FACE_ENROLL] user=${session.userId} pending submitted`);
  return success(c, { status: 'pending' });
});
```

- [ ] **Step 2: Mount the routes**

Find where authenticated routes are mounted (likely in `packages/api/src/index.ts`). Add:

```typescript
import { faceRoutes } from './routes/face';
// inside authenticated mount block:
authedApp.route('/face', faceRoutes);
```

- [ ] **Step 3: Type-check**

```bash
cd packages/api && npx tsc --noEmit
```

- [ ] **Step 4: Integration verify (against `wrangler dev`)**

```bash
TOKEN=...  # session token

# Initial state — none
curl -s http://localhost:8787/api/face/me -H "Authorization: Bearer $TOKEN" | jq

# Submit an enrollment (use a real JPEG file)
curl -s -X POST http://localhost:8787/api/face/enroll \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: image/jpeg' \
  --data-binary @./test-fixtures/face1.jpg | jq

# Status now pending
curl -s http://localhost:8787/api/face/me -H "Authorization: Bearer $TOKEN" | jq
# Expected: {"data":{"status":"pending","submitted_at":"..."}}
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/face.ts packages/api/src/index.ts
git commit -m "feat(api): face enrollment routes (GET /me, POST /enroll)

Status read with precedence pending > rejected > approved > none.
Enrollment computes embedding via Workers AI, writes to R2 pending/
prefix and face_references_pending. Enforces 90-day cooldown after
prior approval; allows immediate re-submit after rejection."
```

---

## Task 6: Worker — admin face routes (queue, approve, reject, unlock)

**Files:**
- Create: `packages/api/src/routes/admin-face.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Identify the existing admin role-gate middleware**

```bash
grep -rn "requireRole\|f_and_a_admin\|superadmin" packages/api/src
```

Lock in the role list to be reused: `'superadmin'`, `'f_and_a_admin'` (and any HR-specific role if one exists). Mirror the exact role-check pattern.

- [ ] **Step 2: Create the admin route module**

Create `packages/api/src/routes/admin-face.ts`:

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { devLog } from '../lib/log';

export const adminFaceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Mount under an admin-only prefix in index.ts that runs requireRole(['superadmin','f_and_a_admin'])

adminFaceRoutes.get('/queue', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.user_id, p.photo_key, p.submitted_at, u.name, u.staff_id, u.role,
            d.name AS directorate_name, d.abbreviation AS directorate_abbr
     FROM face_references_pending p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN directorates d ON d.id = u.directorate_id
     WHERE p.rejected_at IS NULL
     ORDER BY p.submitted_at ASC`
  ).all<{
    user_id: string; photo_key: string; submitted_at: string;
    name: string; staff_id: string; role: string;
    directorate_name: string | null; directorate_abbr: string | null;
  }>();

  // Map to public shape — photo accessed via existing photo route, NOT a signed URL here.
  const queue = (rows.results ?? []).map((r) => ({
    user_id: r.user_id,
    name: r.name,
    staff_id: r.staff_id,
    role: r.role,
    directorate: r.directorate_name ? `${r.directorate_abbr} — ${r.directorate_name}` : null,
    submitted_at: r.submitted_at,
    photo_url: `/api/admin/face/${r.user_id}/pending-photo`,
  }));

  return success(c, queue);
});

// Stream the pending photo back via the admin route — keeps R2 keys server-side.
adminFaceRoutes.get('/:userId/pending-photo', async (c) => {
  const userId = c.req.param('userId');
  const row = await c.env.DB.prepare(
    'SELECT photo_key FROM face_references_pending WHERE user_id = ? AND rejected_at IS NULL'
  ).bind(userId).first<{ photo_key: string }>();
  if (!row) return error(c, 'NOT_FOUND', 'No pending enrollment', 404);

  const obj = await c.env.STORAGE.get(row.photo_key);
  if (!obj) return error(c, 'NOT_FOUND', 'Photo missing in storage', 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' },
  });
});

const approveSchema = z.object({ force: z.boolean().optional() });

adminFaceRoutes.post('/:userId/approve', zValidator('json', approveSchema), async (c) => {
  const adminSession = c.get('session');
  const userId = c.req.param('userId');

  const pending = await c.env.DB.prepare(
    `SELECT user_id, photo_key, embedding, model_id
     FROM face_references_pending WHERE user_id = ? AND rejected_at IS NULL`
  ).bind(userId).first<{ user_id: string; photo_key: string; embedding: ArrayBuffer; model_id: string }>();
  if (!pending) return error(c, 'NOT_FOUND', 'No pending enrollment', 404);

  const existing = await c.env.DB.prepare(
    'SELECT photo_key, embedding, model_id, approved_at FROM face_references WHERE user_id = ?'
  ).bind(userId).first<{ photo_key: string; embedding: ArrayBuffer; model_id: string; approved_at: string }>();

  // Move pending photo to active/ prefix
  const activeKey = `face-references/active/${userId}.jpg`;
  const pendingObj = await c.env.STORAGE.get(pending.photo_key);
  if (!pendingObj) return error(c, 'STORAGE_MISSING', 'Pending photo not in R2', 500);
  await c.env.STORAGE.put(activeKey, pendingObj.body, { httpMetadata: { contentType: 'image/jpeg' } });
  await c.env.STORAGE.delete(pending.photo_key);

  // Archive prior approved (if any) and replace
  if (existing) {
    await c.env.DB.prepare(
      `INSERT INTO face_references_archive (user_id, photo_key, embedding, model_id, approved_at, archived_reason)
       VALUES (?, ?, ?, ?, ?, 'replaced')`
    ).bind(userId, existing.photo_key, existing.embedding, existing.model_id, existing.approved_at).run();
    // Move the prior active photo to archive/ prefix
    const archiveKey = `face-references/archive/${userId}-${Date.now()}.jpg`;
    const oldObj = await c.env.STORAGE.get(existing.photo_key);
    if (oldObj) {
      await c.env.STORAGE.put(archiveKey, oldObj.body, { httpMetadata: { contentType: 'image/jpeg' } });
    }
    await c.env.DB.prepare('DELETE FROM face_references WHERE user_id = ?').bind(userId).run();
  }

  await c.env.DB.prepare(
    `INSERT INTO face_references (user_id, photo_key, embedding, model_id, approved_by)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(userId, activeKey, pending.embedding, pending.model_id, adminSession.userId).run();

  await c.env.DB.prepare('DELETE FROM face_references_pending WHERE user_id = ?').bind(userId).run();

  devLog(c.env, `[FACE_APPROVE] user=${userId} approved by ${adminSession.userId}`);
  return success(c, { status: 'approved' });
});

const rejectSchema = z.object({
  reason: z.enum(['blurry', 'wrong_person', 'lighting', 'other']),
  note: z.string().max(500).optional(),
});

adminFaceRoutes.post('/:userId/reject', zValidator('json', rejectSchema), async (c) => {
  const adminSession = c.get('session');
  const userId = c.req.param('userId');
  const { reason, note } = c.req.valid('json');

  const fullReason = note ? `${reason}: ${note}` : reason;

  const result = await c.env.DB.prepare(
    `UPDATE face_references_pending
       SET rejected_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
           rejected_reason = ?, rejected_by = ?
     WHERE user_id = ? AND rejected_at IS NULL`
  ).bind(fullReason, adminSession.userId, userId).run();

  if (result.meta.changes === 0) {
    return error(c, 'NOT_FOUND', 'No pending enrollment to reject', 404);
  }

  devLog(c.env, `[FACE_REJECT] user=${userId} reason="${fullReason}" by=${adminSession.userId}`);
  return success(c, { status: 'rejected' });
});

const unlockSchema = z.object({ reason: z.string().max(500).optional() });

adminFaceRoutes.post('/:userId/unlock', zValidator('json', unlockSchema), async (c) => {
  const adminSession = c.get('session');
  const userId = c.req.param('userId');
  const { reason } = c.req.valid('json');

  const isoDate = new Date().toISOString().slice(0, 10);
  await c.env.KV.delete(`face-match-attempts:${userId}:${isoDate}`);

  await c.env.DB.prepare(
    `INSERT INTO face_match_unlocks (user_id, unlocked_by, reason) VALUES (?, ?, ?)`
  ).bind(userId, adminSession.userId, reason ?? null).run();

  devLog(c.env, `[FACE_UNLOCK] user=${userId} by=${adminSession.userId} reason="${reason ?? '-'}"`);
  return success(c, { status: 'unlocked' });
});
```

- [ ] **Step 3: Mount under the admin role-gate**

In `packages/api/src/index.ts`:

```typescript
import { adminFaceRoutes } from './routes/admin-face';
// inside the admin role-gate block:
adminApp.route('/face', adminFaceRoutes);
```

- [ ] **Step 4: Type-check + integration verify**

```bash
cd packages/api && npx tsc --noEmit
```

Test:

```bash
ADMIN_TOKEN=...  # admin session
USER_ID=...      # user with a pending enrollment from Task 5

# 1. Queue
curl -s http://localhost:8787/api/admin/face/queue \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# 2. Photo
curl -s http://localhost:8787/api/admin/face/$USER_ID/pending-photo \
  -H "Authorization: Bearer $ADMIN_TOKEN" -o /tmp/pending.jpg
file /tmp/pending.jpg
# Expected: JPEG image data

# 3. Approve
curl -s -X POST http://localhost:8787/api/admin/face/$USER_ID/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{}' | jq

# 4. Confirm DB row migrated to face_references and pending row gone
npx wrangler d1 execute ohcs-smartgate --local --command="SELECT user_id, photo_key, model_id, approved_at FROM face_references;"
npx wrangler d1 execute ohcs-smartgate --local --command="SELECT * FROM face_references_pending;"
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/admin-face.ts packages/api/src/index.ts
git commit -m "feat(api): admin face routes (queue, approve, reject, unlock)

Queue with photo proxy (no signed URLs leaked), approve does the
pending → active R2 move + archive any prior reference, reject
records reason on the pending row, unlock clears the daily attempt
counter and audit-logs the override."
```

---

## Task 7: Worker — face-match step in `POST /api/clock/:id/photo`

**Files:**
- Modify: `packages/api/src/routes/clock.ts`

The face-match step slots into the existing photo upload route — that's where the just-captured selfie lands first. The clock-in record is already created by `POST /api/clock` from Plan 1; we update that row with the match result after running inference.

- [ ] **Step 1: Add imports**

In `packages/api/src/routes/clock.ts`, add:

```typescript
import {
  computeEmbedding,
  cosineSimilarity,
  normalizeScore,
  deserializeEmbedding,
  decideMatchStatus,
  shouldRejectStatus,
  getFaceMatchSettings,
  type MatchStatus,
} from '../services/face-match';
```

- [ ] **Step 2: Replace the existing `clockRoutes.post('/:id/photo', ...)` handler**

Locate the existing handler (currently lines 256–276) and replace with:

```typescript
clockRoutes.post('/:id/photo', async (c) => {
  const session = c.get('session');
  const clockId = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT id FROM clock_records WHERE id = ? AND user_id = ?'
  ).bind(clockId, session.userId).first<{ id: string }>();
  if (!record) return error(c, 'NOT_FOUND', 'Clock record not found', 404);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY', 'No photo', 400);
  if (body.byteLength > 500_000) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);

  // ---- Face-match step ----
  const fmSettings = await getFaceMatchSettings(c.env);
  let matchStatus: MatchStatus = 'not_enforced';
  let matchScore: number | null = null;

  if (fmSettings.enforcement !== 'off') {
    const ref = await c.env.DB.prepare(
      'SELECT embedding FROM face_references WHERE user_id = ?'
    ).bind(session.userId).first<{ embedding: ArrayBuffer }>();

    if (!ref) {
      matchStatus = 'no_reference';
    } else {
      try {
        const candidateBytes = new Uint8Array(body);
        const candidateEmbedding = await computeEmbedding(c.env, candidateBytes);
        const refEmbedding = deserializeEmbedding(ref.embedding);
        const cos = cosineSimilarity(candidateEmbedding, refEmbedding);
        matchScore = normalizeScore(cos);
        matchStatus = decideMatchStatus({
          enforcement: fmSettings.enforcement,
          hasReference: true,
          score: matchScore,
          lowThreshold: fmSettings.low,
          highThreshold: fmSettings.high,
        });
      } catch (e) {
        devLog(c.env, `[FACE_MATCH] inference failed for clockId=${clockId}: ${e}`);
        matchStatus = 'match_error';
        matchScore = null;
      }
    }

    // Hard reject under enforce mode → daily attempt counter + lockout
    if (shouldRejectStatus(matchStatus, fmSettings.enforcement)) {
      const isoDate = new Date().toISOString().slice(0, 10);
      const attemptKey = `face-match-attempts:${session.userId}:${isoDate}`;
      const cur = Number((await c.env.KV.get(attemptKey)) ?? '0') + 1;
      await c.env.KV.put(attemptKey, String(cur), { expirationTtl: 86400 });

      // Persist the failure on the clock-in row so admin sees the trail.
      await c.env.DB.prepare(
        `UPDATE clock_records SET match_status = ?, match_score = ? WHERE id = ?`
      ).bind(matchStatus, matchScore, clockId).run();

      if (cur >= 3) {
        // TODO(Task 9): notify HR via push
        return error(c, 'FACE_MATCH_LOCKED',
          `Face Match locked for today (3 failures). Your supervisor has been notified.`, 423);
      }
      return error(c, 'FACE_MATCH_FAILED',
        `Face didn't match — check the lighting and try again. (${3 - cur} attempt${3 - cur === 1 ? '' : 's'} left today.)`,
        401);
    }
  }

  // ---- Photo store + record update (only on accept/flag) ----
  const photoKey = `photos/clock/${clockId}.jpg`;
  await c.env.STORAGE.put(photoKey, body, { httpMetadata: { contentType: 'image/jpeg' } });

  const photoUrl = `/api/photos/clock/${clockId}`;
  await c.env.DB.prepare(
    `UPDATE clock_records SET photo_url = ?, match_status = ?, match_score = ? WHERE id = ?`
  ).bind(photoUrl, matchStatus, matchScore, clockId).run();

  return success(c, { photo_url: photoUrl, match_status: matchStatus, match_score: matchScore });
});
```

- [ ] **Step 3: Type-check**

```bash
cd packages/api && npx tsc --noEmit
```

- [ ] **Step 4: Integration verify — `off` mode (passthrough)**

```bash
# Default after Task 2 migration: face_match_enforcement='off'
TOKEN=...  # session
# Clock in (via Plan 1 flow) → upload photo
CLOCK_ID=$(curl -s -X POST http://localhost:8787/api/clock/ \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"clock_in","latitude":5.5527,"longitude":-0.1975,"accuracy":10,"prompt_id":"...","pin":"123456"}' \
  | jq -r '.data.id')
curl -s -X POST "http://localhost:8787/api/clock/$CLOCK_ID/photo" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: image/jpeg' \
  --data-binary @./test-fixtures/face1.jpg | jq

# Verify row: match_status='not_enforced', match_score=null
npx wrangler d1 execute ohcs-smartgate --local \
  --command="SELECT id, match_status, match_score FROM clock_records WHERE id='$CLOCK_ID';"
```

- [ ] **Step 5: Integration verify — `flag` mode**

```bash
npx wrangler d1 execute ohcs-smartgate --local \
  --command="UPDATE app_settings SET face_match_enforcement='flag' WHERE id=1;"
npx wrangler kv key delete --binding=KV --local "app-settings:v3"

# Need an enrolled+approved reference for $USER first (use admin approve from Task 6).
# Then a clock-in + photo upload.
curl -s -X POST "http://localhost:8787/api/clock/$CLOCK_ID/photo" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: image/jpeg' \
  --data-binary @./test-fixtures/face1.jpg | jq
# Expected: match_score populated, match_status one of match_strong/match_weak
```

- [ ] **Step 6: Integration verify — `enforce` mode hard reject**

Use a deliberately-mismatched photo (a different person):

```bash
npx wrangler d1 execute ohcs-smartgate --local \
  --command="UPDATE app_settings SET face_match_enforcement='enforce' WHERE id=1;"
npx wrangler kv key delete --binding=KV --local "app-settings:v3"

# Upload a wrong-person photo — expect 401 FACE_MATCH_FAILED (1st attempt)
curl -s -X POST "http://localhost:8787/api/clock/$CLOCK_ID/photo" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: image/jpeg' \
  --data-binary @./test-fixtures/different-person.jpg | jq

# Repeat 2 more times — 3rd should be 423 FACE_MATCH_LOCKED
```

Reset:

```bash
npx wrangler d1 execute ohcs-smartgate --local \
  --command="UPDATE app_settings SET face_match_enforcement='off' WHERE id=1;"
npx wrangler kv key delete --binding=KV --local "app-settings:v3"
```

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/clock.ts
git commit -m "feat(api): face-match step on POST /api/clock/:id/photo

Computes embedding via Workers AI, compares to face_references row,
decides accept/flag/reject by threshold band. Under enforce: persists
failure on the row, increments daily attempt counter, returns 423
LOCKED after 3 failures."
```

---

## Task 8: Worker — daily GC cron for archive + rejected references

**Files:**
- Create: `packages/api/src/cron/face-references-gc.ts`
- Modify: `packages/api/wrangler.toml`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Create the GC handler**

Create `packages/api/src/cron/face-references-gc.ts`:

```typescript
import type { Env } from '../types';

/**
 * Daily cleanup of face-reference photos and rows older than 30 days.
 *
 * - face_references_archive: rows where archived_at < now-30d → delete row + R2 object.
 * - face_references_pending where rejected_at < now-30d → delete row + R2 object.
 */
export async function runFaceReferencesGc(env: Env): Promise<{ archive: number; rejected: number }> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Archive
  const archiveRows = await env.DB.prepare(
    'SELECT id, photo_key FROM face_references_archive WHERE archived_at < ?'
  ).bind(cutoff).all<{ id: string; photo_key: string }>();

  let archiveDeleted = 0;
  for (const row of archiveRows.results ?? []) {
    await env.STORAGE.delete(row.photo_key);
    await env.DB.prepare('DELETE FROM face_references_archive WHERE id = ?').bind(row.id).run();
    archiveDeleted++;
  }

  // Rejected pendings
  const rejectedRows = await env.DB.prepare(
    'SELECT user_id, photo_key FROM face_references_pending WHERE rejected_at IS NOT NULL AND rejected_at < ?'
  ).bind(cutoff).all<{ user_id: string; photo_key: string }>();

  let rejectedDeleted = 0;
  for (const row of rejectedRows.results ?? []) {
    await env.STORAGE.delete(row.photo_key);
    await env.DB.prepare('DELETE FROM face_references_pending WHERE user_id = ?').bind(row.user_id).run();
    rejectedDeleted++;
  }

  console.log(`[face-gc] archive=${archiveDeleted} rejected=${rejectedDeleted}`);
  return { archive: archiveDeleted, rejected: rejectedDeleted };
}
```

- [ ] **Step 2: Wire into the existing scheduled handler**

Find the existing `scheduled` export in `packages/api/src/index.ts`:

```bash
grep -n "scheduled" packages/api/src/index.ts
```

Add the call:

```typescript
import { runFaceReferencesGc } from './cron/face-references-gc';

export default {
  // ... existing fetch
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // ... existing scheduled work
    if (event.cron === '0 3 * * *') {        // 03:00 UTC daily — pick a slot that's free
      await runFaceReferencesGc(env);
    }
  },
};
```

If there's already a daily cron, append the GC call to its branch instead.

- [ ] **Step 3: Add the cron schedule to `wrangler.toml`**

```toml
[triggers]
crons = ["0 3 * * *"]    # add to existing list, do not replace
```

- [ ] **Step 4: Verify the GC runs against canned 31-day-old data**

```bash
# Insert a 31-day-old archive row and an associated R2 object
OLD_DATE=$(date -u -d '31 days ago' +%Y-%m-%dT%H:%M:%SZ)
echo "fake-jpeg-bytes" > /tmp/old.jpg
curl -X PUT "http://localhost:8787/__r2__/face-references/archive/old-user.jpg" --data-binary @/tmp/old.jpg
# (or use wrangler r2 to put — verify the local r2 access path)

npx wrangler d1 execute ohcs-smartgate --local --command="
INSERT INTO face_references_archive (id, user_id, photo_key, embedding, model_id, approved_at, archived_at, archived_reason)
VALUES ('test1', (SELECT id FROM users LIMIT 1), 'face-references/archive/old-user.jpg', X'00', 'test', '$OLD_DATE', '$OLD_DATE', 'replaced');
"

# Trigger the cron
npx wrangler dev --local --test-scheduled
# Then in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"

# Verify deletion
npx wrangler d1 execute ohcs-smartgate --local --command="SELECT * FROM face_references_archive WHERE id='test1';"
# Expected: empty
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/cron/face-references-gc.ts packages/api/src/index.ts packages/api/wrangler.toml
git commit -m "feat(api): daily GC cron for face-reference archive + rejected

Drops face_references_archive rows and face_references_pending rejected
rows older than 30 days, deleting both the D1 row and the R2 object.
Scheduled at 03:00 UTC."
```

---

## Task 9: Worker — push notifications for HR queue + match-fail lockout

**Files:**
- Modify: `packages/api/src/routes/face.ts`
- Modify: `packages/api/src/routes/clock.ts`

The project already has VAPID push wired up (per memory). Reuse the existing notifier helper.

- [ ] **Step 1: Identify the existing push helper**

```bash
grep -rn "sendPush\|notifyAdmins\|webPush" packages/api/src
```

Locate the helper that sends push to a list of admin users.

- [ ] **Step 2: Notify HR on enrollment submission (throttled)**

In `packages/api/src/routes/face.ts`, after the successful insert into `face_references_pending`, add:

```typescript
  // Throttled: only notify HR once per hour to avoid spam.
  const throttleKey = 'face-enroll-notify-throttle';
  const lastNotified = await c.env.KV.get(throttleKey);
  if (!lastNotified) {
    await c.env.KV.put(throttleKey, '1', { expirationTtl: 3600 });
    c.executionCtx.waitUntil(notifyHrAdminsAboutFaceQueue(c.env));
  }
```

Implement `notifyHrAdminsAboutFaceQueue` in the same file or a small shared helper:

```typescript
async function notifyHrAdminsAboutFaceQueue(env: Env): Promise<void> {
  const admins = await env.DB.prepare(
    `SELECT id FROM users WHERE role IN ('superadmin','f_and_a_admin') AND is_active = 1`
  ).all<{ id: string }>();

  // Reuse the existing push helper. Adjust the import + call site to match
  // the project's actual signature — the call below assumes a sendPushToUser(env, userId, payload).
  for (const admin of admins.results ?? []) {
    // sendPushToUser(env, admin.id, {
    //   title: 'Face enrollment pending',
    //   body: 'A staff face enrollment is waiting for your approval',
    //   url: '/admin/face-queue',
    // });
  }
}
```

(The commented `sendPushToUser` call must be filled in against the actual helper from the project — replace the comment with a concrete call.)

- [ ] **Step 3: Notify HR on a match-fail lockout**

In `packages/api/src/routes/clock.ts` — inside the photo handler, in the branch that returns 423 FACE_MATCH_LOCKED — fire-and-forget a push:

```typescript
      if (cur >= 3) {
        c.executionCtx.waitUntil(notifyHrAdminsAboutFaceLockout(c.env, session.userId, session.name));
        return error(c, 'FACE_MATCH_LOCKED', /* ... */);
      }
```

Implement `notifyHrAdminsAboutFaceLockout` near `notifyHrAdminsAboutFaceQueue` (extract to a shared helper if duplication). Body: `${session.name} is locked out of clock-in (3 face-match failures today).`

- [ ] **Step 4: Type-check + manual verify**

```bash
cd packages/api && npx tsc --noEmit
```

Manually trigger the lockout path (see Task 7 step 6) and confirm an HR admin receives the push.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/face.ts packages/api/src/routes/clock.ts
git commit -m "feat(api): HR push notifications for face queue + lockout

Throttled (1/hour) push when a new enrollment lands in the queue.
Immediate push on every 3rd-strike face-match lockout."
```

---

## Task 10: PWA — staff `EnrollFacePage` with guided capture

**Files:**
- Create: `packages/staff/src/pages/EnrollFacePage.tsx`
- Modify: `packages/staff/src/lib/api.ts` (add face-API helpers)
- Modify: `packages/staff/src/App.tsx` (or router file — verify) — register the route

- [ ] **Step 1: Add API helpers**

In `packages/staff/src/lib/api.ts`:

```typescript
export type FaceStatus =
  | { status: 'none' }
  | { status: 'pending'; submitted_at: string }
  | { status: 'rejected'; submitted_at: string; rejected_reason: string }
  | { status: 'approved'; approved_at: string; cooldown_until: number };

export async function getFaceStatus(): Promise<FaceStatus> {
  const res = await apiFetch('/api/face/me', { method: 'GET' });
  return res.data;
}

export async function submitFaceEnrollment(photoBlob: Blob): Promise<void> {
  const res = await fetch('/api/face/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: photoBlob,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error('Enrollment failed'), { code: body?.error?.code, message: body?.error?.message });
  }
}
```

- [ ] **Step 2: Create the enrollment page**

Create `packages/staff/src/pages/EnrollFacePage.tsx`. The skeleton — the existing `ClockPage` already has camera-capture logic; reuse the same helpers (or extract a shared `useCamera` hook in a follow-up cleanup task if duplication is significant).

```tsx
import { useEffect, useRef, useState } from 'react';
import { getFaceStatus, submitFaceEnrollment, type FaceStatus } from '../lib/api';

export function EnrollFacePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getFaceStatus().then(setStatus).catch(() => setStatus({ status: 'none' })); }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreamActive(true);
      }
    } catch {
      setError('Camera permission denied. Allow camera in browser settings to continue.');
    }
  };

  const capture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current, c = canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(v, 0, 0);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.9));

    setSubmitting(true);
    setError(null);
    try {
      await submitFaceEnrollment(blob);
      setStatus({ status: 'pending', submitted_at: new Date().toISOString() });
      // Stop camera
      (v.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
      setStreamActive(false);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'COOLDOWN') setError('You can re-enrol after the 90-day cooldown.');
      else if (code === 'EMBEDDING_FAILED') setError('Could not process the photo — try better lighting.');
      else setError('Submission failed — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-3">Set up Face ID for clock-in</h1>

      {status?.status === 'approved' && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 mb-4">
          <p className="text-emerald-900 font-semibold">✅ Face ID active</p>
          <p className="text-sm text-emerald-800 mt-1">
            Approved on {new Date(status.approved_at).toLocaleDateString()}.
            You can re-enrol after {new Date(status.cooldown_until).toLocaleDateString()}.
          </p>
        </div>
      )}

      {status?.status === 'pending' && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 mb-4">
          <p className="text-amber-900 font-semibold">⏳ Pending HR approval</p>
          <p className="text-sm text-amber-800 mt-1">
            Submitted {new Date(status.submitted_at).toLocaleString()}. You'll get a notification when approved.
          </p>
        </div>
      )}

      {status?.status === 'rejected' && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 mb-4">
          <p className="text-rose-900 font-semibold">✗ Rejected</p>
          <p className="text-sm text-rose-800 mt-1">Reason: {status.rejected_reason}</p>
          <p className="text-sm text-rose-800 mt-1">Try again with better lighting.</p>
        </div>
      )}

      {(status?.status === 'none' || status?.status === 'rejected') && !streamActive && (
        <button
          onClick={startCamera}
          className="w-full px-4 py-4 rounded-2xl bg-emerald-600 text-white font-semibold"
        >
          Start camera
        </button>
      )}

      {streamActive && (
        <div>
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-black">
            <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" playsInline muted />
            <div
              className="absolute inset-8 rounded-full border-4 border-white/50 pointer-events-none"
              aria-hidden
            />
          </div>
          <p className="mt-3 text-sm text-slate-600 text-center">
            Center your face inside the oval. Good light, plain background.
          </p>
          <button
            onClick={capture}
            disabled={submitting}
            className="mt-4 w-full px-4 py-4 rounded-2xl bg-emerald-600 text-white font-semibold disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Capture and submit'}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-rose-600 text-center" role="alert">{error}</p>}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
```

- [ ] **Step 3: Register the route**

In the staff PWA's router (`packages/staff/src/App.tsx` or equivalent — verify):

```typescript
import { EnrollFacePage } from './pages/EnrollFacePage';
// add route:
<Route path="/enroll-face" element={<EnrollFacePage />} />
```

- [ ] **Step 4: Add a link from Settings**

Locate the Settings page (`packages/staff/src/pages/SettingsPage.tsx` or wherever profile actions live):

```bash
grep -rn "Settings\|biometric" packages/staff/src/pages
```

Add a row linking to `/enroll-face` with a status badge derived from `getFaceStatus()`.

- [ ] **Step 5: Type-check + manual browser verify**

```bash
cd packages/staff && npx tsc --noEmit && npm run dev
```

Sign in, navigate to `/enroll-face`, capture and submit. Verify the API returns `{ status: 'pending' }` and the UI updates accordingly.

- [ ] **Step 6: Commit**

```bash
git add packages/staff/src/pages/EnrollFacePage.tsx packages/staff/src/lib/api.ts packages/staff/src/App.tsx packages/staff/src/pages/SettingsPage.tsx
git commit -m "feat(staff): face enrollment page with guided capture

EnrollFacePage with circular framing overlay, status display
(none/pending/rejected/approved), submission to /api/face/enroll.
Settings entry-point with status badge."
```

---

## Task 11: PWA — `FaceMatchFailedModal` for hard-reject UX

**Files:**
- Create: `packages/staff/src/components/FaceMatchFailedModal.tsx`
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Create the modal**

Create `packages/staff/src/components/FaceMatchFailedModal.tsx`:

```tsx
interface FaceMatchFailedModalProps {
  isOpen: boolean;
  attemptsLeft: number | null;       // null when locked
  onRetry: () => void;
  onClose: () => void;
}

export function FaceMatchFailedModal({ isOpen, attemptsLeft, onRetry, onClose }: FaceMatchFailedModalProps) {
  if (!isOpen) return null;
  const locked = attemptsLeft === null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl">
        <div className="w-14 h-14 rounded-full bg-rose-100 grid place-items-center mx-auto text-2xl">😕</div>
        <h2 className="mt-3 text-lg font-semibold text-slate-900 text-center">
          {locked ? 'Locked for today' : 'Face didn\'t match'}
        </h2>
        <p className="mt-2 text-sm text-slate-600 text-center">
          {locked
            ? 'Three face-match failures today. Your supervisor has been notified — please contact HR to unlock.'
            : `Check the lighting and try again. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left today.`}
        </p>
        <div className="mt-4 grid gap-2">
          {!locked && (
            <button
              onClick={onRetry}
              className="px-4 py-3 rounded-2xl text-white bg-emerald-600 font-medium"
            >
              Try again
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-2xl text-slate-700 bg-slate-100 font-medium"
          >
            {locked ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into ClockPage's photo-upload error path**

In `packages/staff/src/pages/ClockPage.tsx`, find where `uploadPhotoForRecord` is called and add error handling:

```typescript
  const [matchFailed, setMatchFailed] = useState<{ attemptsLeft: number | null } | null>(null);

  // … inside the upload error handler:
  catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'FACE_MATCH_FAILED') {
      // The error message includes "(N attempts left today.)" — parse it
      const m = /(\d+) attempt/.exec((e as { message?: string }).message ?? '');
      setMatchFailed({ attemptsLeft: m ? Number(m[1]) : 1 });
    } else if (code === 'FACE_MATCH_LOCKED') {
      setMatchFailed({ attemptsLeft: null });
    } else {
      // existing error handling
    }
  }
```

And render the modal:

```tsx
<FaceMatchFailedModal
  isOpen={matchFailed !== null}
  attemptsLeft={matchFailed?.attemptsLeft ?? null}
  onRetry={() => { setMatchFailed(null); handleClockAction('clock_in'); }}
  onClose={() => setMatchFailed(null)}
/>
```

- [ ] **Step 3: Type-check + manual browser verify**

```bash
cd packages/staff && npx tsc --noEmit
```

Trigger a deliberate face mismatch (use a different person's photo via dev tools to override the captured blob, or temporarily lower the threshold to 0.99). Verify the modal appears with the right message.

- [ ] **Step 4: Commit**

```bash
git add packages/staff/src/components/FaceMatchFailedModal.tsx packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): FaceMatchFailedModal + ClockPage retry flow

Shows attempts-remaining or locked-for-today copy based on the
server's error code. Retry button restarts the clock-in flow,
which fetches a fresh prompt and re-runs the full pipeline."
```

---

## Task 12: Web (admin) — `FaceApprovalQueue` page + match columns + unlock button

**Files:**
- Create: `packages/web/src/pages/FaceApprovalQueuePage.tsx`
- Modify: `packages/web/src/components/admin/AttendanceTab.tsx`
- Create: `packages/web/src/components/admin/FaceUnlockButton.tsx`
- Modify: admin nav (find via `grep -rn "AttendanceTab\|adminNav" packages/web/src`)

- [ ] **Step 1: Create the approval queue page**

Create `packages/web/src/pages/FaceApprovalQueuePage.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface QueueItem {
  user_id: string;
  name: string;
  staff_id: string;
  role: string;
  directorate: string | null;
  submitted_at: string;
  photo_url: string;
}

export function FaceApprovalQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const r = await fetch('/api/admin/face/queue', { credentials: 'include' });
    const body = await r.json();
    setItems(body.data ?? []);
  };

  useEffect(() => { refresh(); }, []);

  const approve = async (userId: string) => {
    setBusy(userId);
    await fetch(`/api/admin/face/${userId}/approve`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await refresh();
    setBusy(null);
  };

  const reject = async (userId: string) => {
    const reason = prompt('Reason: blurry, wrong_person, lighting, other')?.trim();
    if (!reason || !['blurry', 'wrong_person', 'lighting', 'other'].includes(reason)) return;
    setBusy(userId);
    await fetch(`/api/admin/face/${userId}/reject`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    await refresh();
    setBusy(null);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">Face enrollments — pending</h1>
      {items.length === 0 ? (
        <p className="text-slate-500">Queue is empty.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((it) => (
            <div key={it.user_id} className="bg-white rounded-2xl border border-slate-200 p-4">
              <img src={it.photo_url} alt={`${it.name} pending`} className="w-full aspect-square object-cover rounded-xl bg-slate-100" />
              <p className="mt-3 font-semibold text-slate-900">{it.name}</p>
              <p className="text-sm text-slate-500">{it.staff_id} · {it.role}</p>
              {it.directorate && <p className="text-sm text-slate-500">{it.directorate}</p>}
              <p className="text-xs text-slate-400 mt-1">Submitted {new Date(it.submitted_at).toLocaleString()}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => approve(it.user_id)}
                  disabled={busy === it.user_id}
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => reject(it.user_id)}
                  disabled={busy === it.user_id}
                  className="px-3 py-2 rounded-xl bg-rose-100 text-rose-700 font-medium disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route + nav entry**

Find the admin router and add:

```typescript
<Route path="/admin/face-queue" element={<FaceApprovalQueuePage />} />
```

Add a nav entry in the admin nav with a count badge if the queue is non-empty.

- [ ] **Step 3: Add match columns to `AttendanceTab.tsx`**

Update the API admin records-fetch (Task 10 from Plan 1 already extended the projection — add `match_score` and `match_status` here too).

In `packages/web/src/components/admin/AttendanceTab.tsx`, add columns:

```tsx
<th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Match</th>
```

Row cell:

```tsx
<td className="px-3 py-2 text-sm">
  {record.match_status === 'match_strong' && (
    <span className="text-emerald-700">✓ {record.match_score?.toFixed(2)}</span>
  )}
  {record.match_status === 'match_weak' && (
    <span className="text-amber-700">⚠ {record.match_score?.toFixed(2)}</span>
  )}
  {record.match_status === 'match_fail' && (
    <span className="text-rose-700 font-semibold">✗ {record.match_score?.toFixed(2)}</span>
  )}
  {record.match_status === 'no_reference' && (
    <span className="text-slate-400">unenrolled</span>
  )}
  {record.match_status === 'match_error' && (
    <span className="text-slate-400">infer-fail</span>
  )}
  {(!record.match_status || record.match_status === 'not_enforced') && (
    <span className="text-slate-300">—</span>
  )}
</td>
```

Add a filter checkbox: "Show only flagged matches" — filters to `match_status IN ('match_weak','match_fail','no_reference','match_error')`.

- [ ] **Step 4: Create `FaceUnlockButton`**

Create `packages/web/src/components/admin/FaceUnlockButton.tsx`:

```tsx
interface FaceUnlockButtonProps {
  userId: string;
  matchStatus: string | null;
  onUnlocked?: () => void;
}

export function FaceUnlockButton({ userId, matchStatus, onUnlocked }: FaceUnlockButtonProps) {
  const isLocked = matchStatus === 'match_fail';
  if (!isLocked) return null;

  const unlock = async () => {
    const reason = prompt('Reason for unlock?')?.trim() ?? '';
    const r = await fetch(`/api/admin/face/${userId}/unlock`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (r.ok) onUnlocked?.();
  };

  return (
    <button onClick={unlock} className="text-xs text-emerald-700 underline">
      Unlock
    </button>
  );
}
```

Render this button in the row's action area.

- [ ] **Step 5: Type-check + manual verify**

```bash
cd packages/web && npx tsc --noEmit && npm run dev
```

Sign in as admin, visit `/admin/face-queue`, approve a pending row, observe it move to `face_references` and the queue empty.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/FaceApprovalQueuePage.tsx packages/web/src/components/admin/AttendanceTab.tsx packages/web/src/components/admin/FaceUnlockButton.tsx
# plus router/nav files
git commit -m "feat(web): admin face approval queue + match columns + unlock

New /admin/face-queue page lists pending enrollments with photo,
approve/reject actions. Attendance tab gains a Match column with
score + status badge and an HR Unlock action on failed rows."
```

---

## Task 13: Dev-only `DEV_BYPASS_FACE_MATCH` env flag

**Files:**
- Modify: `packages/api/src/routes/clock.ts`
- Modify: `packages/api/wrangler.toml`
- Modify: `packages/api/src/types.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Skip face-match when the flag is set**

In `clock.ts` photo handler — at the top of the face-match block:

```typescript
  const fmSettings = await getFaceMatchSettings(c.env);
  const devBypass = c.env.DEV_BYPASS_FACE_MATCH === 'true';
  let matchStatus: MatchStatus = devBypass ? 'not_enforced' : 'not_enforced';
  let matchScore: number | null = null;

  if (!devBypass && fmSettings.enforcement !== 'off') {
    // ... existing face-match logic
  }
```

- [ ] **Step 2: Boot-time guard**

In the entry file, alongside the existing `DEV_BYPASS_REAUTH` guard from Plan 1:

```typescript
if (env.ENVIRONMENT === 'production' && env.DEV_BYPASS_FACE_MATCH === 'true') {
  throw new Error('Refusing to start: DEV_BYPASS_FACE_MATCH must not be true in production');
}
```

- [ ] **Step 3: Add to types + wrangler.toml**

In `types.ts`:

```typescript
DEV_BYPASS_FACE_MATCH?: string;
```

In `wrangler.toml`:

```toml
DEV_BYPASS_FACE_MATCH = "false"
```

- [ ] **Step 4: Type-check + commit**

```bash
cd packages/api && npx tsc --noEmit

git add packages/api/src/routes/clock.ts packages/api/src/types.ts packages/api/src/index.ts packages/api/wrangler.toml
git commit -m "feat(api): DEV_BYPASS_FACE_MATCH for dev/staging testing

Skips face-match entirely when set. Worker refuses to start with
the flag enabled in production."
```

---

## Task 14: Pilot enrollment with 5 staff volunteers

**Files:**
- None (operational).

- [ ] **Step 1: Deploy current state to staging**

```bash
git push origin main
# Wait for GitHub Actions
```

Apply the migration in staging D1:

```bash
cd packages/api
npx wrangler d1 execute ohcs-smartgate --remote --file=src/db/migration-face-match.sql
```

- [ ] **Step 2: Confirm settings default**

```bash
npx wrangler d1 execute ohcs-smartgate --remote \
  --command="SELECT face_match_enforcement, face_match_low_threshold, face_match_high_threshold FROM app_settings WHERE id=1;"
```

Expected: `('off', 0.55, 0.85)`.

- [ ] **Step 3: Have 5 staff enrol via `/enroll-face`**

Pick 5 staff who already have WebAuthn enrolled and a recent clock-in history. Walk them through enrollment (in person or via call). HR approves their submissions through `/admin/face-queue`.

- [ ] **Step 4: Capture each pilot's score under `flag` mode**

Flip enforcement to `flag`:

```bash
npx wrangler d1 execute ohcs-smartgate --remote \
  --command="UPDATE app_settings SET face_match_enforcement='flag' WHERE id=1;"
npx wrangler kv key delete --binding=KV --remote "app-settings:v3"
```

Have each pilot clock in normally for 5 working days. Pull the score distribution:

```bash
npx wrangler d1 execute ohcs-smartgate --remote --command="
SELECT u.staff_id, cr.match_status, cr.match_score, cr.timestamp
FROM clock_records cr JOIN users u ON u.id = cr.user_id
WHERE cr.match_status IS NOT NULL AND cr.match_status != 'not_enforced'
  AND cr.timestamp > strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now','-7 days'))
ORDER BY cr.timestamp DESC;
"
```

- [ ] **Step 5: Compute the threshold tuning numbers**

Manually (spreadsheet or quick script):
- 99th percentile of `match_score` for each user where `match_status` ∈ `match_strong | match_weak`. This is the intra-user lower bound.
- Synthetic mismatch: take each pilot's reference photo, run it against another pilot's clock-in selfie via the spike Worker (Task 1, redeployed temporarily) → cross-user score sample.
- 99th percentile of cross-user scores → upper bound for `LOW_THRESHOLD` minus a margin.

If the gap between intra-user p99 and cross-user p99 is < 0.05, the model is too weak — escalate to swap to vision-LLM mode (Task 1's option 2).

- [ ] **Step 6: Update thresholds**

If the data warrants:

```bash
npx wrangler d1 execute ohcs-smartgate --remote \
  --command="UPDATE app_settings SET face_match_low_threshold = 0.X, face_match_high_threshold = 0.Y WHERE id = 1;"
npx wrangler kv key delete --binding=KV --remote "app-settings:v3"
```

Document the chosen thresholds and the data behind them in a follow-up commit to the spec's appendix.

---

## Task 15: Soft rollout to all staff under `flag` mode

**Files:**
- None (operational).

- [ ] **Step 1: Open enrollment to all staff**

Surface the EnrollFacePage banner on the staff PWA homepage for users whose `face_status === 'none'`. Already linked from Settings; this adds visibility.

```tsx
{faceStatus?.status === 'none' && (
  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 m-4">
    <p className="font-semibold">Set up Face ID</p>
    <p className="text-sm">Adds a face check on every clock-in. Takes 30 seconds.</p>
    <Link to="/enroll-face" className="text-emerald-700 underline">Set up</Link>
  </div>
)}
```

- [ ] **Step 2: Track enrollment progress**

Daily query:

```bash
npx wrangler d1 execute ohcs-smartgate --remote --command="
SELECT
  COUNT(*) AS active_staff,
  (SELECT COUNT(*) FROM face_references) AS enrolled,
  ROUND(100.0 * (SELECT COUNT(*) FROM face_references) / NULLIF(COUNT(*), 0), 1) AS pct_enrolled
FROM users WHERE is_active = 1;
"
```

Target: 80% before flipping to `enforce`.

- [ ] **Step 3: Track flag-mode false-positive rate**

Daily query:

```bash
npx wrangler d1 execute ohcs-smartgate --remote --command="
SELECT
  COUNT(*) FILTER (WHERE match_status = 'match_weak') AS flagged,
  COUNT(*) FILTER (WHERE match_status = 'match_fail') AS failed,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE match_status IN ('match_weak','match_fail')) / NULLIF(COUNT(*), 0), 1) AS flag_pct
FROM clock_records
WHERE match_status IS NOT NULL AND match_status NOT IN ('not_enforced','no_reference','match_error')
  AND timestamp > strftime('%Y-%m-%dT%H:%M:%SZ', datetime('now','-7 days'));
"
```

Acceptance: `flag_pct < 5%` over a 7-day window.

- [ ] **Step 4: HR triages flagged rows**

HR opens AttendanceTab daily, sorts by Match column, manually verifies any `match_weak` or `match_fail` rows by looking at the photo. If most are real false-positives (e.g. backlit photos), retune `face_match_low_threshold` downward by 0.05 increments.

---

## Task 16: Flip enforcement to `enforce`

**Files:**
- None (D1 update + runbook).

- [ ] **Step 1: Pre-flight checks**

Confirm:
- [ ] Enrollment ≥ 80%.
- [ ] flag_pct < 5% over a 7-day window.
- [ ] HR has reviewed at least 20 flagged rows and confirmed the threshold split feels right.

- [ ] **Step 2: Flip the flag**

```bash
npx wrangler d1 execute ohcs-smartgate --remote \
  --command="UPDATE app_settings SET face_match_enforcement='enforce', updated_by='rollout', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=1;"
npx wrangler kv key delete --binding=KV --remote "app-settings:v3"
```

- [ ] **Step 3: Smoke-test enforcement**

A staff member with `face_references.no_reference` (i.e., not yet enrolled) attempts a clock-in selfie upload — expect 401 FACE_MATCH_FAILED with `match_status='no_reference'`.

A staff member with an enrolled reference and a wrong-person photo — expect 401 with `match_status='match_fail'`.

- [ ] **Step 4: Add to runbook**

Append to `docs/runbooks/clockin-reauth.md` (created in Plan 1's Task 13):

```markdown
## Face-match controls

- **Kill-switch:** UPDATE app_settings SET face_match_enforcement='off' WHERE id=1; then DELETE 'app-settings:v3' from KV.
- **Soft-flag mode (no rejects, just admin flags):** SET face_match_enforcement='flag'.
- **Threshold tuning:** UPDATE app_settings SET face_match_low_threshold=0.X, face_match_high_threshold=0.Y WHERE id=1; KV invalidation as above.
- **Common errors:**
  - FACE_MATCH_FAILED → user's selfie is below LOW threshold. Up to 3 retries per day.
  - FACE_MATCH_LOCKED → user hit 3 failures today. HR clicks Unlock from AttendanceTab.
  - no_reference → user not yet enrolled. Direct them to /enroll-face.
- **Manual unlock:** clear the KV key `face-match-attempts:{userId}:{YYYY-MM-DD}` or use the admin Unlock button (audit-logged in face_match_unlocks).
- **Re-enrollment after major appearance change:** HR can override the 90-day cooldown by passing `?force=true` on POST /api/admin/face/:userId/approve (only after the user submits a new pending row).
```

- [ ] **Step 5: Commit the runbook update**

```bash
git add docs/runbooks/clockin-reauth.md
git commit -m "docs: face-match controls + enforcement runbook"
```

---

## Done

Once Task 16 is complete: every clock-in now requires (1) a fresh single-use prompt that must appear in the photo, (2) a biometric or PIN re-auth bound to that prompt, and (3) a server-side face match against an HR-approved enrolled reference. The three layers are independent and individually killswitchable via `app_settings`.

The lingering attack surface — a printed photo of the real staff held up to the camera — remains the only realistic gap. Closing it requires either ML liveness (deferred per the spec) or pairing the prompt mechanism with a vision LLM that auto-verifies the prompt is visible (deferred per Plan 1's spec, eligible for a v2 plan once admin-review data shows it's needed).
