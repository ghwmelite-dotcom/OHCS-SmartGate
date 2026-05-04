# OHCS Clock-In — Passive Liveness (Plan 1.5) — Design Proposal

**Status:** Draft for review
**Author:** Engineering
**Date:** 2026-05-04
**Audience:** OHCS leadership / engineering
**Supersedes (UX):** the visible-number prompt from `2026-04-29-clockin-reauth-and-liveness-design.md`
**Builds on:** the re-auth + prompt mechanism from the same prior spec (kept; only the visible-number UX is replaced)
**Foundation for:** `2026-04-29-clockin-face-match-design.md` (Plan 2)

---

## Executive summary

The shipped clock-in flow asks each staff member to "show this 2-digit number to the camera" before submitting their selfie. It's secure — the prompt is single-use, server-issued, and 90s-expiring — but it reads as a CAPTCHA, not as a modern HR app. Staff hold up their phone screen, paper, or fingers to show a number. It works, but it doesn't *feel* like Wise, Revolut, or Monzo.

This spec replaces the visible-number UX with **passive liveness + a single quiet challenge** — the standard pattern modern banking apps use. Staff open the camera, the face-centering ring goes green, a subtle one-shot hint asks them to *blink slowly* / *turn slightly left* / *smile briefly*, and the capture happens silently. The whole sequence takes ~3 seconds and contains zero numbers, no CAPTCHA-ish framing, and no on-screen "Verifying your identity 🔒" theatre.

The cryptographic anchor (server-issued `prompt_id` UUID binding the WebAuthn challenge) is preserved unchanged. The visible `prompt_value` digit pair — the gimmicky bit — is the only thing that goes away.

The design is hybrid: client-side MediaPipe drives the snappy framing UX, but the **trust decision is server-side** (Workers AI face-detection over a 3-frame burst, motion delta vs. the server-issued challenge action). An attacker can't bypass liveness by patching the JS.

The work also lays the foundation for Plan 2 face-match — same canonical frame, same MediaPipe client component, same manual-review queue.

---

## What the staff member sees

1. Tap **Clock In** as today.
2. Location resolves; geofence pre-check passes.
3. Camera opens full-bleed with a centered circular cutout (~280px on mobile). Outside the cutout is dimmed.
4. A subtle scanning ring around the cutout pulses slowly:
   - **Grey** — looking for a face
   - **Amber** — face detected but off-centre / poorly lit / too far
   - **Green** — framed correctly; hold steady for the challenge
5. One quiet hint line below the cutout: *"Hold steady"* → then, as soon as framing is green, *"Blink slowly"* OR *"Turn slightly left"* OR *"Smile briefly"* (the action is randomised server-side and tied cryptographically to this clock-in).
6. A faint animated guide overlays the cutout in time with the hint:
   - **Blink** — two small eyelid dots near the user's eye landmarks blink once
   - **Turn left/right** — a thin arc-arrow drifts in the target direction
   - **Smile** — a faint smile-curve graphic appears under the mouth
7. As the user completes the action, the ring snaps to green-solid for 250ms — confirmation flash.
8. Without further interaction, the device asks for **Face ID / fingerprint** (or PIN if biometric isn't set up) — same re-auth flow as today.
9. On success, clock-in is recorded.

End-to-end target: **~3 seconds** for a staff member who's done it once. No countdown timer, no numbers, no "tap to capture" button. The capture is silent and automatic.

If something goes wrong (poor lighting, wrong direction, no motion), the ring stays amber and the hint nudges: *"Move into better light"* / *"Bring face closer"* / *"Let's try once more — blink slowly"*. After two failed attempts, a subtle action surfaces: *"Having trouble? Submit for HR review →"*.

---

## What HR / admin gets

The existing attendance review page gains:

- **Liveness column** — `pass`, `fail`, `manual_review`, or `skipped`. Yellow flag on `manual_review` rows.
- **Evidence card** on row expand — renders the `liveness_signature`: which challenge was issued, motion delta observed, face confidence, decision, model version. ~5 lines of plain text.
- **Manual-review queue badge** — same screen, just filtered by `liveness_decision='manual_review'`. HR confirms or rejects each row in their normal review cycle.

The existing **Prompt** column (which today shows the 2-digit number) is replaced by the **Liveness column**. No new admin pages. No new dashboards beyond the metrics widget described in the rollout section.

---

## How it stays secure (in plain English)

| Risk | How we handle it |
|---|---|
| Staff member hands unlocked phone to a colleague | Colleague's face won't satisfy a randomised, server-issued challenge in real time. WebAuthn / PIN is the second gate. |
| Replay a previous successful clock-in (a stored video of the staff member blinking) | Today's challenge is randomised from a pool of 4 actions; the recorded video probably shows the wrong action. Even if it shows the right one, the recording is bound to a *previous* `prompt_id` UUID and won't satisfy today's WebAuthn challenge. |
| Show a still photo to the camera | Server's motion-delta check across the 3-frame burst won't detect any motion. Liveness fails. |
| Show a phone screen playing a video to the camera | Same as replay above; additionally, server-side `screen_artifact_score` (when available) flags it. |
| Patch the client JS to fake "passed" liveness | Server doesn't trust client output. The frames themselves are re-evaluated server-side. Faking "passed" client-side has no effect. |
| Camera permission denied or MediaPipe won't load | Client falls back to "blind capture" (3 frames over 2s with no client guidance). Server still verifies. If the user genuinely can't pass, the manual-review escape valve is rate-limited (default 2 per staff per ISO calendar week, UTC). |
| Demographic skew on detection (challenge fails more for certain skin tones / glasses) | Per-challenge pass-rate metric tracked daily during shadow mode. Enforce-mode is gated on parity — won't flip until per-challenge rates are within ±2% across the staff population. |
| Workers AI is down | `services/liveness.ts` returns `decision='skipped'` with `error='model_unavailable'`. In enforce mode, the clock-in is auto-routed to manual-review **without** consuming the user's weekly cap (model error ≠ user fault). |

---

## Architecture

### Client (`packages/staff/`)

New module: `src/lib/liveness/` — lazy-loaded the moment the user taps "Clock In", warmed during the existing geofence pre-check so the WASM is ready by camera-open.

- `LivenessCapture.tsx` — camera + ring + challenge UI. Replaces the inline `getUserMedia` block currently inside `ClockPage.tsx`. Owns the `<video>` element, the canvas, and the challenge animation overlay.
- `mediapipeRunner.ts` — wraps MediaPipe FaceLandmarker. Pure UX-feedback role. Exposes `start()`, `onFrame(landmarks => ...)`, `stop()`. Its decision is never trusted by the server.
- `challengeDetector.ts` — pure functions over landmark streams: `detectBlink(frames)`, `detectHeadTurn(frames, direction)`, `detectSmile(frames)`. Drives the green-flash confirmation only.
- `frameBurstEncoder.ts` — captures 3 frames at challenge start / mid / end, JPEG-encodes each at 480×480, returns a single multipart payload (~150 KB total).

### Worker API (`packages/api/`)

- `POST /api/clock/prompt` — extended. Issues `challenge_action` (one of `blink | turn_left | turn_right | smile`) alongside the existing `prompt_id`. Returned to client; stored in the same KV record (`clock-prompt:{promptId}`) bound to the user. The visible-number `prompt_value` field is **dropped** from the response, the KV record, and the database row.
- `POST /api/clock` — extended. Accepts a `liveness_burst` field (3 frames + `challenge_action_completed` claim). The existing single `photo` field is retired; the canonical photo is now picked server-side as the sharpest frame from the burst.
- `services/liveness.ts` — new module:
  - `verifyLivenessBurst(frames, expectedChallenge, userId, promptId) → { pass: boolean, signature: LivenessSignature }`
  - Calls Workers AI `@cf/insightface/buffalo_s` on each frame → 5-keypoint landmarks (eyes / nose / mouth corners) + face confidence.
  - Computes motion deltas across frames (eye-openness Δ for blink; eye-nose horizontal Δ for head turn; mouth-corner Δ for smile).
  - Compares delta direction + magnitude against `expectedChallenge` thresholds.
  - `screen_artifact_score`: included in the signature schema as nullable; populated only if a suitable Workers AI classifier is available at build-time. If not, logged as `null` and revisited via shadow telemetry.
  - Picks the sharpest frame (Laplacian-variance proxy) → returns it as the canonical photo for R2 storage.
  - Builds `LivenessSignature` (~200 bytes) — see schema below.

### Trust boundary

- Client MediaPipe output is **never** sent to the server.
- Server **only** trusts: the raw frames it received + the `prompt_id` it issued + the `challenge_action` it bound to that prompt.
- An attacker who patches the client JS to fake "passed" can bypass the green flash, but can't make the server accept frames that don't contain real motion matching the server-issued challenge.

**Asymmetric model choice — intentional:** the client uses MediaPipe FaceLandmarker (~478 landmarks, sub-millisecond per-frame on-device) because it needs rich, high-frequency landmarks to drive the *interactive* UX feedback — the green-flash confirmation has to fire the moment the user blinks. The server uses Workers AI `insightface buffalo_s` (5 keypoints) because it only needs enough to detect motion direction across 3 frames, and 5 keypoints is the right cost/latency point for a per-clock-in inference. The two layers do different jobs; identical models would over-spend on the server side.

### Reuse for Plan 2 (face-match)

- `verifyLivenessBurst` returns the canonical frame; Plan 2's `services/face-match.ts` consumes that same frame to embed against the enrolled reference. A single pass through Workers AI amortises both calls.
- The MediaPipe client component becomes the foundation for Plan 2's enrolment screen — same ring, same framing logic, different prompt copy.

### Module boundaries

- `services/liveness.ts` knows nothing about WebAuthn, PIN, geofence, or D1. Takes frames + a challenge spec, returns a decision + a signature. Easy to unit-test against fixture frames.
- `routes/clock.ts` orchestrates: prompt → liveness → re-auth → geofence → insert. Each gate is one call to its own service.

---

## Data model & schema changes

### D1 — `clock_records` table

Drop one column, add three:

| Action | Column | Type | Notes |
|---|---|---|---|
| Drop | `prompt_value` | TEXT | The visible 2-digit number — gone with the visible-prompt UI |
| Add | `liveness_challenge` | TEXT | One of `blink \| turn_left \| turn_right \| smile`. Null on `manual_review` or `skipped` rows where no challenge was completed |
| Add | `liveness_decision` | TEXT | `pass \| fail \| manual_review \| skipped` |
| Add | `liveness_signature` | TEXT (JSON) | Compact signature from `verifyLivenessBurst` — ~200 bytes |

`reauth_method` (`webauthn` / `pin`) is unchanged — orthogonal to liveness.

**Migration safety — two-phase to avoid breaking historical-row review:**
- Phase 1 (this work, soft rollout): add the three new columns, keep `prompt_value` nullable, stop writing to it.
- Phase 2 (≥30 days later, when historical data is past its review horizon): drop `prompt_value` in a follow-up migration. Don't bundle the drop with the feature ship.

### D1 — `app_settings` table

Add three flags (mirrors the existing `clockin_reauth_enforce` pattern):

- `clockin_passive_liveness_enforce` (number, default `0`) — `0` = shadow mode (capture + log + accept all), `1` = enforce (reject on liveness fail unless manual-review path taken).
- `clockin_liveness_review_cap_per_week` (number, default `2`) — rate-limit on the manual-review escape valve.
- `clockin_liveness_model_version` (text, default `'buffalo_s_v1'`) — pinned model version, surfaced into `liveness_signature.model_version`. Lets HR forensics tie a decision to a specific model build.

The existing `app-settings:v2` KV cache key is invalidated on settings write — no extra plumbing needed.

### KV — `clock-prompt:{promptId}`

Existing record gains one field, drops one:

```
{ user_id, expires_at, challenge_action }
```

The `prompt_value` field is removed. Same 90s TTL.

### KV — new `clock-liveness-review:{userId}:{isoWeek}`

Counter for the rate-limited HR review escape valve. Increments on each `manual_review` submission. Compared against `clockin_liveness_review_cap_per_week`. 8-day TTL (so the previous week's counter survives long enough to span the boundary cleanly). Same shape as the existing `clock-pin-attempts:{userId}:{isoDate}` counter.

The cap is enforced per **ISO 8601 calendar week (UTC)** — Monday-to-Sunday in UTC. Not a trailing-7-days rolling window. Choosing calendar-week keeps the KV key deterministic and means the cap resets at a predictable boundary that staff can understand ("you have 2 manual-reviews left this week").

### R2 — clock-in selfie storage

No schema change. Same path / naming convention as today. Server picks the sharpest frame from the 3-frame burst and writes it once. The other two frames are evaluated, then **discarded server-side after the decision** — they never touch R2, KV, or D1.

### `liveness_signature` JSON shape (frozen contract)

```json
{
  "v": 1,
  "challenge_action": "blink",
  "challenge_completed": true,
  "motion_delta": 0.82,
  "face_score": 0.94,
  "sharpness": 142.3,
  "decision": "pass",
  "model_version": "buffalo_s_v1",
  "screen_artifact_score": null,
  "ms_total": 1840
}
```

Versioned on `v` so future model changes can change the shape without breaking old-row parsing in HR review.

---

## Settings & rollout

Phased ship — same playbook used for `clockin_reauth_enforce`.

### Phase 0 — Build (week 1)

- Land all client + server code behind `clockin_passive_liveness_enforce=0` (shadow mode).
- Migration adds the three new `clock_records` columns; `prompt_value` stays nullable but is no longer written.
- The visible-number prompt UI is **deleted from the client** in this same release — no dual UI path. The server still issues a `prompt_id` (anchor for WebAuthn challenge) but no longer issues or stores `prompt_value`.
- Server runs `verifyLivenessBurst` on every clock-in, writes the full `liveness_signature`, but **always accepts** the clock-in regardless of decision (shadow mode = log only).

### Phase 1 — Shadow telemetry (week 2)

Admin attendance page gains a metrics widget:

- **Liveness pass rate** — target ≥97%.
- **Per-challenge pass rate** — broken out for `blink`, `turn_left`, `turn_right`, `smile`. Catches a broken detector or demographic skew early.
- **Median `ms_total`** — target <2500ms. Anything slower means upload or Workers AI is too slow.
- **Manual-review request rate** — target <2% of clock-ins.
- **Model error rate** — Workers AI failures. Target <0.5%.

Daily review for 7 days. If any metric drifts, fix in shadow before enforcement — no user-visible failures during tuning.

### Phase 2 — Enforce (week 3)

- Flip `clockin_passive_liveness_enforce=1` via the admin settings UI (no deploy needed — KV cache invalidates on write).
- Manual-review queue goes live. HR sees `liveness_decision='manual_review'` rows in the existing attendance review screen with a yellow flag and the `liveness_signature` rendered as the evidence card.
- Rate-limit (`clockin_liveness_review_cap_per_week=2`) is active from the moment enforcement flips.

### Phase 3 — Plan 2 face-match starts (week 4+)

Builds on the now-stable liveness pipeline. Reuses the canonical frame, the MediaPipe client component (for enrolment), and the manual-review queue (for `face_match_low_confidence` flag).

### Kill-switch

- Single setting flip: `clockin_passive_liveness_enforce=0` reverts to shadow mode. Server still captures the signature (no telemetry loss), just stops rejecting. Same kill-switch ergonomics as the original re-auth ship.
- Worst-case (Workers AI down): `services/liveness.ts` catches the model error, returns `decision='skipped'` + `error='model_unavailable'`. In enforce mode, the clock-in is auto-routed to manual-review **without** consuming the user's weekly cap (model error ≠ user fault).

### Gates between phases

- Phase 0 → 1: deploy succeeds, no error spike in production logs over 24h.
- Phase 1 → 2: pass-rate target hit, no demographic skew in per-challenge rates (within ±2% across staff population), manual-review request rate below threshold.
- Phase 2 → 3 (Plan 2): liveness enforce-mode stable for 2 full weeks, sufficient canonical frames in R2 for face-match threshold tuning.

### Communication

- One Slack/email to staff at Phase 2 cutover: *"Clock-in now uses a quick face check — just look at the camera and follow the on-screen hint. Takes 2 seconds. No more entering numbers."* — that's the entire change-management message.
- HR briefing covers the new manual-review flag and how to read the signature evidence card.

---

## Edge cases

| Scenario | Behaviour |
|---|---|
| Camera permission denied | Liveness fails open in shadow; in enforce mode, offers manual-review path (counts against weekly cap) |
| MediaPipe WASM fails to load (low memory, blocked CDN) | Client falls back to "blind capture" — 3 frames at 0/1/2s with no client-side guidance. Server still verifies. UX shows a generic *"Hold still and follow the hint"* without the green flash |
| User wears glasses with reflection glare | Server's `face_score` will dip; if it crosses the threshold, fail → retry; if not, manual-review path |
| Dark-skinned faces under poor lighting | Tracked as a per-challenge pass-rate metric in shadow telemetry. If `smile` or `blink` fail rates skew demographically, the challenge pool is restricted to the well-performing actions before enforce-mode flips |
| User completes the wrong challenge ("turned right" instead of "left") | Detected as motion-direction mismatch → fail → one retry with the *same* challenge (server doesn't reissue a new one — prevents a "shop until you find an easy challenge" attack) |
| User clocks in twice within the prompt's 90s TTL | Existing single-use enforcement on `clock-prompt:{promptId}` covers it — KV record is deleted on first successful submit |
| Workers AI cold-start lag | First clock-in of the day may take 4-5s instead of 2s. Acceptable for shadow; if metric drifts in enforce mode, add a Workers AI warm-up cron |
| Network drops mid-upload | PWA's existing offline retry queue picks it up. The liveness burst is part of the same multipart submit — same retry semantics as the existing photo |
| Time-zone / DST around the review counter | ISO 8601 calendar week (UTC, Monday-to-Sunday) for the KV key. Resets at a predictable boundary; documented in the signature for HR auditability |

---

## Testing strategy

- **Unit tests** (`services/liveness.test.ts`) — pure-function tests over fixture frame sets. Synthetic landmark sequences for each challenge, edge cases (no motion, opposite motion, marginal motion). Gold-standard frames committed under `packages/api/test/fixtures/liveness/`.
- **Integration tests** (`routes/clock.integration.test.ts`) — full request lifecycle with a stubbed Workers AI binding. Challenge issued → frames submitted → decision recorded → row inserted with correct `liveness_decision` and signature.
- **Client component tests** (`LivenessCapture.test.tsx`) — camera-stream mock, MediaPipe mock. Asserts ring state transitions and challenge-detection wiring.
- **Smoke tests** (manual, pre-Phase-2 cutover) — on a real device, run all four challenges 5× each across two staff (one with glasses, one without) to confirm thresholds before flipping enforce.
- **Load test** (Worker) — 50 concurrent clock-ins to confirm Workers AI tail latency stays under SLA.

---

## Out of scope

- **Deepfake / advanced anti-spoofing.** Threat model is buddy-clocking, not state actors. 3D-mask defeat, GAN-generated faces, etc., are not addressed. Revisit only if telemetry shows abuse.
- **Client-side liveness offline-mode.** Design is server-authoritative; offline clock-ins continue using the existing PWA queue + soft-rollout pattern, syncing on reconnect.
- **Per-staff challenge personalisation.** No "lower the threshold for staff who always blink slowly". Adds attack surface and operational complexity for marginal benefit.
- **Liveness for the VMS visitor flow.** Different threat model, different UX, different domain — own spec when it comes up.
- **Replacing WebAuthn or PIN re-auth.** This work is purely additive — re-auth chain is unchanged.
- **Plan 2 face-match itself.** This spec is the foundation Plan 2 builds on; Plan 2 has its own existing spec at `docs/superpowers/specs/2026-04-29-clockin-face-match-design.md`.

---

## Risks worth flagging

- **Workers AI cost.** One `buffalo_s` inference × 3 frames × every clock-in. Estimate: ~0.0003 USD per clock-in × ~1000 clock-ins/day = ~$9/month. Trivial, but worth verifying once Phase 1 ships.
- **MediaPipe WASM bundle size on slow networks.** Lazy-loaded + cached aggressively (1-year `Cache-Control` on the WASM blob). First clock-in of the day could be ~2 MB heavier. Mitigation: warm the cache during the existing geofence pre-check.
- **Demographic skew on challenge detection.** Tracked as a Phase-1 gate — won't flip enforce until per-challenge pass rates are within ±2% across staff.
- **Photo quality regression.** The visible-number prompt forced staff to hold the phone at a useful distance. Without it, framing varies more. The face-centring ring + `sharpness` metric replace this, but watch the `face_score` distribution in shadow.
- **Workers AI model-availability for `screen_artifact_score`.** If no suitable classifier exists at build-time, the field stays `null`. Re-evaluate post-Phase-1 — anti-replay against video-on-screen is partially covered by motion-delta + randomised challenge, but a screen-detection signal is the ideal complement.

---

## Scope of work

One spec, three sequential changes — shippable as one release plus rollout window:

**1. Worker (API) — ~3 days**
- Extend `POST /api/clock/prompt` with `challenge_action`; remove `prompt_value`.
- Extend `POST /api/clock` to accept `liveness_burst` and call `verifyLivenessBurst`.
- New `services/liveness.ts` (Workers AI integration, motion deltas, signature builder, sharpest-frame selection).
- Migration: add three `clock_records` columns + three `app_settings` keys.

**2. Staff PWA — ~4 days**
- New `src/lib/liveness/` module (`LivenessCapture`, `mediapipeRunner`, `challengeDetector`, `frameBurstEncoder`).
- Replace the visible-number prompt UI in `ClockPage.tsx` with `<LivenessCapture />`.
- Manual-review escape valve UI (subtle action after 2 failed retries).
- Lazy-load MediaPipe WASM during geofence pre-check.

**3. Admin portal — ~1 day**
- Replace **Prompt** column with **Liveness** column on the attendance review page.
- Evidence card on row expand.
- Metrics widget for shadow-mode telemetry.

**Plus rollout (~2 weeks observation window)**: ship Worker + PWA in shadow mode (records decision, accepts all clock-ins). Wait until pass-rate, latency, and demographic-parity metrics are within target. Then flip `clockin_passive_liveness_enforce=1` to enforce.

Total engineering: ~8 days of build + ~2 weeks of telemetry-gated rollout. Plan 2 (face-match) starts on top of this once enforce-mode is stable.
