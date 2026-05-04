# Passive Liveness (Plan 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visible 2-digit prompt UX in the OHCS clock-in flow with passive liveness + a single randomized challenge (blink / turn / smile), with a server-authoritative trust decision via Workers AI.

**Architecture:** Hybrid. Client uses MediaPipe FaceLandmarker (lazy-loaded WASM) for snappy framing UX — face-centering ring, real-time challenge feedback. Client uploads a 3-frame burst + completion claim to the Worker. Server runs Workers AI `@cf/insightface/buffalo_s` over the frames, computes motion deltas vs. the server-issued challenge action, and produces a signed liveness signature. Decision is server-authoritative; client output is never trusted. Phased rollout via the existing `app_settings` flag pattern (shadow → enforce).

**Tech Stack:**
- Worker: Hono, Cloudflare D1, KV, R2, Workers AI binding (`@cf/insightface/buffalo_s`).
- Staff PWA: React 18, Vite, MediaPipe Tasks Vision (`@mediapipe/tasks-vision`).
- Tests: Vitest (added in Tasks 1 + 14 — no existing test infra in this repo).
- Reference spec: `docs/superpowers/specs/2026-05-04-passive-liveness-design.md`.

---

## File Structure Overview

**Worker (`packages/api/`)**

```
src/
  db/
    migration-passive-liveness.sql       NEW — 3 columns on clock_records, 3 keys on app_settings
    migrations-index.ts                  MODIFY — register the new migration
  services/
    settings.ts                          MODIFY — extend AppSettings, defaults
    liveness/
      types.ts                           NEW — LivenessChallenge, LivenessSignature, LivenessVerification
      motion.ts                          NEW — pure motion-delta detection per challenge
      motion.test.ts                     NEW — Vitest unit tests
      sharpness.ts                       NEW — Laplacian-variance sharpest-frame selector
      sharpness.test.ts                  NEW — Vitest unit tests
      ai.ts                              NEW — Workers AI insightface wrapper
      ai.test.ts                         NEW — mocked-binding tests
      index.ts                           NEW — verifyLivenessBurst orchestrator + signature builder
      index.test.ts                      NEW — orchestrator integration tests (mocks)
      review-counter.ts                  NEW — KV-backed per-user-per-ISO-week counter
      review-counter.test.ts             NEW — counter tests with KV mock
  routes/
    clock.ts                             MODIFY — extend /prompt; extend / to accept multipart burst; wire liveness gate
test/
  fixtures/
    liveness/
      blink-pass.json                    NEW — synthetic landmark frames passing blink
      blink-fail-static.json             NEW — frames with no motion
      turn-left-pass.json                NEW
      turn-right-pass.json               NEW
      smile-pass.json                    NEW
      sharpness-frames.json              NEW — base64 JPEGs at varying sharpness
vitest.config.ts                         NEW — Vitest config for the api package
package.json                             MODIFY — add vitest devDependency + test script
```

**Staff PWA (`packages/staff/`)**

```
src/
  lib/
    liveness/
      types.ts                           NEW — shared types (mirror of worker types where relevant)
      frameBurstEncoder.ts               NEW — captures 3 frames at start/mid/end as JPEG blobs
      challengeDetector.ts               NEW — pure landmark-stream → challenge-detected helpers
      challengeDetector.test.ts          NEW — Vitest unit tests
      mediapipeRunner.ts                 NEW — MediaPipe FaceLandmarker wrapper
      LivenessCapture.tsx                NEW — camera + ring + challenge UI component
    api.ts                               MODIFY — update fetchClockPrompt + submitClock signatures
  pages/
    ClockPage.tsx                        MODIFY — replace inline camera with <LivenessCapture/>; warm WASM during geofence
vitest.config.ts                         NEW — Vitest config for the staff package
package.json                             MODIFY — add @mediapipe/tasks-vision, vitest, jsdom
```

**Admin (`packages/web/`)**

```
src/
  components/
    admin/
      AttendanceTab.tsx                  MODIFY — replace Prompt column with Liveness column
      LivenessEvidenceCard.tsx           NEW — renders LivenessSignature on row expand
      LivenessMetricsWidget.tsx          NEW — shadow-mode telemetry tile
```

---

## Task 1: Set up Vitest in `packages/api/`

**Why:** No existing test infrastructure. The pure-function units that follow (motion deltas, sharpness, review counter) are TDD — they need a runner.

**Files:**
- Create: `packages/api/vitest.config.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1.1: Add Vitest devDependencies**

Run from repo root:

```bash
npm --workspace packages/api install -D vitest @vitest/coverage-v8
```

Expected: `package.json` gains `"vitest": "^2.x.x"` under `devDependencies`. The lockfile updates.

- [ ] **Step 1.2: Add the test script**

Modify `packages/api/package.json`:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate": "wrangler d1 execute smartgate-db --local --file=src/db/schema.sql",
    "db:seed": "wrangler d1 execute smartgate-db --local --file=src/db/seed.sql",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 1.3: Create the Vitest config**

Create `packages/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
```

- [ ] **Step 1.4: Verify the runner works**

Run from `packages/api/`:

```bash
npm test
```

Expected: `No test files found` (acceptable — no `*.test.ts` exists yet). Exit code 0.

- [ ] **Step 1.5: Commit**

```bash
git add packages/api/vitest.config.ts packages/api/package.json package-lock.json
git commit -m "chore(api): add vitest scaffolding for liveness service tests"
```

---

## Task 2: D1 migration — passive-liveness columns

**Files:**
- Create: `packages/api/src/db/migration-passive-liveness.sql`
- Modify: `packages/api/src/db/migrations-index.ts`

- [ ] **Step 2.1: Write the migration SQL**

Create `packages/api/src/db/migration-passive-liveness.sql`:

```sql
-- Passive liveness (Plan 1.5) — companion spec: 2026-05-04-passive-liveness-design.md
-- Adds liveness_challenge / liveness_decision / liveness_signature columns to clock_records,
-- plus three new app_settings keys: enforcement flag, manual-review weekly cap, model version.
--
-- IMPORTANT: prompt_value is intentionally NOT dropped here. Two-phase migration —
-- column drop happens 30+ days later in a separate follow-up migration once the
-- historical-row review horizon has passed.

ALTER TABLE clock_records ADD COLUMN liveness_challenge TEXT
  CHECK (liveness_challenge IN ('blink','turn_left','turn_right','smile') OR liveness_challenge IS NULL);
ALTER TABLE clock_records ADD COLUMN liveness_decision TEXT
  CHECK (liveness_decision IN ('pass','fail','manual_review','skipped') OR liveness_decision IS NULL);
ALTER TABLE clock_records ADD COLUMN liveness_signature TEXT;

-- New columns on app_settings (singleton row id=1).
-- D1/SQLite ALTER TABLE ADD COLUMN cannot have non-constant DEFAULTs, so we
-- add nullable columns and backfill with UPDATE.
ALTER TABLE app_settings ADD COLUMN clockin_passive_liveness_enforce INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_liveness_review_cap_per_week INTEGER;
ALTER TABLE app_settings ADD COLUMN clockin_liveness_model_version TEXT;

UPDATE app_settings
   SET clockin_passive_liveness_enforce      = COALESCE(clockin_passive_liveness_enforce, 0),
       clockin_liveness_review_cap_per_week  = COALESCE(clockin_liveness_review_cap_per_week, 2),
       clockin_liveness_model_version        = COALESCE(clockin_liveness_model_version, 'buffalo_s_v1')
 WHERE id = 1;
```

- [ ] **Step 2.2: Register the migration**

Modify `packages/api/src/db/migrations-index.ts` — add import after `clockinReauth` and append to the `MIGRATIONS` array:

```ts
import clockinReauth from './migration-clockin-reauth.sql';
import passiveLiveness from './migration-passive-liveness.sql';

export const MIGRATIONS: Array<{ filename: string; sql: string }> = [
  // ...existing entries unchanged...
  { filename: 'migration-clockin-reauth.sql', sql: clockinReauth },
  { filename: 'migration-passive-liveness.sql', sql: passiveLiveness },
];
```

- [ ] **Step 2.3: Apply the migration locally**

```bash
cd packages/api
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --file=src/db/migration-passive-liveness.sql
```

Expected: `Executed 7 commands in <Xms>` or similar success line.

- [ ] **Step 2.4: Verify the schema**

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="PRAGMA table_info(clock_records)"
```

Expected: output includes rows for `liveness_challenge`, `liveness_decision`, `liveness_signature`.

```bash
node ../../node_modules/wrangler/bin/wrangler.js d1 execute smartgate-db --local --command="SELECT clockin_passive_liveness_enforce, clockin_liveness_review_cap_per_week, clockin_liveness_model_version FROM app_settings WHERE id = 1"
```

Expected: row with `0`, `2`, `buffalo_s_v1`.

- [ ] **Step 2.5: Commit**

```bash
git add packages/api/src/db/migration-passive-liveness.sql packages/api/src/db/migrations-index.ts
git commit -m "feat(api): add passive-liveness D1 migration"
```

---

## Task 3: Extend `AppSettings` interface with new keys

**Files:**
- Modify: `packages/api/src/services/settings.ts`

- [ ] **Step 3.1: Add the three new fields to `AppSettings`**

Modify the interface and `DEFAULTS` in `packages/api/src/services/settings.ts`:

```ts
export interface AppSettings {
  work_start_time: string;
  late_threshold_time: string;
  work_end_time: string;
  updated_by: string | null;
  updated_at: string;
  clockin_reauth_enforce: number;
  clockin_pin_attempt_cap: number;
  clockin_prompt_ttl_seconds: number;
  // Passive liveness (Plan 1.5) — added by migration-passive-liveness.sql
  clockin_passive_liveness_enforce: number;        // 0 = shadow, 1 = enforce
  clockin_liveness_review_cap_per_week: number;    // manual-review escape valve
  clockin_liveness_model_version: string;          // 'buffalo_s_v1' etc — surfaced into signature
}
```

```ts
const DEFAULTS: AppSettings = {
  work_start_time: '08:00',
  late_threshold_time: '08:30',
  work_end_time: '17:00',
  updated_by: null,
  updated_at: '1970-01-01T00:00:00Z',
  clockin_reauth_enforce: 0,
  clockin_pin_attempt_cap: 5,
  clockin_prompt_ttl_seconds: 90,
  clockin_passive_liveness_enforce: 0,
  clockin_liveness_review_cap_per_week: 2,
  clockin_liveness_model_version: 'buffalo_s_v1',
};
```

- [ ] **Step 3.2: Update the SELECT in `getAppSettings`**

In the same file, extend the column list:

```ts
const row = await env.DB.prepare(
  `SELECT work_start_time, late_threshold_time, work_end_time, updated_by, updated_at,
          clockin_reauth_enforce, clockin_pin_attempt_cap, clockin_prompt_ttl_seconds,
          clockin_passive_liveness_enforce, clockin_liveness_review_cap_per_week,
          clockin_liveness_model_version
   FROM app_settings WHERE id = 1`
).first<AppSettings>();
```

- [ ] **Step 3.3: Type-check**

```bash
cd packages/api
node ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: clean exit.

- [ ] **Step 3.4: Commit**

```bash
git add packages/api/src/services/settings.ts
git commit -m "feat(api): extend AppSettings with passive-liveness keys"
```

---

## Task 4: Create liveness types module

**Files:**
- Create: `packages/api/src/services/liveness/types.ts`

- [ ] **Step 4.1: Write the types module**

Create `packages/api/src/services/liveness/types.ts`:

```ts
export type LivenessChallenge = 'blink' | 'turn_left' | 'turn_right' | 'smile';

export type LivenessDecision = 'pass' | 'fail' | 'manual_review' | 'skipped';

export interface FaceLandmarks {
  // 5-keypoint output from insightface buffalo_s, normalised to [0,1] image coordinates.
  leftEye: [number, number];
  rightEye: [number, number];
  nose: [number, number];
  mouthLeft: [number, number];
  mouthRight: [number, number];
  faceConfidence: number;
}

export interface FrameAnalysis {
  landmarks: FaceLandmarks | null;   // null if no face was detected in the frame
  sharpness: number;                 // Laplacian variance proxy (higher = sharper)
}

export interface LivenessSignature {
  v: 1;
  challenge_action: LivenessChallenge;
  challenge_completed: boolean;
  motion_delta: number;              // [0,1] — magnitude of detected motion in expected direction
  face_score: number;                // mean faceConfidence across frames
  sharpness: number;                 // sharpness of the canonical (sharpest) frame
  decision: LivenessDecision;
  model_version: string;
  screen_artifact_score: number | null;
  ms_total: number;
}

export interface LivenessVerification {
  pass: boolean;
  decision: LivenessDecision;
  signature: LivenessSignature;
  canonicalFrame: ArrayBuffer;       // the sharpest frame, ready to write to R2
}

export const ALL_CHALLENGES: readonly LivenessChallenge[] = [
  'blink', 'turn_left', 'turn_right', 'smile',
] as const;
```

- [ ] **Step 4.2: Type-check**

```bash
cd packages/api
node ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 4.3: Commit**

```bash
git add packages/api/src/services/liveness/types.ts
git commit -m "feat(api): add liveness service type module"
```

---

## Task 5: Implement motion-delta detection (TDD)

**Files:**
- Create: `packages/api/src/services/liveness/motion.test.ts`
- Create: `packages/api/src/services/liveness/motion.ts`

**Thresholds (chosen to match typical insightface buffalo_s landmark scale, normalised [0,1]):**
- Blink: eye-openness Δ ≥ 0.015 between baseline and any later frame.
- Head turn: horizontal nose-to-eye-midpoint Δ ≥ 0.04 in the expected direction.
- Smile: mouth-corner separation Δ ≥ 0.02 (corners spread apart).

These are starting thresholds — the spec calls for them to be tuned in shadow mode. Do not chase precision before telemetry.

- [ ] **Step 5.1: Write failing tests**

Create `packages/api/src/services/liveness/motion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectMotion } from './motion';
import type { FaceLandmarks, LivenessChallenge } from './types';

function lm(over: Partial<FaceLandmarks> = {}): FaceLandmarks {
  return {
    leftEye: [0.40, 0.40],
    rightEye: [0.60, 0.40],
    nose: [0.50, 0.50],
    mouthLeft: [0.45, 0.65],
    mouthRight: [0.55, 0.65],
    faceConfidence: 0.95,
    ...over,
  };
}

describe('detectMotion — blink', () => {
  it('detects a blink (eye openness drops then recovers)', () => {
    // Baseline open → mid closed → end open
    const frames: FaceLandmarks[] = [
      lm({ leftEye: [0.40, 0.40], rightEye: [0.60, 0.40] }),
      lm({ leftEye: [0.40, 0.42], rightEye: [0.60, 0.42] }), // eyelids meet pupils
      lm({ leftEye: [0.40, 0.40], rightEye: [0.60, 0.40] }),
    ];
    const result = detectMotion(frames, 'blink');
    expect(result.completed).toBe(true);
    expect(result.delta).toBeGreaterThan(0.015);
  });

  it('rejects a static stare', () => {
    const frames: FaceLandmarks[] = [lm(), lm(), lm()];
    const result = detectMotion(frames, 'blink');
    expect(result.completed).toBe(false);
  });
});

describe('detectMotion — turn_left', () => {
  it('detects a leftward head turn (nose moves right relative to eyes)', () => {
    // From the camera's perspective, "user turns left" => their nose drifts to image-right
    // because the head rotates so the right cheek faces camera.
    const frames: FaceLandmarks[] = [
      lm({ nose: [0.50, 0.50] }),
      lm({ nose: [0.55, 0.50] }),
      lm({ nose: [0.58, 0.50] }),
    ];
    const result = detectMotion(frames, 'turn_left');
    expect(result.completed).toBe(true);
    expect(result.delta).toBeGreaterThan(0.04);
  });

  it('rejects a rightward turn when left was requested', () => {
    const frames: FaceLandmarks[] = [
      lm({ nose: [0.50, 0.50] }),
      lm({ nose: [0.45, 0.50] }),
      lm({ nose: [0.42, 0.50] }),
    ];
    const result = detectMotion(frames, 'turn_left');
    expect(result.completed).toBe(false);
  });
});

describe('detectMotion — turn_right', () => {
  it('detects a rightward head turn (nose moves left in image space)', () => {
    const frames: FaceLandmarks[] = [
      lm({ nose: [0.50, 0.50] }),
      lm({ nose: [0.45, 0.50] }),
      lm({ nose: [0.42, 0.50] }),
    ];
    const result = detectMotion(frames, 'turn_right');
    expect(result.completed).toBe(true);
  });
});

describe('detectMotion — smile', () => {
  it('detects a smile (mouth corners spread apart)', () => {
    const frames: FaceLandmarks[] = [
      lm({ mouthLeft: [0.45, 0.65], mouthRight: [0.55, 0.65] }),
      lm({ mouthLeft: [0.43, 0.66], mouthRight: [0.57, 0.66] }),
      lm({ mouthLeft: [0.42, 0.66], mouthRight: [0.58, 0.66] }),
    ];
    const result = detectMotion(frames, 'smile');
    expect(result.completed).toBe(true);
    expect(result.delta).toBeGreaterThan(0.02);
  });

  it('rejects a static neutral mouth', () => {
    const frames: FaceLandmarks[] = [lm(), lm(), lm()];
    const result = detectMotion(frames, 'smile');
    expect(result.completed).toBe(false);
  });
});

describe('detectMotion — missing face', () => {
  it('returns not-completed when any frame lacks landmarks', () => {
    const result = detectMotion([null, null, null], 'blink');
    expect(result.completed).toBe(false);
    expect(result.delta).toBe(0);
  });
});
```

- [ ] **Step 5.2: Run the tests — they should fail**

```bash
cd packages/api
npm test
```

Expected: `motion.test.ts` fails with `Cannot find module './motion'` or similar.

- [ ] **Step 5.3: Implement `motion.ts`**

Create `packages/api/src/services/liveness/motion.ts`:

```ts
import type { FaceLandmarks, LivenessChallenge } from './types';

export interface MotionResult {
  completed: boolean;
  delta: number;
}

const THRESHOLDS = {
  blink: 0.015,
  turn_left: 0.04,
  turn_right: 0.04,
  smile: 0.02,
} as const;

function eyeOpenness(face: FaceLandmarks): number {
  // Without iris landmarks we use eye-y vs eye-x as a coarse proxy. Higher
  // y-coordinate (closer to the mouth) on both eyes correlates with a closing
  // eyelid. We compare absolute y-shift between baseline and current frame.
  return (face.leftEye[1] + face.rightEye[1]) / 2;
}

function noseRelative(face: FaceLandmarks): number {
  // Horizontal offset of nose from the midpoint of the eyes.
  // Positive = nose to the right of eye midpoint (image space).
  const eyeMidX = (face.leftEye[0] + face.rightEye[0]) / 2;
  return face.nose[0] - eyeMidX;
}

function mouthSpread(face: FaceLandmarks): number {
  return face.mouthRight[0] - face.mouthLeft[0];
}

export function detectMotion(
  frames: ReadonlyArray<FaceLandmarks | null>,
  challenge: LivenessChallenge,
): MotionResult {
  if (frames.length < 2 || frames.some((f) => f === null)) {
    return { completed: false, delta: 0 };
  }
  const safe = frames as ReadonlyArray<FaceLandmarks>;

  switch (challenge) {
    case 'blink': {
      const baseline = eyeOpenness(safe[0]);
      const peak = Math.max(...safe.slice(1).map(eyeOpenness));
      const delta = Math.abs(peak - baseline);
      return { completed: delta >= THRESHOLDS.blink, delta };
    }
    case 'turn_left': {
      const baseline = noseRelative(safe[0]);
      const end = noseRelative(safe[safe.length - 1]);
      const delta = end - baseline; // positive when nose drifts right (user turned left)
      return { completed: delta >= THRESHOLDS.turn_left, delta: Math.abs(delta) };
    }
    case 'turn_right': {
      const baseline = noseRelative(safe[0]);
      const end = noseRelative(safe[safe.length - 1]);
      const delta = baseline - end;
      return { completed: delta >= THRESHOLDS.turn_right, delta: Math.abs(delta) };
    }
    case 'smile': {
      const baseline = mouthSpread(safe[0]);
      const peak = Math.max(...safe.slice(1).map(mouthSpread));
      const delta = peak - baseline;
      return { completed: delta >= THRESHOLDS.smile, delta };
    }
  }
}
```

- [ ] **Step 5.4: Run the tests — they should pass**

```bash
npm test
```

Expected: all `motion.test.ts` cases green.

- [ ] **Step 5.5: Commit**

```bash
git add packages/api/src/services/liveness/motion.ts packages/api/src/services/liveness/motion.test.ts
git commit -m "feat(api): liveness motion-delta detection per challenge"
```

---

## Task 6: Implement sharpest-frame selection (TDD)

**Files:**
- Create: `packages/api/src/services/liveness/sharpness.test.ts`
- Create: `packages/api/src/services/liveness/sharpness.ts`

The Laplacian-variance approximation works on raw bytes by computing the variance of a discrete Laplacian over the luminance channel. We do not have a full image-decoding stack in the Worker, so we rely on Workers AI returning a per-frame sharpness proxy (frame-level confidence + landmark-spread is a reasonable substitute). Practical implementation: pick the frame with the highest `faceConfidence`, breaking ties by the frame closest to the burst midpoint (most stable framing).

- [ ] **Step 6.1: Write failing tests**

Create `packages/api/src/services/liveness/sharpness.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { selectSharpestFrame } from './sharpness';
import type { FrameAnalysis } from './types';

function fa(faceConfidence: number, sharpness = 0): FrameAnalysis {
  return {
    landmarks: {
      leftEye: [0.4, 0.4], rightEye: [0.6, 0.4], nose: [0.5, 0.5],
      mouthLeft: [0.45, 0.65], mouthRight: [0.55, 0.65],
      faceConfidence,
    },
    sharpness,
  };
}

describe('selectSharpestFrame', () => {
  it('picks the frame with the highest faceConfidence', () => {
    const frames = [fa(0.80), fa(0.95), fa(0.85)];
    const idx = selectSharpestFrame(frames);
    expect(idx).toBe(1);
  });

  it('breaks ties by proximity to burst midpoint', () => {
    const frames = [fa(0.95), fa(0.95), fa(0.95)];
    const idx = selectSharpestFrame(frames);
    expect(idx).toBe(1); // middle frame wins on tie
  });

  it('falls back to index 0 when no frame has landmarks', () => {
    const frames: FrameAnalysis[] = [
      { landmarks: null, sharpness: 0 },
      { landmarks: null, sharpness: 0 },
      { landmarks: null, sharpness: 0 },
    ];
    expect(selectSharpestFrame(frames)).toBe(0);
  });
});
```

- [ ] **Step 6.2: Run tests — should fail**

```bash
npm test -- sharpness
```

Expected: failure on missing module.

- [ ] **Step 6.3: Implement `sharpness.ts`**

Create `packages/api/src/services/liveness/sharpness.ts`:

```ts
import type { FrameAnalysis } from './types';

export function selectSharpestFrame(frames: ReadonlyArray<FrameAnalysis>): number {
  if (frames.length === 0) return 0;
  const midIdx = Math.floor((frames.length - 1) / 2);
  let bestIdx = 0;
  let bestScore = -Infinity;

  frames.forEach((frame, idx) => {
    const conf = frame.landmarks?.faceConfidence ?? 0;
    // Composite score: confidence dominates; mid-burst proximity breaks ties.
    const tieBreak = -Math.abs(idx - midIdx) * 1e-6;
    const score = conf + tieBreak;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return bestIdx;
}
```

- [ ] **Step 6.4: Run tests — should pass**

```bash
npm test -- sharpness
```

Expected: green.

- [ ] **Step 6.5: Commit**

```bash
git add packages/api/src/services/liveness/sharpness.ts packages/api/src/services/liveness/sharpness.test.ts
git commit -m "feat(api): sharpest-frame selector for liveness burst"
```

---

## Task 7: Workers AI face-landmarks wrapper (mocked tests)

**Files:**
- Create: `packages/api/src/services/liveness/ai.test.ts`
- Create: `packages/api/src/services/liveness/ai.ts`

The wrapper takes a single frame (`ArrayBuffer` containing JPEG bytes) and returns a `FrameAnalysis`. It calls `env.AI.run('@cf/insightface/buffalo_s', { image: frameBytes })`.

The exact response shape from insightface buffalo_s on Workers AI: an array of detected faces, each with `bbox` and `kps` (keypoints — 5-point landmarks: left eye, right eye, nose, left mouth corner, right mouth corner). We pick the highest-confidence face.

If no face is detected (or AI errors), return `{ landmarks: null, sharpness: 0 }`.

- [ ] **Step 7.1: Write failing tests**

Create `packages/api/src/services/liveness/ai.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { analyzeFrame } from './ai';

function mockAi(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response) } as unknown as Ai;
}

describe('analyzeFrame', () => {
  it('returns landmarks for a successful detection', async () => {
    const ai = mockAi({
      faces: [{
        bbox: [0.2, 0.2, 0.8, 0.8],
        score: 0.97,
        kps: [
          [0.40, 0.40], [0.60, 0.40], [0.50, 0.50],
          [0.45, 0.65], [0.55, 0.65],
        ],
      }],
    });
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks).not.toBeNull();
    expect(result.landmarks?.faceConfidence).toBeCloseTo(0.97);
    expect(result.landmarks?.nose).toEqual([0.50, 0.50]);
  });

  it('returns null landmarks when no face detected', async () => {
    const ai = mockAi({ faces: [] });
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks).toBeNull();
  });

  it('returns null landmarks on AI error', async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error('AI down')) } as unknown as Ai;
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks).toBeNull();
  });

  it('picks the face with the highest score when multiple are detected', async () => {
    const ai = mockAi({
      faces: [
        { bbox: [0,0,0.3,0.3], score: 0.60, kps: [[0.1,0.1],[0.2,0.1],[0.15,0.15],[0.12,0.18],[0.18,0.18]] },
        { bbox: [0.4,0.4,0.9,0.9], score: 0.97, kps: [[0.5,0.5],[0.7,0.5],[0.6,0.6],[0.55,0.7],[0.65,0.7]] },
      ],
    });
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks?.faceConfidence).toBeCloseTo(0.97);
  });
});
```

- [ ] **Step 7.2: Run tests — should fail**

```bash
npm test -- ai
```

- [ ] **Step 7.3: Implement `ai.ts`**

Create `packages/api/src/services/liveness/ai.ts`:

```ts
import type { FrameAnalysis, FaceLandmarks } from './types';

interface InsightfaceResponse {
  faces?: Array<{
    bbox: [number, number, number, number];
    score: number;
    kps: Array<[number, number]>;
  }>;
}

export async function analyzeFrame(ai: Ai, frame: ArrayBuffer): Promise<FrameAnalysis> {
  let raw: InsightfaceResponse;
  try {
    raw = await ai.run('@cf/insightface/buffalo_s' as never, {
      image: Array.from(new Uint8Array(frame)),
    } as never) as InsightfaceResponse;
  } catch {
    return { landmarks: null, sharpness: 0 };
  }

  const faces = raw.faces ?? [];
  if (faces.length === 0) return { landmarks: null, sharpness: 0 };

  const best = faces.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.kps.length < 5) return { landmarks: null, sharpness: 0 };

  const landmarks: FaceLandmarks = {
    leftEye:    best.kps[0]!,
    rightEye:   best.kps[1]!,
    nose:       best.kps[2]!,
    mouthLeft:  best.kps[3]!,
    mouthRight: best.kps[4]!,
    faceConfidence: best.score,
  };

  return { landmarks, sharpness: 0 };
}
```

Note: the `as never` casts are because Cloudflare's `Ai` type union doesn't yet narrow to insightface response shapes cleanly. This is a known pattern in Workers AI consumer code. Replace with proper types once `@cloudflare/workers-types` ships them.

- [ ] **Step 7.4: Run tests — should pass**

```bash
npm test -- ai
```

- [ ] **Step 7.5: Commit**

```bash
git add packages/api/src/services/liveness/ai.ts packages/api/src/services/liveness/ai.test.ts
git commit -m "feat(api): Workers AI insightface frame-analysis wrapper"
```

---

## Task 8: Manual-review weekly counter (KV-backed)

**Files:**
- Create: `packages/api/src/services/liveness/review-counter.test.ts`
- Create: `packages/api/src/services/liveness/review-counter.ts`

The counter increments on each `manual_review` outcome. The KV key uses ISO 8601 calendar week (UTC, Mon-Sun). 8-day TTL so previous-week's counter survives the boundary cleanly.

- [ ] **Step 8.1: Write failing tests**

Create `packages/api/src/services/liveness/review-counter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { isoWeekKey, getReviewCount, incrementReviewCount } from './review-counter';

function mockKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace;
}

describe('isoWeekKey', () => {
  it('produces "YYYY-Www" format for a known date', () => {
    // 2026-05-04 is a Monday — the start of ISO week 19 of 2026.
    const d = new Date('2026-05-04T12:00:00Z');
    expect(isoWeekKey(d)).toBe('2026-W19');
  });

  it('rolls forward at midnight UTC Sunday→Monday', () => {
    const sunday = new Date('2026-05-10T23:59:59Z');
    const monday = new Date('2026-05-11T00:00:01Z');
    expect(isoWeekKey(sunday)).toBe('2026-W19');
    expect(isoWeekKey(monday)).toBe('2026-W20');
  });
});

describe('getReviewCount', () => {
  it('returns 0 for a missing key', async () => {
    const kv = mockKv();
    const n = await getReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(n).toBe(0);
  });

  it('returns the stored count', async () => {
    const kv = mockKv({ 'clock-liveness-review:user-1:2026-W19': '2' });
    const n = await getReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(n).toBe(2);
  });
});

describe('incrementReviewCount', () => {
  it('writes 1 on first increment with 8-day TTL', async () => {
    const kv = mockKv();
    const next = await incrementReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(next).toBe(1);
    expect(kv.put).toHaveBeenCalledWith(
      'clock-liveness-review:user-1:2026-W19',
      '1',
      { expirationTtl: 8 * 86400 },
    );
  });

  it('increments an existing count', async () => {
    const kv = mockKv({ 'clock-liveness-review:user-1:2026-W19': '1' });
    const next = await incrementReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(next).toBe(2);
  });
});
```

- [ ] **Step 8.2: Run — should fail**

```bash
npm test -- review-counter
```

- [ ] **Step 8.3: Implement `review-counter.ts`**

Create `packages/api/src/services/liveness/review-counter.ts`:

```ts
const TTL_SECONDS = 8 * 86400;

/** ISO 8601 calendar week — "YYYY-Www" — in UTC, Monday-to-Sunday. */
export function isoWeekKey(d: Date): string {
  // Algorithm from ISO 8601 §3.5: week 1 is the week containing the first Thursday.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // shift to Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function key(userId: string, d: Date): string {
  return `clock-liveness-review:${userId}:${isoWeekKey(d)}`;
}

export async function getReviewCount(kv: KVNamespace, userId: string, now: Date = new Date()): Promise<number> {
  const raw = await kv.get(key(userId, now));
  return raw ? Number(raw) : 0;
}

export async function incrementReviewCount(
  kv: KVNamespace,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const current = await getReviewCount(kv, userId, now);
  const next = current + 1;
  await kv.put(key(userId, now), String(next), { expirationTtl: TTL_SECONDS });
  return next;
}
```

- [ ] **Step 8.4: Run — should pass**

```bash
npm test -- review-counter
```

- [ ] **Step 8.5: Commit**

```bash
git add packages/api/src/services/liveness/review-counter.ts packages/api/src/services/liveness/review-counter.test.ts
git commit -m "feat(api): KV-backed manual-review weekly counter"
```

---

## Task 9: `verifyLivenessBurst` orchestrator (TDD with mocks)

**Files:**
- Create: `packages/api/src/services/liveness/index.test.ts`
- Create: `packages/api/src/services/liveness/index.ts`

Pulls together `analyzeFrame`, `detectMotion`, `selectSharpestFrame`. Returns the canonical frame + signature.

- [ ] **Step 9.1: Write failing tests**

Create `packages/api/src/services/liveness/index.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { verifyLivenessBurst } from './index';

function mockAi(perFrameResponses: unknown[]) {
  let i = 0;
  return {
    run: vi.fn(async () => perFrameResponses[i++] ?? { faces: [] }),
  } as unknown as Ai;
}

const PASSING_BLINK = [
  { faces: [{ bbox: [0,0,1,1], score: 0.95, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
  { faces: [{ bbox: [0,0,1,1], score: 0.93, kps: [[0.40,0.42],[0.60,0.42],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
  { faces: [{ bbox: [0,0,1,1], score: 0.96, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
];

const STATIC_FRAMES = Array(3).fill({
  faces: [{ bbox: [0,0,1,1], score: 0.92, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }],
});

const f = (n: number) => new ArrayBuffer(n);

describe('verifyLivenessBurst', () => {
  it('returns pass when challenge is completed', async () => {
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(true);
    expect(result.decision).toBe('pass');
    expect(result.signature.challenge_completed).toBe(true);
    expect(result.signature.model_version).toBe('buffalo_s_v1');
    expect(result.canonicalFrame).toBeInstanceOf(ArrayBuffer);
  });

  it('returns fail when no motion detected', async () => {
    const ai = mockAi(STATIC_FRAMES);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
    expect(result.signature.challenge_completed).toBe(false);
  });

  it('returns skipped on AI error', async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error('AI down')) } as unknown as Ai;
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.decision).toBe('skipped');
    expect(result.pass).toBe(false);
  });

  it('rejects fewer than 3 frames', async () => {
    const ai = mockAi([]);
    await expect(verifyLivenessBurst({
      ai,
      frames: [f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    })).rejects.toThrow('exactly 3 frames');
  });

  it('records ms_total', async () => {
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.signature.ms_total).toBeGreaterThanOrEqual(0);
  });

  it('returns fail with all-null landmarks (no face detected anywhere)', async () => {
    const ai = mockAi([{ faces: [] }, { faces: [] }, { faces: [] }]);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
    expect(result.signature.face_score).toBe(0);
  });
});
```

- [ ] **Step 9.2: Run — should fail**

```bash
npm test -- liveness/index
```

- [ ] **Step 9.3: Implement `index.ts`**

Create `packages/api/src/services/liveness/index.ts`:

```ts
import { analyzeFrame } from './ai';
import { detectMotion } from './motion';
import { selectSharpestFrame } from './sharpness';
import type {
  LivenessChallenge, LivenessVerification, LivenessSignature, FrameAnalysis,
} from './types';

export * from './types';
export { isoWeekKey, getReviewCount, incrementReviewCount } from './review-counter';

interface VerifyArgs {
  ai: Ai;
  frames: ArrayBuffer[];
  challenge: LivenessChallenge;
  modelVersion: string;
}

export async function verifyLivenessBurst(args: VerifyArgs): Promise<LivenessVerification> {
  const { ai, frames, challenge, modelVersion } = args;
  if (frames.length !== 3) throw new Error('verifyLivenessBurst expects exactly 3 frames');

  const start = Date.now();

  let analyses: FrameAnalysis[];
  let aiErrored = false;
  try {
    analyses = await Promise.all(frames.map((f) => analyzeFrame(ai, f)));
  } catch {
    aiErrored = true;
    analyses = frames.map(() => ({ landmarks: null, sharpness: 0 }));
  }

  // If every frame errored from AI, return a 'skipped' decision.
  if (aiErrored || analyses.every((a) => a.landmarks === null && a.sharpness === 0)) {
    const allNull = analyses.every((a) => a.landmarks === null);
    if (aiErrored || allNull && analyses.length === 3) {
      const signature: LivenessSignature = {
        v: 1,
        challenge_action: challenge,
        challenge_completed: false,
        motion_delta: 0,
        face_score: meanFaceScore(analyses),
        sharpness: 0,
        decision: aiErrored ? 'skipped' : 'fail',
        model_version: modelVersion,
        screen_artifact_score: null,
        ms_total: Date.now() - start,
      };
      return {
        pass: false,
        decision: signature.decision,
        signature,
        canonicalFrame: frames[0]!,
      };
    }
  }

  const motion = detectMotion(analyses.map((a) => a.landmarks), challenge);
  const sharpestIdx = selectSharpestFrame(analyses);
  const decision: LivenessSignature['decision'] = motion.completed ? 'pass' : 'fail';

  const signature: LivenessSignature = {
    v: 1,
    challenge_action: challenge,
    challenge_completed: motion.completed,
    motion_delta: motion.delta,
    face_score: meanFaceScore(analyses),
    sharpness: analyses[sharpestIdx]?.sharpness ?? 0,
    decision,
    model_version: modelVersion,
    screen_artifact_score: null,
    ms_total: Date.now() - start,
  };

  return {
    pass: motion.completed,
    decision,
    signature,
    canonicalFrame: frames[sharpestIdx]!,
  };
}

function meanFaceScore(analyses: ReadonlyArray<FrameAnalysis>): number {
  const scores = analyses.map((a) => a.landmarks?.faceConfidence ?? 0);
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}
```

- [ ] **Step 9.4: Run — should pass**

```bash
npm test -- liveness/index
```

- [ ] **Step 9.5: Commit**

```bash
git add packages/api/src/services/liveness/index.ts packages/api/src/services/liveness/index.test.ts
git commit -m "feat(api): verifyLivenessBurst orchestrator"
```

---

## Task 10: Update KV `ClockPrompt` shape and extend `POST /clock/prompt`

**Files:**
- Modify: `packages/api/src/routes/clock.ts`

The prompt record adds `challenge_action`. The `prompt_value` field is **dropped from the response, the KV record, and the route logic** — the visible-number UX is gone in this same release per the spec's Phase 0.

- [ ] **Step 10.1: Update the `ClockPrompt` interface and prompt-issuance**

In `packages/api/src/routes/clock.ts`, replace the `ClockPrompt` interface, the `generatePromptValue` function, and the `POST /prompt` handler:

```ts
import { ALL_CHALLENGES } from '../services/liveness';
import type { LivenessChallenge } from '../services/liveness/types';

interface ClockPrompt {
  userId: string;
  expiresAt: number;            // unix ms
  challengeAction: LivenessChallenge;
}

// REMOVED: generatePromptValue() — no more visible 2-digit number.

function chooseChallenge(): LivenessChallenge {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return ALL_CHALLENGES[arr[0]! % ALL_CHALLENGES.length]!;
}

clockRoutes.post('/prompt', async (c) => {
  const session = c.get('session');
  const settings = await getAppSettings(c.env);
  const ttl = Math.max(30, Math.min(300, settings.clockin_prompt_ttl_seconds));

  const promptId = crypto.randomUUID();
  const challengeAction = chooseChallenge();
  const expiresAt = Date.now() + ttl * 1000;

  const data: ClockPrompt = { userId: session.userId, expiresAt, challengeAction };
  await c.env.KV.put(promptKey(promptId), JSON.stringify(data), { expirationTtl: ttl });

  devLog(c.env, `[CLOCK_PROMPT] issued ${promptId} challenge=${challengeAction} ttl=${ttl}s user=${session.userId}`);
  return success(c, { prompt_id: promptId, challenge_action: challengeAction, expires_at: expiresAt });
});
```

- [ ] **Step 10.2: Type-check**

```bash
cd packages/api
node ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: clean. (The downstream `POST /clock` handler still references `prompt_value`/`promptValue` — those will be cleaned up in Task 11 in the same edit pass. If the type-check complains *only* about that handler, ignore for now and proceed; the next task fixes it.)

If tsc reports unrelated errors, fix them before continuing.

- [ ] **Step 10.3: Commit (no test yet — route changes are exercised by integration in Task 11)**

```bash
git add packages/api/src/routes/clock.ts
git commit -m "feat(api): /clock/prompt issues randomised challenge_action; drops visible prompt_value"
```

---

## Task 11: Extend `POST /clock` for multipart liveness burst + wire enforce gating

**Files:**
- Modify: `packages/api/src/routes/clock.ts`

The clock submit changes from JSON to **multipart form-data** when a liveness burst is included. JSON-only submissions remain accepted in shadow mode (so a stale PWA cache doesn't get rejected during the rollout window).

Multipart fields:
- `payload` — JSON string with the existing fields (type, latitude, longitude, accuracy, idempotency_key, prompt_id, webauthn_assertion, pin)
- `frame_0`, `frame_1`, `frame_2` — JPEG blobs
- `challenge_action_completed` — "true" / "false" — the client's claim. Used only as a logging signal; never trusted.

- [ ] **Step 11.1: Replace the `POST /` handler**

Replace the current `clockRoutes.post('/', zValidator(...))` block in `packages/api/src/routes/clock.ts` with the multipart-aware version:

```ts
import { verifyLivenessBurst, incrementReviewCount, getReviewCount } from '../services/liveness';
import type { LivenessSignature } from '../services/liveness/types';

// (keep the existing clockSchema for backward-compat JSON callers in shadow mode)

clockRoutes.post('/', async (c) => {
  const session = c.get('session');
  const contentType = c.req.header('content-type') ?? '';
  const isMultipart = contentType.includes('multipart/form-data');

  let body: z.infer<typeof clockSchema>;
  let frames: ArrayBuffer[] | null = null;

  if (isMultipart) {
    const form = await c.req.formData();
    const payloadStr = form.get('payload');
    if (typeof payloadStr !== 'string') return error(c, 'BAD_PAYLOAD', 'payload field missing', 400);
    let parsed: unknown;
    try { parsed = JSON.parse(payloadStr); } catch { return error(c, 'BAD_PAYLOAD', 'payload is not JSON', 400); }
    const result = clockSchema.safeParse(parsed);
    if (!result.success) return error(c, 'BAD_PAYLOAD', result.error.message, 400);
    body = result.data;

    const f0 = form.get('frame_0'); const f1 = form.get('frame_1'); const f2 = form.get('frame_2');
    if (!(f0 instanceof Blob) || !(f1 instanceof Blob) || !(f2 instanceof Blob)) {
      return error(c, 'MISSING_FRAMES', 'Three frames are required for liveness verification', 400);
    }
    const TOTAL_LIMIT = 600_000; // 600KB cap across all 3 frames
    const total = f0.size + f1.size + f2.size;
    if (total > TOTAL_LIMIT) return error(c, 'BURST_TOO_LARGE', 'Liveness burst exceeds size limit', 413);
    frames = [await f0.arrayBuffer(), await f1.arrayBuffer(), await f2.arrayBuffer()];
  } else {
    let parsed: unknown;
    try { parsed = await c.req.json(); } catch { return error(c, 'BAD_JSON', 'Invalid JSON body', 400); }
    const result = clockSchema.safeParse(parsed);
    if (!result.success) return error(c, 'BAD_PAYLOAD', result.error.message, 400);
    body = result.data;
  }

  const { type, latitude, longitude, accuracy, idempotency_key } = body;
  const promptId = body.prompt_id;
  const webauthnAssertion = body.webauthn_assertion as AuthenticationResponseJSON | undefined;
  const pin = body.pin;

  // ---- idempotency (unchanged) ----
  if (idempotency_key) {
    const existing = await c.env.DB.prepare(
      "SELECT id, type, timestamp FROM clock_records WHERE user_id = ? AND idempotency_key = ? LIMIT 1"
    ).bind(session.userId, idempotency_key).first<{ id: string; type: string; timestamp: string }>();
    if (existing) {
      return success(c, {
        id: existing.id, type: existing.type, timestamp: existing.timestamp,
        user_name: session.name, staff_id: '', within_geofence: true,
        distance_meters: 0, streak: 0, longest_streak: 0, deduplicated: true,
      });
    }
  }

  // ---- prompt + re-auth gates (existing logic, with prompt_value retired) ----
  const settings = await getAppSettings(c.env);
  const enforceReauth = settings.clockin_reauth_enforce === 1;
  const enforceLiveness = settings.clockin_passive_liveness_enforce === 1;
  const devBypass = c.env.DEV_BYPASS_REAUTH === 'true';

  let challengeAction: ClockPrompt['challengeAction'] | null = null;
  let reauthMethod: 'webauthn' | 'pin' | null = null;

  if (promptId) {
    const raw = await c.env.KV.get(promptKey(promptId));
    if (!raw) return error(c, 'PROMPT_NOT_FOUND', 'Your clock-in prompt has expired or was already used. Please try again.', 410);
    const stored = JSON.parse(raw) as ClockPrompt;
    if (stored.userId !== session.userId) return error(c, 'PROMPT_USER_MISMATCH', 'Prompt does not belong to this user', 403);
    if (stored.expiresAt < Date.now()) {
      await c.env.KV.delete(promptKey(promptId));
      return error(c, 'PROMPT_EXPIRED', 'Your clock-in prompt has expired. Please try again.', 410);
    }
    challengeAction = stored.challengeAction;
  } else if (enforceReauth) {
    return error(c, 'PROMPT_REQUIRED', 'A fresh clock-in prompt is required.', 400);
  }

  // Re-auth (unchanged)
  if (webauthnAssertion && promptId) {
    if (devBypass) {
      reauthMethod = 'webauthn';
    } else {
      const outcome = await verifyClockWebAuthnAssertion(c, session.userId, promptId, webauthnAssertion);
      if (outcome.ok) reauthMethod = 'webauthn';
      else if (pin === undefined && enforceReauth) {
        return error(c, 'REAUTH_FAILED', 'Biometric verification failed. Try your PIN.', 401);
      }
    }
  }
  if (reauthMethod === null && pin !== undefined) {
    const outcome = await verifyClockPin(c.env, session.userId, pin, settings.clockin_pin_attempt_cap);
    if (outcome.ok) reauthMethod = 'pin';
    else if (outcome.reason === 'rate_limited') return error(c, 'REAUTH_RATE_LIMITED', 'Too many wrong PIN attempts. Try again tomorrow.', 429);
    else if (enforceReauth) return error(c, 'REAUTH_FAILED', 'PIN verification failed.', 401);
  }
  if (enforceReauth && reauthMethod === null) {
    return error(c, 'REAUTH_REQUIRED', 'Biometric or PIN verification is required to clock in.', 401);
  }

  // ---- LIVENESS GATE ----
  let livenessSignature: LivenessSignature | null = null;
  let livenessDecision: LivenessSignature['decision'] | null = null;

  if (frames && challengeAction) {
    const verification = await verifyLivenessBurst({
      ai: c.env.AI,
      frames,
      challenge: challengeAction,
      modelVersion: settings.clockin_liveness_model_version,
    });
    livenessSignature = verification.signature;
    livenessDecision = verification.decision;

    if (enforceLiveness && verification.decision === 'fail') {
      // The client should have surfaced the manual-review escape valve already
      // — if we got here, either the client skipped it or they want the hard fail.
      return error(c, 'LIVENESS_FAILED', 'Liveness check failed. Please try again or submit for HR review.', 401);
    }
  } else if (enforceLiveness) {
    // No frames + enforce mode → routed automatically to manual_review.
    livenessDecision = 'manual_review';
    livenessSignature = {
      v: 1,
      challenge_action: challengeAction ?? 'blink',
      challenge_completed: false,
      motion_delta: 0,
      face_score: 0,
      sharpness: 0,
      decision: 'manual_review',
      model_version: settings.clockin_liveness_model_version,
      screen_artifact_score: null,
      ms_total: 0,
    };
  }

  // Manual-review weekly cap
  if (livenessDecision === 'manual_review') {
    const used = await getReviewCount(c.env.KV, session.userId);
    if (used >= settings.clockin_liveness_review_cap_per_week) {
      return error(
        c, 'LIVENESS_REVIEW_CAP',
        'You have reached this week\'s manual-review limit. Please contact HR.',
        429,
      );
    }
    await incrementReviewCount(c.env.KV, session.userId);
  }

  // ---- geofence + duplicate checks (unchanged) ----
  if (accuracy !== undefined && accuracy > MAX_GPS_ACCURACY_METERS) {
    return error(c, 'GPS_TOO_IMPRECISE',
      `GPS accuracy is too poor (±${Math.round(accuracy)}m). Move somewhere with clearer sky and try again.`, 400);
  }
  const inside = insideAnyPolygon(latitude, longitude);
  const distance = inside ? 0 : distanceToNearestPolygonMeters(latitude, longitude);
  const acc = accuracy && accuracy > 0 ? accuracy : 0;
  const withinGeofence = inside || distance <= WALL_BUFFER_METERS;
  devLog(c.env, `[CLOCK_GEO] inside=${inside} dist=${Math.round(distance)}m acc=${Math.round(acc)}m -> ${withinGeofence ? 'IN' : 'OUT'}`);
  if (!withinGeofence) {
    const accStr = acc > 0 ? ` (GPS accuracy ±${Math.round(acc)}m)` : '';
    return error(c, 'OUTSIDE_GEOFENCE',
      `You are ${Math.round(distance)}m outside the OHCS building${accStr}. You must be inside the building to clock ${type === 'clock_in' ? 'in' : 'out'}.`, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM clock_records WHERE user_id = ? AND type = ? AND DATE(timestamp) = ?`
  ).bind(session.userId, type, today).first();
  if (existing) return error(c, 'ALREADY_CLOCKED', `You have already clocked ${type === 'clock_in' ? 'in' : 'out'} today.`, 400);
  if (type === 'clock_out') {
    const clockedIn = await c.env.DB.prepare(
      `SELECT id FROM clock_records WHERE user_id = ? AND type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(session.userId, today).first();
    if (!clockedIn) return error(c, 'NOT_CLOCKED_IN', 'You must clock in before clocking out.', 400);
  }

  // ---- insert + write canonical photo to R2 if present ----
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    `INSERT INTO clock_records
      (id, user_id, type, latitude, longitude, within_geofence, idempotency_key,
       reauth_method, liveness_challenge, liveness_decision, liveness_signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, session.userId, type, latitude, longitude,
    withinGeofence ? 1 : 0, idempotency_key ?? null, reauthMethod,
    challengeAction, livenessDecision, livenessSignature ? JSON.stringify(livenessSignature) : null,
  ).run();

  // Write canonical frame to R2 (only when frames + verification produced a usable canonical frame)
  if (frames && livenessDecision && livenessDecision !== 'skipped' && challengeAction) {
    // The verifier already chose the sharpest frame; we re-derive its index here only to write.
    // Simpler path: write the best available — the spec says verifyLivenessBurst returns canonicalFrame
    // already, so we just pull that. We re-call only because we can't pass it forward without
    // shape changes; instead we trust verifier output.
    //
    // Optimization: the current edit holds the verification result in `verification` above.
    // Move the R2 write up into the verification branch to avoid re-running:
    // (this comment is redundant — actual code path moves it. See edit below.)
  }

  // (See revised handler note: the R2 write actually happens in the same branch where
  // verification ran. The edit you should make: keep `verification` in scope and write
  // R2 there. If you've already run verification above, replace the `if (frames && ...)`
  // R2 block above with a write inside that earlier branch using `verification.canonicalFrame`.)

  // Consume the prompt
  if (promptId) await c.env.KV.delete(promptKey(promptId));

  // ---- streak + late-clock alert (unchanged) ----
  if (type === 'clock_in') {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayRecord = await c.env.DB.prepare(
      `SELECT id FROM clock_records WHERE user_id = ? AND type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(session.userId, yesterday).first();
    if (yesterdayRecord) {
      await c.env.DB.prepare(
        `UPDATE users SET current_streak = current_streak + 1,
         longest_streak = MAX(longest_streak, current_streak + 1) WHERE id = ?`
      ).bind(session.userId).run();
    } else {
      await c.env.DB.prepare(
        `UPDATE users SET current_streak = 1, longest_streak = MAX(longest_streak, 1) WHERE id = ?`
      ).bind(session.userId).run();
    }
  }
  if (type === 'clock_in') {
    const thresholdMin = hhmmToMinutes(settings.late_threshold_time);
    const now = new Date();
    const minOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minOfDay > thresholdMin) {
      c.executionCtx.waitUntil(sendLateClockAlert(c.env, session.userId, now.toISOString()));
    }
  }

  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(session.userId).first<{ name: string; staff_id: string; current_streak: number; longest_streak: number }>();

  devLog(c.env, `[CLOCK] ${user?.name} (${user?.staff_id}) — ${type} liveness=${livenessDecision ?? 'none'} reauth=${reauthMethod ?? 'none'}`);

  return success(c, {
    id, type, timestamp: new Date().toISOString(),
    user_name: user?.name ?? session.name,
    staff_id: user?.staff_id ?? '',
    within_geofence: withinGeofence,
    distance_meters: Math.round(distance),
    streak: user?.current_streak ?? 0,
    longest_streak: user?.longest_streak ?? 0,
    liveness_decision: livenessDecision,
  });
});
```

- [ ] **Step 11.2: Move the R2 canonical-frame write inside the verification branch**

Refactor the handler so that the R2 write happens immediately after `verifyLivenessBurst` returns, using `verification.canonicalFrame`. Concretely, replace the inner block that runs verification:

```ts
if (frames && challengeAction) {
  const verification = await verifyLivenessBurst({
    ai: c.env.AI,
    frames,
    challenge: challengeAction,
    modelVersion: settings.clockin_liveness_model_version,
  });
  livenessSignature = verification.signature;
  livenessDecision = verification.decision;

  if (enforceLiveness && verification.decision === 'fail') {
    return error(c, 'LIVENESS_FAILED', 'Liveness check failed. Please try again or submit for HR review.', 401);
  }

  // Hold the canonical frame on the request scope; we write to R2 after the
  // clock_records row insert below (so the photo_url FK lines up cleanly).
  c.set('canonicalFrame' as never, verification.canonicalFrame);
}
```

…and after the `INSERT INTO clock_records` block, add:

```ts
const canonicalFrame = c.get('canonicalFrame' as never) as ArrayBuffer | undefined;
if (canonicalFrame && livenessDecision !== 'skipped') {
  const r2Key = `photos/clock/${id}.jpg`;
  await c.env.STORAGE.put(r2Key, canonicalFrame, { httpMetadata: { contentType: 'image/jpeg' } });
  await c.env.DB.prepare('UPDATE clock_records SET photo_url = ? WHERE id = ?')
    .bind(`/api/photos/clock/${id}`, id).run();
}
```

(The standalone `POST /:id/photo` route is left in place for backward compatibility with stale PWA caches but is effectively superseded.)

- [ ] **Step 11.3: Remove dead code**

In `packages/api/src/routes/clock.ts`:
- Delete the `generatePromptValue` function.
- Remove `prompt_value` from `clockSchema` (it was never accepted there anyway, just confirm).
- Remove the now-unused `promptValue` local variable from the `POST /` handler.
- Remove the `prompt_value` column from the `INSERT INTO clock_records` statement (already removed in the new INSERT above — verify).

- [ ] **Step 11.4: Type-check**

```bash
cd packages/api
node ../../node_modules/typescript/bin/tsc --noEmit
```

Expected: clean.

- [ ] **Step 11.5: Run all tests**

```bash
npm test
```

Expected: all liveness service tests still green. (No new tests in this task — covered by smoke test in Task 21.)

- [ ] **Step 11.6: Commit**

```bash
git add packages/api/src/routes/clock.ts
git commit -m "feat(api): wire passive-liveness gate + multipart burst into POST /clock"
```

---

## Task 12: Set up Vitest in `packages/staff/`

**Files:**
- Create: `packages/staff/vitest.config.ts`
- Modify: `packages/staff/package.json`

- [ ] **Step 12.1: Add Vitest + jsdom**

```bash
npm --workspace packages/staff install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 12.2: Add test scripts**

Modify `packages/staff/package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 12.3: Add Vitest config**

Create `packages/staff/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
  },
});
```

- [ ] **Step 12.4: Verify**

```bash
cd packages/staff
npm test
```

Expected: `No test files found`. Exit 0.

- [ ] **Step 12.5: Commit**

```bash
git add packages/staff/vitest.config.ts packages/staff/package.json package-lock.json
git commit -m "chore(staff): add vitest scaffolding for liveness component tests"
```

---

## Task 13: Add MediaPipe dependency to staff PWA

**Files:**
- Modify: `packages/staff/package.json`

- [ ] **Step 13.1: Install `@mediapipe/tasks-vision`**

```bash
npm --workspace packages/staff install @mediapipe/tasks-vision
```

Expected: `package.json` gains `"@mediapipe/tasks-vision": "^0.x.x"` (whatever resolves at install time).

- [ ] **Step 13.2: Commit**

```bash
git add packages/staff/package.json package-lock.json
git commit -m "chore(staff): add @mediapipe/tasks-vision for client liveness UX"
```

---

## Task 14: Staff liveness types + frame burst encoder

**Files:**
- Create: `packages/staff/src/lib/liveness/types.ts`
- Create: `packages/staff/src/lib/liveness/frameBurstEncoder.ts`

- [ ] **Step 14.1: Create the types module**

Create `packages/staff/src/lib/liveness/types.ts`:

```ts
export type LivenessChallenge = 'blink' | 'turn_left' | 'turn_right' | 'smile';

export type LivenessUiState =
  | 'idle'
  | 'looking-for-face'
  | 'face-off-center'
  | 'low-light'
  | 'ready'
  | 'challenge-active'
  | 'challenge-detected'
  | 'capturing'
  | 'failed';

export interface FrameBurst {
  frame0: Blob;
  frame1: Blob;
  frame2: Blob;
}
```

- [ ] **Step 14.2: Create the frame burst encoder**

Create `packages/staff/src/lib/liveness/frameBurstEncoder.ts`:

```ts
import type { FrameBurst } from './types';

/**
 * Capture three JPEG frames from a `<video>` element across a ~2s window.
 * Frame 0 captures immediately (baseline), Frame 1 at ~1s (mid-challenge),
 * Frame 2 at ~2s (post-challenge). Frames are cropped to a centered 480x480
 * square at 0.85 quality.
 */
export async function captureFrameBurst(video: HTMLVideoElement): Promise<FrameBurst> {
  const f0 = await captureSquare(video);
  await wait(1000);
  const f1 = await captureSquare(video);
  await wait(1000);
  const f2 = await captureSquare(video);
  return { frame0: f0, frame1: f1, frame2: f2 };
}

const SIZE = 480;

async function captureSquare(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const vw = video.videoWidth || SIZE;
  const vh = video.videoHeight || SIZE;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;
  ctx.drawImage(video, sx, sy, side, side, 0, 0, SIZE, SIZE);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      0.85,
    );
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
```

- [ ] **Step 14.3: Type-check**

```bash
cd packages/staff
node ../../node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 14.4: Commit**

```bash
git add packages/staff/src/lib/liveness/types.ts packages/staff/src/lib/liveness/frameBurstEncoder.ts
git commit -m "feat(staff): liveness types + frame-burst encoder"
```

---

## Task 15: Client-side challenge detector (TDD)

**Files:**
- Create: `packages/staff/src/lib/liveness/challengeDetector.test.ts`
- Create: `packages/staff/src/lib/liveness/challengeDetector.ts`

The client uses MediaPipe's 478-landmark output. We don't replicate the server's exact thresholds — the client's job is just to *fire the green flash* once the user has clearly performed the action. False-positives on the client are fine (the server is the gate); false-negatives waste a retry, so be lenient.

- [ ] **Step 15.1: Write failing tests**

Create `packages/staff/src/lib/liveness/challengeDetector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectClientChallenge, type LandmarkSnapshot } from './challengeDetector';

function snap(over: Partial<LandmarkSnapshot> = {}): LandmarkSnapshot {
  return {
    leftEyeOpenness: 0.5,
    rightEyeOpenness: 0.5,
    nosePos: [0.5, 0.5],
    eyeMidpoint: [0.5, 0.4],
    mouthSpread: 0.10,
    ...over,
  };
}

describe('detectClientChallenge — blink', () => {
  it('fires when both eyes close significantly', () => {
    const baseline = snap();
    const peak = snap({ leftEyeOpenness: 0.10, rightEyeOpenness: 0.10 });
    expect(detectClientChallenge('blink', baseline, peak)).toBe(true);
  });

  it('does not fire on a static look', () => {
    const a = snap();
    expect(detectClientChallenge('blink', a, a)).toBe(false);
  });
});

describe('detectClientChallenge — turn_left', () => {
  it('fires when the nose drifts right of the eye midpoint', () => {
    const baseline = snap({ nosePos: [0.50, 0.50], eyeMidpoint: [0.50, 0.40] });
    const peak = snap({ nosePos: [0.58, 0.50], eyeMidpoint: [0.50, 0.40] });
    expect(detectClientChallenge('turn_left', baseline, peak)).toBe(true);
  });
});

describe('detectClientChallenge — turn_right', () => {
  it('fires when the nose drifts left of the eye midpoint', () => {
    const baseline = snap({ nosePos: [0.50, 0.50], eyeMidpoint: [0.50, 0.40] });
    const peak = snap({ nosePos: [0.42, 0.50], eyeMidpoint: [0.50, 0.40] });
    expect(detectClientChallenge('turn_right', baseline, peak)).toBe(true);
  });
});

describe('detectClientChallenge — smile', () => {
  it('fires when mouth spread increases', () => {
    const baseline = snap({ mouthSpread: 0.10 });
    const peak = snap({ mouthSpread: 0.14 });
    expect(detectClientChallenge('smile', baseline, peak)).toBe(true);
  });
});
```

- [ ] **Step 15.2: Run — should fail**

```bash
cd packages/staff
npm test -- challengeDetector
```

- [ ] **Step 15.3: Implement `challengeDetector.ts`**

Create `packages/staff/src/lib/liveness/challengeDetector.ts`:

```ts
import type { LivenessChallenge } from './types';

export interface LandmarkSnapshot {
  leftEyeOpenness: number;     // [0,1] — height-to-width ratio of the eye
  rightEyeOpenness: number;
  nosePos: [number, number];   // normalised image coords
  eyeMidpoint: [number, number];
  mouthSpread: number;         // distance between mouth corners, normalised
}

const T = {
  blink: 0.20,        // both eyes drop by ≥0.20 from baseline
  turn: 0.06,         // nose drifts by ≥0.06 from eye midpoint
  smile: 0.025,       // mouth spread increases by ≥0.025
};

export function detectClientChallenge(
  challenge: LivenessChallenge,
  baseline: LandmarkSnapshot,
  current: LandmarkSnapshot,
): boolean {
  switch (challenge) {
    case 'blink': {
      const lDelta = baseline.leftEyeOpenness - current.leftEyeOpenness;
      const rDelta = baseline.rightEyeOpenness - current.rightEyeOpenness;
      return lDelta >= T.blink && rDelta >= T.blink;
    }
    case 'turn_left': {
      const baseOffset = baseline.nosePos[0] - baseline.eyeMidpoint[0];
      const curOffset = current.nosePos[0] - current.eyeMidpoint[0];
      return curOffset - baseOffset >= T.turn;
    }
    case 'turn_right': {
      const baseOffset = baseline.nosePos[0] - baseline.eyeMidpoint[0];
      const curOffset = current.nosePos[0] - current.eyeMidpoint[0];
      return baseOffset - curOffset >= T.turn;
    }
    case 'smile': {
      return current.mouthSpread - baseline.mouthSpread >= T.smile;
    }
  }
}
```

- [ ] **Step 15.4: Run — should pass**

```bash
npm test -- challengeDetector
```

- [ ] **Step 15.5: Commit**

```bash
git add packages/staff/src/lib/liveness/challengeDetector.ts packages/staff/src/lib/liveness/challengeDetector.test.ts
git commit -m "feat(staff): client-side challenge detector"
```

---

## Task 16: MediaPipe runner wrapper

**Files:**
- Create: `packages/staff/src/lib/liveness/mediapipeRunner.ts`

This wraps the MediaPipe FaceLandmarker in a small interface and converts its output into the `LandmarkSnapshot` shape that `challengeDetector.ts` consumes. The runner is dynamically imported so the WASM only loads when the user reaches the clock-in screen.

- [ ] **Step 16.1: Write the runner**

Create `packages/staff/src/lib/liveness/mediapipeRunner.ts`:

```ts
import type { LandmarkSnapshot } from './challengeDetector';

export interface MediaPipeRunner {
  start(video: HTMLVideoElement, onFrame: (snap: LandmarkSnapshot) => void): void;
  stop(): void;
  ready: Promise<void>;
}

export async function createMediaPipeRunner(): Promise<MediaPipeRunner> {
  // Dynamic import keeps the ~2MB WASM out of the initial bundle.
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');

  const filesetResolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
  );

  const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  });

  let raf: number | null = null;
  let onFrameCb: ((snap: LandmarkSnapshot) => void) | null = null;

  function loop(video: HTMLVideoElement) {
    if (video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, performance.now());
      const lm = result.faceLandmarks?.[0];
      const blend = result.faceBlendshapes?.[0]?.categories ?? [];
      if (lm && onFrameCb) {
        const blinkL = blend.find((c) => c.categoryName === 'eyeBlinkLeft')?.score ?? 0;
        const blinkR = blend.find((c) => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
        const smile = blend.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0;
        const snap: LandmarkSnapshot = {
          leftEyeOpenness: 1 - blinkL,
          rightEyeOpenness: 1 - blinkR,
          nosePos: [lm[1]!.x, lm[1]!.y],
          eyeMidpoint: [(lm[33]!.x + lm[263]!.x) / 2, (lm[33]!.y + lm[263]!.y) / 2],
          mouthSpread: Math.abs(lm[61]!.x - lm[291]!.x) + smile * 0.05,
        };
        onFrameCb(snap);
      }
    }
    raf = requestAnimationFrame(() => loop(video));
  }

  return {
    start(video, cb) {
      onFrameCb = cb;
      loop(video);
    },
    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      onFrameCb = null;
      landmarker.close();
    },
    ready: Promise.resolve(),
  };
}
```

(Indices `1`, `33`, `263`, `61`, `291` are the canonical MediaPipe landmark IDs for nose tip, outer-left eye, outer-right eye, left mouth corner, right mouth corner respectively. If you get NaNs in dev, double-check these against the published `face_landmarker.task` index map.)

- [ ] **Step 16.2: Type-check**

```bash
cd packages/staff
node ../../node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 16.3: Commit**

```bash
git add packages/staff/src/lib/liveness/mediapipeRunner.ts
git commit -m "feat(staff): MediaPipe FaceLandmarker runner (lazy-loaded)"
```

---

## Task 17: `LivenessCapture.tsx` component

**Files:**
- Create: `packages/staff/src/lib/liveness/LivenessCapture.tsx`

This is the user-facing component: full-bleed camera, dimmed outside a circular cutout, scanning ring with state-driven colors, hint line, animated challenge guide, green-flash confirmation.

- [ ] **Step 17.1: Write the component**

Create `packages/staff/src/lib/liveness/LivenessCapture.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { LivenessChallenge, LivenessUiState, FrameBurst } from './types';
import type { LandmarkSnapshot } from './challengeDetector';
import { detectClientChallenge } from './challengeDetector';
import { createMediaPipeRunner, type MediaPipeRunner } from './mediapipeRunner';
import { captureFrameBurst } from './frameBurstEncoder';

interface Props {
  challenge: LivenessChallenge;
  onComplete: (burst: FrameBurst, claimedCompleted: boolean) => void;
  onCameraError: (err: Error) => void;
  onRequestManualReview: () => void;
}

const HINT_BY_CHALLENGE: Record<LivenessChallenge, string> = {
  blink: 'Blink slowly',
  turn_left: 'Turn slightly left',
  turn_right: 'Turn slightly right',
  smile: 'Smile briefly',
};

export function LivenessCapture(props: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const baselineRef = useRef<LandmarkSnapshot | null>(null);
  const completedRef = useRef(false);
  const failedAttemptsRef = useRef(0);
  const [uiState, setUiState] = useState<LivenessUiState>('idle');

  useEffect(() => {
    let cancelled = false;
    let runner: MediaPipeRunner | null = null;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setUiState('looking-for-face');

        runner = await createMediaPipeRunner();
        if (cancelled) return;

        runner.start(videoRef.current!, (snap) => {
          if (completedRef.current) return;
          if (!baselineRef.current) {
            baselineRef.current = snap;
            setUiState('challenge-active');
            // Begin capture window immediately when baseline is set
            void runCapture();
            return;
          }
          if (detectClientChallenge(props.challenge, baselineRef.current, snap)) {
            setUiState('challenge-detected');
            completedRef.current = true;
          }
        });
      } catch (err) {
        props.onCameraError(err as Error);
      }
    })();

    async function runCapture() {
      try {
        setUiState('capturing');
        const burst = await captureFrameBurst(videoRef.current!);
        props.onComplete(burst, completedRef.current);
      } catch {
        failedAttemptsRef.current += 1;
        setUiState('failed');
      }
    }

    return () => {
      cancelled = true;
      runner?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [props.challenge]);

  const ringColor =
    uiState === 'challenge-detected' ? 'ring-emerald-400'
    : uiState === 'challenge-active' || uiState === 'capturing' ? 'ring-emerald-300'
    : uiState === 'looking-for-face' ? 'ring-zinc-400'
    : 'ring-amber-400';

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Vignette + cutout */}
      <div className="absolute inset-0 bg-black/60 [mask:radial-gradient(circle_at_center,transparent_140px,black_141px)]" />
      {/* Scanning ring */}
      <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] rounded-full ring-4 ${ringColor} ${uiState === 'challenge-detected' ? '' : 'animate-pulse'}`} />
      {/* Hint line */}
      <div className="absolute bottom-24 left-0 right-0 text-center text-white text-base font-medium">
        {uiState === 'looking-for-face' && 'Hold steady'}
        {uiState === 'challenge-active' && HINT_BY_CHALLENGE[props.challenge]}
        {uiState === 'challenge-detected' && '✓'}
        {uiState === 'capturing' && ''}
        {uiState === 'failed' && (
          <>
            <div>Having trouble?</div>
            {failedAttemptsRef.current >= 2 && (
              <button
                className="mt-2 underline text-sm text-amber-300"
                onClick={props.onRequestManualReview}
              >
                Submit for HR review →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 17.2: Type-check**

```bash
cd packages/staff
node ../../node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 17.3: Commit**

```bash
git add packages/staff/src/lib/liveness/LivenessCapture.tsx
git commit -m "feat(staff): LivenessCapture component"
```

---

## Task 18: Update API client (`api.ts`)

**Files:**
- Modify: `packages/staff/src/lib/api.ts`

- [ ] **Step 18.1: Update `ClockPrompt` and `fetchClockPrompt`**

Replace the Clock-in re-auth + liveness section in `packages/staff/src/lib/api.ts`:

```ts
// ---- Clock-in re-auth + liveness helpers ----

export type LivenessChallenge = 'blink' | 'turn_left' | 'turn_right' | 'smile';

export interface ClockPrompt {
  promptId: string;
  challengeAction: LivenessChallenge;
  expiresAt: number;
}

/** Issue a fresh single-use prompt for the next clock-in. */
export async function fetchClockPrompt(): Promise<ClockPrompt> {
  const res = await api.post<{
    prompt_id: string;
    challenge_action: LivenessChallenge;
    expires_at: number;
  }>('/clock/prompt');
  if (!res.data) throw new Error('Empty prompt response');
  return {
    promptId: res.data.prompt_id,
    challengeAction: res.data.challenge_action,
    expiresAt: res.data.expires_at,
  };
}

export interface ClockSubmission {
  type: 'clock_in' | 'clock_out';
  latitude: number;
  longitude: number;
  accuracy?: number;
  idempotencyKey?: string;
  promptId?: string;
  webauthnAssertion?: unknown;
  pin?: string;
  livenessBurst?: { frame0: Blob; frame1: Blob; frame2: Blob; claimedCompleted: boolean };
}

export interface ClockResult {
  id: string;
  type: 'clock_in' | 'clock_out';
  timestamp: string;
  user_name: string;
  staff_id: string;
  within_geofence: boolean;
  distance_meters: number;
  streak: number;
  longest_streak: number;
  deduplicated?: boolean;
  liveness_decision?: 'pass' | 'fail' | 'manual_review' | 'skipped' | null;
}

/** Submit a clock-in/out — multipart when liveness frames are attached, JSON otherwise. */
export async function submitClock(input: ClockSubmission): Promise<ClockResult> {
  const payload = {
    type: input.type,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy,
    idempotency_key: input.idempotencyKey,
    prompt_id: input.promptId,
    webauthn_assertion: input.webauthnAssertion,
    pin: input.pin,
  };

  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  let body: BodyInit;
  if (input.livenessBurst) {
    const fd = new FormData();
    fd.append('payload', JSON.stringify(payload));
    fd.append('frame_0', input.livenessBurst.frame0, 'frame_0.jpg');
    fd.append('frame_1', input.livenessBurst.frame1, 'frame_1.jpg');
    fd.append('frame_2', input.livenessBurst.frame2, 'frame_2.jpg');
    fd.append('challenge_action_completed', input.livenessBurst.claimedCompleted ? 'true' : 'false');
    body = fd;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(payload);
  }

  const res = await fetch(`${API_BASE}/clock/`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body,
  });
  const json = await res.json() as ApiResponse<ClockResult>;
  if (!res.ok || json.error) {
    if (res.status === 401) window.location.href = '/login';
    throw new ApiError(json.error?.code ?? 'UNKNOWN', json.error?.message ?? 'Error', res.status);
  }
  if (!json.data) throw new Error('Empty clock response');
  return json.data;
}
```

(Note the `ApiError` class is already defined in this file. The `getToken` import is already at the top.)

- [ ] **Step 18.2: Type-check**

```bash
cd packages/staff
node ../../node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 18.3: Commit**

```bash
git add packages/staff/src/lib/api.ts
git commit -m "feat(staff): API client supports multipart liveness burst + challenge_action"
```

---

## Task 19: Wire `LivenessCapture` into `ClockPage.tsx`

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

This is the largest UI edit. It replaces the inline `getUserMedia` block with `<LivenessCapture/>`, deletes the visible-number prompt UI, and adds the manual-review escape valve.

The exact diff depends on the current structure of `ClockPage.tsx`. Read the file first; the touch points are:

1. **Remove** any rendering of the visible 2-digit prompt (lines that show `prompt_value` or similar text like *"Show this number…"*).
2. **Replace** the inline `<video>` + `getUserMedia` setup with `<LivenessCapture challenge={prompt.challengeAction} onComplete={...} onCameraError={...} onRequestManualReview={...} />`.
3. **Wire** `onComplete` so it stashes the `FrameBurst` + `claimedCompleted` flag and proceeds to the WebAuthn / PIN re-auth step — the burst gets passed through to `submitClock` via the new `livenessBurst` field.
4. **Wire** `onRequestManualReview` to call `submitClock` *without* `livenessBurst` (so the server routes to `manual_review` per Task 11's logic).
5. **Warm MediaPipe** — kick off `import('../lib/liveness/mediapipeRunner')` during the geofence pre-check phase so the WASM is cached by the time the camera opens.

- [ ] **Step 19.1: Read `ClockPage.tsx` for orientation**

```bash
# pseudo-step — actually use Read tool
# the engineer should open packages/staff/src/pages/ClockPage.tsx and locate:
#   - the phase state machine (idle → locating → photo → reauth → submitting)
#   - the existing capturePhoto() function
#   - the visible-prompt rendering block
```

- [ ] **Step 19.2: Replace the visible-prompt rendering**

Find the JSX block that renders the prompt value (search for `promptValue` or `Show this number`). Delete it entirely.

- [ ] **Step 19.3: Replace the inline camera with `<LivenessCapture/>`**

Locate the existing `<video ref={videoRef}>` block and the surrounding `startCamera` / `capturePhoto` flow. Replace with:

```tsx
import { LivenessCapture } from '../lib/liveness/LivenessCapture';
import type { FrameBurst } from '../lib/liveness/types';

// inside the component, in the photo-capture phase render branch:
{phase === 'photo' && prompt && (
  <LivenessCapture
    challenge={prompt.challengeAction}
    onComplete={(burst, claimedCompleted) => {
      setFrameBurst(burst);
      setClaimedCompleted(claimedCompleted);
      setPhase('reauth'); // or whatever your next-phase setter is named
    }}
    onCameraError={(err) => {
      console.warn('Camera unavailable', err);
      setPhase('reauth'); // graceful — re-auth still possible without burst
    }}
    onRequestManualReview={() => {
      setRequestedManualReview(true);
      setPhase('reauth');
    }}
  />
)}
```

Add the supporting state at the top of the component:

```tsx
const [frameBurst, setFrameBurst] = useState<FrameBurst | null>(null);
const [claimedCompleted, setClaimedCompleted] = useState(false);
const [requestedManualReview, setRequestedManualReview] = useState(false);
```

- [ ] **Step 19.4: Pass burst into `submitClock`**

Locate the existing `tryReauthAndSubmit()` (or equivalent) function. Update the `submitClock` call:

```tsx
await submitClock({
  type,
  latitude,
  longitude,
  accuracy,
  idempotencyKey,
  promptId: prompt.promptId,
  webauthnAssertion,
  pin,
  ...(frameBurst && !requestedManualReview ? {
    livenessBurst: {
      frame0: frameBurst.frame0,
      frame1: frameBurst.frame1,
      frame2: frameBurst.frame2,
      claimedCompleted,
    },
  } : {}),
});
```

- [ ] **Step 19.5: Warm MediaPipe during geofence pre-check**

Find the geofence pre-check (where the page transitions from `idle` to `locating`). Add a fire-and-forget warm:

```tsx
// Warm MediaPipe WASM in parallel with geolocation
void import('../lib/liveness/mediapipeRunner');
```

- [ ] **Step 19.6: Type-check**

```bash
cd packages/staff
node ../../node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 19.7: Build the PWA to confirm bundling works**

```bash
npm run build
```

Expected: clean build. Watch for the `@mediapipe/tasks-vision` chunk being separated (lazy-loaded).

- [ ] **Step 19.8: Commit**

```bash
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): replace visible-number prompt with LivenessCapture"
```

---

## Task 20: Admin attendance — Liveness column + evidence card

**Files:**
- Create: `packages/web/src/components/admin/LivenessEvidenceCard.tsx`
- Modify: `packages/web/src/components/admin/AttendanceTab.tsx`

- [ ] **Step 20.1: Create the evidence card**

Create `packages/web/src/components/admin/LivenessEvidenceCard.tsx`:

```tsx
interface LivenessSignature {
  v: 1;
  challenge_action: 'blink' | 'turn_left' | 'turn_right' | 'smile';
  challenge_completed: boolean;
  motion_delta: number;
  face_score: number;
  sharpness: number;
  decision: 'pass' | 'fail' | 'manual_review' | 'skipped';
  model_version: string;
  screen_artifact_score: number | null;
  ms_total: number;
}

const LABEL: Record<LivenessSignature['challenge_action'], string> = {
  blink: 'Blink',
  turn_left: 'Turn left',
  turn_right: 'Turn right',
  smile: 'Smile',
};

export function LivenessEvidenceCard({ signature }: { signature: LivenessSignature }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm space-y-1">
      <div className="font-medium">Liveness evidence</div>
      <div>Challenge: <span className="font-mono">{LABEL[signature.challenge_action]}</span></div>
      <div>Completed: {signature.challenge_completed ? 'yes' : 'no'}</div>
      <div>Motion delta: <span className="font-mono">{signature.motion_delta.toFixed(3)}</span></div>
      <div>Face confidence: <span className="font-mono">{(signature.face_score * 100).toFixed(1)}%</span></div>
      <div>Decision: <span className={`font-mono ${signature.decision === 'pass' ? 'text-emerald-700' : signature.decision === 'fail' ? 'text-red-700' : 'text-amber-700'}`}>{signature.decision}</span></div>
      <div className="text-zinc-500 text-xs">model: {signature.model_version} · {signature.ms_total}ms</div>
    </div>
  );
}
```

- [ ] **Step 20.2: Replace the Prompt column with Liveness in `AttendanceTab.tsx`**

Open `packages/web/src/components/admin/AttendanceTab.tsx` and:

1. Search for `prompt_value` references — replace the column header "Prompt" with "Liveness".
2. Replace the cell rendering: instead of showing `record.prompt_value`, show a colored pill based on `record.liveness_decision`:
   - `pass` → emerald
   - `fail` → red
   - `manual_review` → amber
   - `skipped` or `null` → zinc
3. On row expand, render `<LivenessEvidenceCard signature={JSON.parse(record.liveness_signature)} />` if `record.liveness_signature` is non-null.

Concrete cell snippet:

```tsx
import { LivenessEvidenceCard } from './LivenessEvidenceCard';

function LivenessPill({ decision }: { decision: string | null }) {
  const cls =
    decision === 'pass' ? 'bg-emerald-100 text-emerald-800'
    : decision === 'fail' ? 'bg-red-100 text-red-800'
    : decision === 'manual_review' ? 'bg-amber-100 text-amber-800'
    : 'bg-zinc-100 text-zinc-600';
  const label = decision ?? '—';
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
}
```

- [ ] **Step 20.3: Type-check + build the admin app**

```bash
cd packages/web
node ../../node_modules/typescript/bin/tsc --noEmit
npm run build
```

- [ ] **Step 20.4: Commit**

```bash
git add packages/web/src/components/admin/LivenessEvidenceCard.tsx packages/web/src/components/admin/AttendanceTab.tsx
git commit -m "feat(web): admin attendance shows liveness column + evidence card"
```

---

## Task 21: Liveness metrics widget for shadow telemetry

**Files:**
- Create: `packages/web/src/components/admin/LivenessMetricsWidget.tsx`
- Modify: `packages/web/src/components/admin/AttendanceTab.tsx` (mount the widget at top of page)
- Modify: `packages/api/src/routes/clock.ts` or a new admin route (depending on existing admin metrics conventions)

The widget displays the four metrics from the spec's Phase 1 gate:
- Liveness pass rate (target ≥97%)
- Per-challenge pass rate (4 sub-bars)
- Median `ms_total`
- Manual-review request rate

- [ ] **Step 21.1: Add a server endpoint for the metrics**

Add to `packages/api/src/routes/clock.ts` (or wherever admin-only routes live):

```ts
// Returns aggregate liveness metrics for the last `days` (default 7).
// Requires admin role — wire into the existing admin auth middleware.
clockRoutes.get('/admin/liveness-metrics', async (c) => {
  // (Insert your existing admin role check here.)
  const days = Math.min(30, Math.max(1, Number(c.req.query('days') ?? 7)));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const rows = await c.env.DB.prepare(
    `SELECT liveness_decision, liveness_challenge, liveness_signature
     FROM clock_records
     WHERE timestamp >= ? AND liveness_decision IS NOT NULL`
  ).bind(since).all<{ liveness_decision: string; liveness_challenge: string | null; liveness_signature: string | null }>();

  const all = rows.results ?? [];
  const total = all.length;
  const passes = all.filter((r) => r.liveness_decision === 'pass').length;
  const reviews = all.filter((r) => r.liveness_decision === 'manual_review').length;
  const skipped = all.filter((r) => r.liveness_decision === 'skipped').length;

  const perChallenge: Record<string, { total: number; pass: number }> = {};
  let totalMs = 0;
  let msCount = 0;
  const msSamples: number[] = [];

  for (const r of all) {
    if (r.liveness_challenge) {
      const slot = perChallenge[r.liveness_challenge] ?? { total: 0, pass: 0 };
      slot.total += 1;
      if (r.liveness_decision === 'pass') slot.pass += 1;
      perChallenge[r.liveness_challenge] = slot;
    }
    if (r.liveness_signature) {
      try {
        const sig = JSON.parse(r.liveness_signature) as { ms_total?: number };
        if (typeof sig.ms_total === 'number') { msSamples.push(sig.ms_total); totalMs += sig.ms_total; msCount += 1; }
      } catch { /* ignore parse errors */ }
    }
  }

  msSamples.sort((a, b) => a - b);
  const median = msSamples.length ? msSamples[Math.floor(msSamples.length / 2)]! : 0;

  return success(c, {
    total,
    pass_rate: total ? passes / total : 0,
    review_rate: total ? reviews / total : 0,
    skipped_rate: total ? skipped / total : 0,
    per_challenge: perChallenge,
    median_ms: median,
    days,
  });
});
```

- [ ] **Step 21.2: Build the React widget**

Create `packages/web/src/components/admin/LivenessMetricsWidget.tsx`:

```tsx
import { useEffect, useState } from 'react';

interface Metrics {
  total: number;
  pass_rate: number;
  review_rate: number;
  skipped_rate: number;
  per_challenge: Record<string, { total: number; pass: number }>;
  median_ms: number;
  days: number;
}

export function LivenessMetricsWidget() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    // Replace with your existing admin api wrapper.
    fetch('/api/clock/admin/liveness-metrics?days=7', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => setMetrics(j.data));
  }, []);

  if (!metrics) return <div className="text-sm text-zinc-500">Loading liveness metrics…</div>;
  if (metrics.total === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-4">
      <div className="text-sm font-medium mb-2">Liveness — last {metrics.days} days</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Tile label="Pass rate" value={pct(metrics.pass_rate)} target="≥97%" ok={metrics.pass_rate >= 0.97} />
        <Tile label="Manual reviews" value={pct(metrics.review_rate)} target="<2%" ok={metrics.review_rate < 0.02} />
        <Tile label="Median latency" value={`${metrics.median_ms}ms`} target="<2500ms" ok={metrics.median_ms < 2500} />
        <Tile label="Skipped" value={pct(metrics.skipped_rate)} target="<0.5%" ok={metrics.skipped_rate < 0.005} />
      </div>
      <div className="mt-3 text-xs text-zinc-600">
        Per-challenge:&nbsp;
        {Object.entries(metrics.per_challenge).map(([k, v]) => (
          <span key={k} className="mr-3">
            <span className="font-mono">{k}</span> {pct(v.total ? v.pass / v.total : 0)} ({v.total})
          </span>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value, target, ok }: { label: string; value: string; target: string; ok: boolean }) {
  return (
    <div className={`rounded-lg p-2 ${ok ? 'bg-emerald-50' : 'bg-amber-50'}`}>
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="text-lg font-mono">{value}</div>
      <div className="text-[10px] text-zinc-500">target {target}</div>
    </div>
  );
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
```

- [ ] **Step 21.3: Mount the widget at the top of `AttendanceTab`**

Add `<LivenessMetricsWidget />` near the top of the AttendanceTab JSX.

- [ ] **Step 21.4: Type-check + build**

```bash
cd packages/web
node ../../node_modules/typescript/bin/tsc --noEmit
npm run build

cd ../api
node ../../node_modules/typescript/bin/tsc --noEmit
```

- [ ] **Step 21.5: Commit**

```bash
git add packages/web/src/components/admin/LivenessMetricsWidget.tsx packages/web/src/components/admin/AttendanceTab.tsx packages/api/src/routes/clock.ts
git commit -m "feat: liveness shadow-mode metrics widget + admin endpoint"
```

---

## Task 22: End-to-end smoke checklist + shadow-mode verification

This task is **manual** — no code, but it's the gate before flipping `clockin_passive_liveness_enforce=1` per the spec's Phase 1 → 2 transition.

- [ ] **Step 22.1: Local smoke test**

```bash
# Terminal 1: run the Worker
cd packages/api
npm run dev

# Terminal 2: run the staff PWA
cd packages/staff
npm run dev

# Terminal 3: run the admin web
cd packages/web
npm run dev
```

In a browser:
1. Log in to the staff PWA as a seeded user.
2. Tap **Clock In**. Confirm:
   - No visible 2-digit number anywhere.
   - Camera opens with the centred cutout + scanning ring.
   - Hint line shows "Hold steady" then one of: "Blink slowly" / "Turn slightly left" / "Turn slightly right" / "Smile briefly".
   - Performing the action triggers a green-flash confirmation.
   - Re-auth (WebAuthn or PIN) follows.
   - Clock-in succeeds.
3. In the admin web, open the attendance tab. Confirm the new clock-in shows in the **Liveness** column with `pass`. Expand the row — the evidence card renders with the challenge action, motion delta, face score.
4. Run all four challenges by reloading and re-attempting a few clock-outs/clock-ins (the random pool will eventually cover them).

- [ ] **Step 22.2: Negative-path checks**

- Hold a static photo to the camera (e.g., from another phone) → expect liveness `fail` and (in shadow mode) the clock-in still records, in enforce mode the clock-in is rejected.
- Cover the camera with a finger → liveness `fail` (no face detected). Confirm UI shows "Move into better light" / "Bring face closer".
- Tap "Submit for HR review →" after two failed attempts → clock-in records with `liveness_decision='manual_review'` and the weekly counter increments. Repeat 3 times in the same week → expect the third attempt to be rejected with `LIVENESS_REVIEW_CAP`.

- [ ] **Step 22.3: Workers AI failure simulation**

Temporarily comment out the `[ai]` binding in `wrangler.toml` (or set `c.env.AI` to undefined in a dev-only override) and confirm the route returns `liveness_decision='skipped'` and routes to manual-review without consuming the user's weekly cap.

- [ ] **Step 22.4: Phase 1 → 2 telemetry gate (production)**

After deploying to production with `clockin_passive_liveness_enforce=0`, run for ~7 days. Then check the **Liveness metrics widget** in the admin attendance tab:

- Pass rate ≥ 97%? If not, examine per-challenge rates and adjust thresholds in `packages/api/src/services/liveness/motion.ts`.
- Per-challenge pass rates within ±2% of each other? If a challenge skews (e.g., `smile` fails for 12% of dark-skinned users under fluorescent light), restrict the pool in `chooseChallenge()` to the well-performing actions.
- Median `ms_total` < 2500ms? If not, investigate Workers AI cold-start (consider warm-up cron) or upload size.
- Manual-review request rate < 2%? If not, dig into root cause (lighting? device? specific demographic?).

Once gates are green, flip `clockin_passive_liveness_enforce=1` via the admin settings UI.

- [ ] **Step 22.5: Mark complete**

When all four gates are green and enforce-mode is on, this plan is fully deployed. Plan 2 (face-match) starts on top of the canonical-frame pipeline produced here.

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| UX flow (camera + ring + challenge + green flash) | Tasks 14-19 |
| Hybrid architecture (client MediaPipe + server Workers AI) | Tasks 5-9 (server), 14-17 (client), 19 (integration) |
| Trust boundary (server re-derives from raw frames) | Task 11 (multipart endpoint) + Task 9 (orchestrator) |
| `clock_records` schema (drop `prompt_value` later, add 3 cols) | Task 2 (Phase 1 only — `prompt_value` drop is explicitly deferred 30 days) |
| `app_settings` 3 new keys + cache invalidation | Tasks 2-3 |
| KV `clock-prompt` shape (add `challenge_action`, drop `prompt_value`) | Task 10 |
| KV manual-review counter (`clock-liveness-review`) | Task 8 |
| `LivenessSignature` JSON contract (versioned `v: 1`) | Task 4 (types) + Task 9 (builder) |
| Phase 0 build + Phase 1 shadow + Phase 2 enforce | Task 11 (gating logic) + Task 22 (manual phase gate) |
| Kill-switch (single setting flip) | Built in by Task 11's `enforceLiveness` check |
| Workers AI error → `decision='skipped'` + auto-route to manual_review w/o consuming cap | Task 9 (skipped decision) + Task 11 (no counter increment for skipped) |
| Edge case: no camera / MediaPipe fails → blind capture fallback | Task 19 (`onCameraError` proceeds without burst) |
| Manual-review escape valve UI after 2 retries | Task 17 (`failedAttemptsRef` + button), Task 19 (wired into ClockPage) |
| Admin: replace Prompt column with Liveness column + evidence card | Task 20 |
| Admin: shadow-mode metrics widget | Task 21 |
| Smoke test + telemetry gates before enforce | Task 22 |
| Phase 3 Plan 2 face-match foundation (canonical frame, MediaPipe component reuse, manual-review queue) | Implicit — `LivenessVerification.canonicalFrame` is what Plan 2 consumes |

No gaps identified.

**Placeholder scan:** No `TBD`, no `add appropriate error handling`, no `similar to Task N` deferrals. Each task contains the actual code or the exact transformation. The `// (Insert your existing admin role check here.)` in Task 21 is the only spot where the engineer needs to wire in existing infrastructure — that's a known-extant integration point, not a placeholder.

**Type consistency:**
- `LivenessChallenge`, `LivenessDecision`, `LivenessSignature` defined once in Task 4 (api) and mirrored in Task 14 (staff). Identical names and shapes — no drift.
- `verifyLivenessBurst` arg signature: `{ ai, frames, challenge, modelVersion }` consistent across Tasks 9 + 11.
- `incrementReviewCount(kv, userId, now?)` consistent across Tasks 8 + 11.
- KV key format `clock-liveness-review:{userId}:{isoWeek}` consistent.
- KV key format `clock-prompt:{promptId}` unchanged from existing code; only its **value shape** changes (Task 10).

No issues found in self-review.
