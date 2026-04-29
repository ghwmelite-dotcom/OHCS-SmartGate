# OHCS Clock-In — Face-Match Against Enrolled Reference — Design Proposal

**Status:** Draft for review
**Author:** Engineering
**Date:** 2026-04-29
**Audience:** OHCS leadership / engineering
**Companion to:** `2026-04-29-clockin-reauth-and-liveness-design.md` (ships first)

---

## Executive summary

The companion spec (re-auth + random prompt) closes the most common impersonation attacks: a colleague handing over their unlocked phone, or a friend reusing yesterday's selfie. What it does **not** stop is a determined attacker holding up a printed photo (or a phone screen showing a photo) of the real staff member. The captured selfie just shows that person's face, the prompt is visible, the biometric prompt was answered by whoever is holding the phone — but no automated check that the *face in the selfie* belongs to the staff member who is supposedly clocking in.

This spec adds that check. Each staff member enrolls a reference selfie once. Every clock-in selfie is server-side compared against the reference. Confident matches go through silently. Borderline matches are flagged for HR review but not blocked. Confident mismatches are rejected, the staff member can retry twice, and after that HR is paged.

The build is materially larger than the companion spec because it adds an enrollment workflow (capture, HR approval, re-enrollment with cooldown), a Workers AI inference path, threshold tuning over a 2-week observation window, and a graduated rollout with a kill-switch flag.

---

## What the staff member sees

**One-time enrollment:**

After this rolls out, each staff member sees a banner in the staff PWA: *"Set up Face ID for clock-in — takes 30 seconds."* Tapping opens a guided full-screen capture screen with a face-shaped overlay, real-time hints (*"Move closer", "Brighter light", "Hold still"*), and an auto-capture once everything looks good. The photo is submitted to HR for approval. The staff member sees a *"Pending HR approval"* badge until HR clicks Approve, at which point a green *"Face ID active"* badge appears. If HR rejects (e.g. unclear photo, wrong person), the staff member sees the reason and can resubmit immediately — no cooldown for fix-it retries.

**At clock-in:**

Nothing visibly changes for the happy path — the existing flow (prompt → photo → biometric/PIN) is unchanged. The face-match runs invisibly server-side in the second between submit and confirmation.

**On a failed match (under enforcement):** *"Face didn't match — check the lighting and try again."* They get two retries. After the third failure, *"Face Match locked for today — your supervisor has been notified."* HR can unlock with one tap from the admin portal.

**Re-enrollment** (haircut, glasses, weight change, anything that breaks matches): a *"Re-enrol my face"* button in Settings, available 90 days after the last approval. New photo still goes through HR approval; old photo stays active until the new one is approved.

---

## What HR / admin gets

**A new "Face Approvals" queue** in the admin portal: pending self-enrollments shown as a list of staff name + photo + role + directorate. Approve and Reject buttons. Reject requires a reason (free text or pick from "blurry", "wrong person", "lighting", "other"). Push notification when new submissions arrive (throttled to one per hour).

**Two new columns on the existing clock-in records page:**
- **Match score** — a number 0.00 to 1.00.
- **Match status** — one of *strong match* (hidden by default in filter), *low confidence* (yellow flag), *failed* (red flag), *no reference* (grey, shown during rollout for unenrolled staff), *inference error* (rare, infrastructure failure).

A new filter at the top: *"Show only flagged matches."* HR triages this in the morning the same way they handle absence notices today.

**A "Face Match Locked" banner** for any staff who hit the 3-strikes-in-a-day cap, with a one-tap unlock button. Audit-logged.

**A "rollout dashboard" widget** during the enrollment phase: *"X% of active staff enrolled. Y staff pending HR approval. Recommended threshold: enable enforcement when enrollment ≥80%."*

---

## How it stays secure (in plain English)

| Risk | How we handle it |
| --- | --- |
| Attacker holds up a printed photo of the real staff at clock-in | The photo's face matches, but lighting and depth cues degrade the match score. Borderline cases get flagged. Confident-match cases are rare with print-and-hold but possible — pair with the companion spec's prompt to make the prompt-in-photo also have to be present. |
| Attacker holds up a phone screen showing a video of the real staff | Same protection. The video face is still the right person, so this remains a residual risk that only liveness ML (separate, deferred) closes fully. The combination of *fresh prompt visible in frame* + *biometric on submit* + *face-match* makes this attack significantly harder than today's zero protection. |
| Two staff swap phones to clock each other in | Each staff has their own reference. Phone-A clocking in with Staff-B's face shows up as a hard mismatch. This is the canonical test case in QA. |
| Staff submits a fake reference photo of someone else | HR approval is the gate. HR sees the photo and the staff name side-by-side before approving. |
| HR admin abuses approval power to enrol a fake | Approval action is audit-logged with `approved_by`. A future audit query catches anomalies. Out of scope to harden further in this spec — it's an organizational control, not a technical one. |
| Real staff genuinely changes appearance (haircut, illness, glasses) | 90-day self-service re-enrollment. Old photo stays active until new one is approved, so no clock-in disruption during transition. |
| Workers AI is down or slow | Server treats inference failure as `match_error`: clock-in proceeds (we don't block real staff on transient infrastructure failures), admin sees a flag for the affected window. |
| False rejects from a tired model on a bad lighting day | Two-band design: only *confident* mismatches are blocked, gray-zone matches go through with a flag. Combined with 2 retries before lockout, false-reject pain is bounded. |

---

## Scope of work

**Phase A — Enrollment infrastructure (~5 days)**
New `face_references`, `face_references_pending`, `face_references_archive`, `face_match_unlocks` tables. Staff-side enrollment page with guided capture. Admin approval queue. Workers AI integration for embedding computation.

**Phase B — Match-at-clock-in (~3 days)**
New step inserted into the existing `POST /api/clock` between R2.put and D1.insert. Computes embedding, compares to reference, decides accept/flag/reject according to enforcement mode. Two new columns on `clock_records`. Match score column on admin attendance page.

**Phase C — Lockout & unlock (~2 days)**
Daily attempt counter in KV. 3-strikes lockout. HR unlock button + audit row. Push notifications.

**Phase D — Rollout (~3 weeks observed)**
Staged enforcement: `off` → `flag` → `enforce`. 2-week score-distribution observation under `off`. Re-tune thresholds. Flip to `flag` for 1 week. Flip to `enforce` once flag noise is acceptable.

**Total: ~10 days build + 3 weeks observed rollout.** Materially larger than the companion spec; do not bundle.

---

## Decisions needed from you

Five small things that shape details of the build:

1. **Workers AI model spike — first task.** A face-embedding model on Workers AI may not exist as a first-class option. The first day of work is a spike: try the available models, measure embedding quality on a 5-staff sample, decide between (a) a Workers AI model, (b) a vision LLM in yes/no mode, or (c) a custom face-embedding model deployed via WebAssembly inside the Worker. Each has cost and engineering trade-offs (covered in technical appendix). Acknowledge that this spike could change the cost profile by ±$50/month and add up to 3 days of work.
2. **Rejection reason free-text vs picklist.** Recommend picklist (*blurry, wrong person, lighting, other*) plus optional free-text. Keeps reasons consistent and structured for analytics. OK?
3. **Lockout duration.** Recommend 1 day (until next-day reset). Long enough to deter, short enough that real false-rejects don't cause overnight escalation. Or do we want HR-only-unlock with no automatic next-day reset?
4. **Enforcement target.** Recommend flipping to `enforce` only after enrollment ≥80% AND flag-mode false-positive rate <5% over 7 days. Or do we want a stricter / looser bar?
5. **Reference photo retention on staff exit.** When a staff member is deactivated, recommend immediate deletion of both the embedding and the R2 photo. Same-day, same transaction. Confirm — or do you want a grace period (e.g. retain 90 days for legal/audit purposes)?

---

## What this does NOT do (intentionally)

- **Liveness via face-match.** Face-match alone does not detect that the photo is of a *living* person versus a printed photo. The companion spec's prompt mechanism partially compensates (the prompt has to be visible in the same photo). True liveness ML (blink detection, head movement, depth cues) remains deferred.
- **Per-user adaptive thresholds.** Each user gets the same `LOW_THRESHOLD` and `HIGH_THRESHOLD`. If a user has chronically low scores (e.g. they always clock in from a backlit hallway), HR re-tunes their reference photo via re-enrollment, not by adjusting their personal threshold.
- **Multi-face detection rejection.** If a clock-in photo contains two faces (e.g. a colleague leaning in to help), the system runs match against the largest face. We don't reject because of multiple faces — too noisy a signal in the field.
- **Re-computing all embeddings on model upgrade.** If the Workers AI model is replaced or deprecated, the spec acknowledges this as a manual operational task — HR triggers a "rebuild embeddings" job that re-computes from the stored reference photos. Not automated; documented runbook.
- **Cross-checking against other staff's references.** We don't ask "does this clock-in selfie match anyone *other* than the claimed staff?" That's a 1:N search and adds substantial cost and complexity. Out of scope.
- **Browser-side embedding for low-confidence clock-ins.** Considered; rejected (defeats the purpose — client could lie about the embedding).

---

## Recommendation

Ship this **after** the companion spec is in production for at least 2 weeks and the prompt-mechanism rollout has settled. Reasons:

1. The companion spec closes 80% of the realistic attack surface with 20% of the complexity. Get that win banked first.
2. The 2-week soft-rollout window for face-match enforcement requires the prompt mechanism to already be in production so that all the clock-in photos used for threshold tuning have prompts and biometric assertions on them — those are the photos that should look like the future enforcement-on photos.
3. Workers AI cost and model availability are unknowns. Better to dispatch the spike (decision #1 above) without time pressure from the impersonation gap, since the prompt mechanism is already closing it for the realistic threats.

If face-impersonation via printed photos turns out to be a real problem in practice once the companion spec is live, this spec moves up the priority list. If admin review is showing all the impersonation attempts being caught by the prompt mismatch alone, this spec may be deferred indefinitely.

---

## Technical appendix (for the engineering team)

<details>
<summary>Click to expand — implementation details</summary>

### Data model

```sql
-- Approved reference embeddings (one per user, replaced on re-enrollment)
CREATE TABLE face_references (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo_key    TEXT NOT NULL,
  embedding    BLOB NOT NULL,
  model_id     TEXT NOT NULL,
  approved_at  INTEGER NOT NULL,
  approved_by  INTEGER NOT NULL REFERENCES users(id)
);

-- Pending self-enrollments awaiting HR approval
CREATE TABLE face_references_pending (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo_key        TEXT NOT NULL,
  embedding        BLOB NOT NULL,
  model_id         TEXT NOT NULL,
  submitted_at     INTEGER NOT NULL,
  rejected_at      INTEGER,
  rejected_reason  TEXT,
  rejected_by      INTEGER REFERENCES users(id)
);

-- Archived previous references (kept 30 days for audit/appeal)
CREATE TABLE face_references_archive (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo_key       TEXT NOT NULL,
  embedding       BLOB NOT NULL,
  model_id        TEXT NOT NULL,
  approved_at     INTEGER NOT NULL,
  archived_at     INTEGER NOT NULL,
  archived_reason TEXT
);

-- HR overrides on retry-lockout, audit-only
CREATE TABLE face_match_unlocks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unlocked_by  INTEGER NOT NULL REFERENCES users(id),
  unlocked_at  INTEGER NOT NULL,
  reason       TEXT
);

-- Two new columns on clock_records
ALTER TABLE clock_records ADD COLUMN match_score REAL;
ALTER TABLE clock_records ADD COLUMN match_status TEXT
  CHECK (match_status IN
    ('not_enforced','no_reference','match_strong','match_weak','match_fail','match_error')
    OR match_status IS NULL);

CREATE INDEX idx_clock_records_match_status ON clock_records(match_status)
  WHERE match_status IN ('match_weak','match_fail','no_reference','match_error');
```

### `app_settings` rows

| Key | Default | Type | Notes |
|---|---|---|---|
| `face_match_enforcement` | `'off'` | TEXT | `'off' \| 'flag' \| 'enforce'` |
| `face_match_low_threshold` | `0.55` | REAL | Below this → reject under enforcement |
| `face_match_high_threshold` | `0.85` | REAL | Above this → silent strong match |
| `face_enrollment_target_pct` | `80` | INT | Informational only |

### KV keyspace

| Key | Value | TTL |
|---|---|---|
| `face_match_attempts:{userId}:{YYYY-MM-DD}` | integer counter | 86400s (24h) |

### R2 layout (new prefixes under existing bucket)

| Prefix | Lifecycle |
|---|---|
| `face-references/pending/{userId}-{timestamp}.jpg` | Until approval/rejection |
| `face-references/active/{userId}.jpg` | Until next re-enrollment or user deactivation |
| `face-references/archive/{userId}-{timestamp}.jpg` | 30 days, then GC'd |
| `face-references/rejected/{userId}-{timestamp}.jpg` | 30 days, then GC'd |

### Routes

**Staff (authed, session):**
- `GET /api/face/me` → `{status, rejectedReason?, lastSubmittedAt?, cooldownUntil?}`
- `POST /api/face/enroll` body: `{photoBlob}`. Single-face sanity check, embedding computation, R2 put under `pending/`, D1 insert into `face_references_pending`. Errors: `409 ALREADY_PENDING`, `429 COOLDOWN`, `400 NO_FACE_DETECTED`, `400 MULTIPLE_FACES`.

**Admin (role-gated to `hr_admin`, `f_and_a_admin`, `superadmin`):**
- `GET /api/admin/face/queue` → array of pending submissions with signed R2 URLs (5min TTL) for the photo.
- `POST /api/admin/face/:userId/approve?force=true` — atomically: archive existing approved, move R2 photo from `pending/` to `active/`, insert into `face_references`, delete pending row.
- `POST /api/admin/face/:userId/reject` body: `{reason}`. Marks pending row rejected; cron later moves R2 photo to `rejected/` prefix and deletes pending row after 30d.
- `POST /api/admin/face/:userId/unlock` body: `{reason}`. Clears KV attempt counter, inserts `face_match_unlocks` row.

**Match step in existing `POST /api/clock`:**
- Slots between R2.put(photo) and D1.insert.
- Order: read `face_match_enforcement`; if `'off'` and no reference exists, set status `'not_enforced'` or `'no_reference'`, skip inference. Otherwise: SELECT reference, compute embedding via Workers AI, cosine similarity, decide status by threshold band. Increment attempt counter on `match_fail` under `'enforce'`. On 3rd failure, return `423 LOCKED` and notify HR.

### Workers AI model selection — first-task spike

Three options to evaluate, in priority order:

**Option 1: First-class face-embedding model on Workers AI (if it exists at build time).**
Check the catalog for face/biometric models. If a face-specific embedding model exists (e.g. an ArcFace or FaceNet variant), this is the cleanest path: cosine similarity is the natural metric, embeddings are reusable across calls, cost is per-inference (~$0.001).

**Option 2: Vision LLM in yes/no mode.**
Models like `@cf/meta/llama-3.2-11b-vision-instruct` or `@cf/llava-1.5-7b-hf`. Prompt:
> *"Two photos follow. Are they the same person? Reply with a JSON object: `{\"match\": true|false, \"confidence\": 0.00-1.00}`."*
Pros: works today. Cons: ~$0.005-0.01 per inference, no reusable embeddings (must run inference at every clock-in even if reference is unchanged), score is not a true cosine similarity (LLM confidence is its own beast — thresholds tune differently).

**Option 3: Custom embedding model via WebAssembly inside the Worker.**
Deploy a small ONNX face-embedding model (ArcFace or MobileFaceNet, ~5-50MB) via `onnxruntime-web` running in the Worker. Pros: $0 ongoing inference cost, deterministic. Cons: increases Worker bundle size (cold-start risk), 1-2 days of WASM integration work, ONNX model licensing must be checked.

**Spike protocol** (first task in the implementation plan):
1. Day 1: try option 1. Test on 5 enrolled staff: same-person score distribution, cross-person score distribution. Report.
2. If option 1 lacks face-specific models or fails the discrimination test (no clear gap between same-person and cross-person scores): try option 2 with the same 5-staff dataset.
3. If both fail or are too expensive: option 3.
4. Document the chosen path in this appendix and proceed.

Any of the three preserves the same external interface (`computeEmbedding(photoBlob) → vector`, `cosineSimilarity(a, b) → number`) — only the implementation in `face-match.ts` changes.

### File-by-file changes

| File | Change |
|---|---|
| `packages/api/src/db/schema.sql` | Append four new tables + `clock_records` columns |
| `packages/api/src/db/migrations/NNNN_face_match.sql` | Migration with all schema deltas + `app_settings` rows |
| `packages/api/src/routes/face.ts` | **New.** Staff routes |
| `packages/api/src/routes/admin-face.ts` | **New.** Admin routes |
| `packages/api/src/services/face-match.ts` | **New.** Embedding computation, similarity, serialization |
| `packages/api/src/services/face-match-config.ts` | **New.** Threshold + enforcement reads from `app_settings` |
| `packages/api/src/routes/clock.ts` | Insert match step between R2.put and D1.insert. Populate new columns. Handle lockout. |
| `packages/api/src/cron/face-references-gc.ts` | **New.** Daily archive/rejected cleanup. Wire into existing cron config. |
| `packages/staff/src/pages/EnrollFacePage.tsx` | **New.** Guided capture, status display, re-enrollment cooldown |
| `packages/staff/src/components/FaceMatchFailedModal.tsx` | **New.** Shown on hard reject |
| `packages/staff/src/lib/api.ts` | Add `getFaceStatus()`, `submitFaceEnrollment()` |
| `packages/admin/src/pages/FaceApprovalQueue.tsx` | **New.** Pending queue |
| `packages/admin/src/pages/AttendancePage.tsx` (or equivalent) | Add `match_score`, `match_status` columns + filter |
| `packages/admin/src/components/FaceUnlockButton.tsx` | **New.** Inline unlock from attendance row |

### Status taxonomy stored on `clock_records.match_status`

| Status | Meaning | Score column | Surfaced as |
|---|---|---|---|
| `not_enforced` | Enforcement is `'off'` globally | NULL | Hidden in default filter |
| `no_reference` | User has no approved reference | NULL | "⚠ unenrolled" |
| `match_strong` | Score ≥ HIGH_THRESHOLD | populated | Hidden by default |
| `match_weak` | LOW ≤ score < HIGH | populated | "⚠ low-confidence" |
| `match_fail` | score < LOW (only stored under `'off'` or `'flag'`) | populated | "✗ failed" |
| `match_error` | Workers AI failure | NULL | "⚠ inference failed" |

### Threshold tuning protocol

1. Ship with `LOW=0.55, HIGH=0.85`. Both tunable via `app_settings`, no deploy required.
2. Under `enforcement='off'`, log every clock-in's score for 14 days. Build per-user and global percentile distributions.
3. Compute: 99th percentile of intra-user scores (the "real staff" distribution) and 99th percentile of cross-user scores (the synthetic mismatch distribution, sampled by running each user's reference against a sample of others' clock-in selfies). The model is usable if there's a gap between these.
4. Set HIGH = 99p of cross-user scores + 0.05; set LOW = 1p of intra-user scores - 0.05.
5. If no gap exists, the chosen model is too weak — abort to spike option 2 or 3.

### Rollout sequence

| Step | Trigger | Duration |
|---|---|---|
| Backend deploy with `enforcement='off'` | After companion spec is in prod 2+ weeks | n/a |
| Enrollment screen + admin queue ship behind `face_enrollment_visible` flag | After 5-staff internal test | 2-3 days |
| Flag flipped on; staff begin enrolling; HR approves | When ready | 2 weeks min |
| Threshold tuning analysis run; thresholds adjusted | When ≥80% enrolled | 1-2 days |
| Enforcement flipped to `'flag'` | Thresholds confirmed | 7 days |
| Enforcement flipped to `'enforce'` | False-positive flag rate < 5% over flag-mode week | n/a |

**Kill-switch:** flipping `face_match_enforcement` back to `'flag'` or `'off'` takes effect on the next clock-in (no caching). Use this if the model misbehaves in production.

### Testing

**Unit (vitest):**
- `cosineSimilarity` correctness on canned vectors.
- `serializeEmbedding` / `deserializeEmbedding` roundtrip.
- Status decision matrix: every `(enforcement, hasReference, score)` triple → expected status + HTTP code.
- Threshold edges: score == HIGH → `match_strong`; score == LOW → `match_weak`.
- Retry counter: 1, 2, 3 failures → 401, 401, 423.

**Integration (Miniflare + in-memory D1, KV, R2):**
- Enrollment full cycle: submit → pending → approve → row in `face_references` + photo moved from `pending/` to `active/`.
- Rejection cycle: submit → reject → row marked rejected; photo NOT yet moved (cron handles deferred move).
- Re-enrollment cooldown enforced on approved users; not on rejected users.
- All 6 match-status transitions under each enforcement mode.
- HR unlock writes audit row, clears KV counter.
- GC cron: 31-day-old archive row + R2 object deleted; 29-day-old kept.

**Manual QA on device** (gate before flipping enforcement to `'enforce'`):
- iPhone enrollment in good light → admin approves → next clock-in: silent `match_strong`.
- Cover face partially with hand at clock-in → expect `match_weak`.
- Sunglasses at clock-in → likely `match_fail`. Verify behavior.
- **The canonical security test:** Two staff swap phones for clock-in. Each clock-in must hard-fail (or weak-flag) under enforcement.
- Network drop during enrollment submit: client retries cleanly, no orphaned R2 objects (transactional cleanup or explicit reconciliation cron).
- HR rejects an enrollment: staff can resubmit immediately.
- HR unlocks a locked-out user: user clocks in successfully on next attempt.

**Test environment:** dev/staging respects `DEV_BYPASS_FACE_MATCH=true` env flag that skips the inference step and stamps `match_status='not_enforced'`. Production rejects the flag at boot.

### Cost projection (revise after spike)

| Path | Per-inference cost | Monthly @ ~8,800 clock-ins | One-time eng |
|---|---|---|---|
| Workers AI face-embedding (option 1) | ~$0.001 | ~$9 | low |
| Vision LLM yes/no (option 2) | ~$0.005-0.010 | ~$44-88 | low-medium |
| WASM custom model (option 3) | $0 | $0 | 2-3 days |

R2 storage: 200 reference photos × 100KB = 20MB. Negligible.

### Reuse opportunities

- **VAPID push** is operational (project memory) — reuse for HR queue notifications and staff approval/rejection notifications.
- **R2 photo handling** for clock-in selfies is the template for reference photos.
- **`requireRole`** middleware already gates by role.
- **`app_settings` + `getAppSettings()`** is the established pattern for runtime-tunable flags and thresholds.
- **Existing admin attendance page** is the place to surface match results — no new admin section needed beyond the approval queue.

### Companion-spec dependency

This spec assumes the companion spec (`2026-04-29-clockin-reauth-and-liveness-design.md`) is in production. The match step relies on the photo on the clock-in row being a fresh, prompt-bound, biometrically-asserted selfie — without those guarantees, the match becomes the only line of defense and false-positive flags from the companion spec's prompt failure won't be discriminable from face-match failures during threshold tuning.

If the companion spec is delayed, this spec is delayed equivalently.

</details>
