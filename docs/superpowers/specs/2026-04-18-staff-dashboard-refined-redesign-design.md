# Staff Attendance Dashboard — Refined Redesign

**Date:** 2026-04-18
**Scope:** `packages/staff` only. Visual refresh of the staff clock-in dashboard (header + body + footer). No functional changes to clock-in, offline queue, push, absence notice, or first-login PIN flow.

## Goal

Elevate the daily staff dashboard from its current plain light-cream layout to a distinctive, refined interface that carries Ghanaian cultural identity and government-office gravitas — while staying quiet enough to be used every morning without fatigue. Distinctive, not noisy.

## Aesthetic Direction: Kente Executive — Refined

Three threads:

1. **Kente-inspired geometry** — thin diagonal stripes and warp/weft patterns as faint background texture (~3% opacity), picked out in the existing green/gold/red palette. Visual signature; never foreground.
2. **Art Deco structure** — strict vertical rhythm, gold hairline framing, Playfair Display serif for headings, disciplined negative space.
3. **Cinematic motion** — one orchestrated page-load cascade, hero logo with slow shimmer, clock buttons with magnetic hover + ripple press, streak pill with intensifying embers. All tasteful, never decorative.

## Section-by-Section Changes

### Header

**Current:** dark green gradient bar, Ghana flag stripe, 36px logo, title + subtitle, icon cluster on right.

**New:**
- Logo promoted from 36px → 52px. Wrapped in a concentric gold ring (2px stroke, opacity 60%) that rotates glacially (one revolution per 60s). A periodic gold shimmer sweep across the logo every 8 seconds (CSS `@keyframes` with ~2s duration, gentle opacity).
- Faint Kente pattern (SVG, 3% opacity) tiled across the full header width, behind everything else.
- Ghana flag stripe at top stays but gains a subtle glow shadow on hover.
- Title "Staff Attendance" unchanged in copy; subtitle "OHCS CLOCK SYSTEM" gains letter-spacing animation on header mount (0.2em → 0.25em over 600ms).
- Right cluster: Settings gear, PIN, Sign Out. Rework to icon-first with labels that slide in on hover (desktop) / always visible on mobile (tap targets stay ≥44px). Gold hairline underline slides in on hover.

### Greeting block

**Current:** two-line muted "Good Morning," + bold serif name.

**New:**
- "Good Morning" styled as gold small-caps with letter-spacing (tracking 0.15em).
- Officer's name: Playfair Display 28px (up from 24px), reveals letter-by-letter with a 30ms stagger on first paint (respects `prefers-reduced-motion`).
- Thin gold underline flourish beneath the name, drawn right-to-left in 400ms after reveal completes.

### Streak pill

**Current:** single flame icon + count.

**New:**
- Pill gains up to 5 flame embers based on streak (`min(5, streak)`). Embers fade in one at a time on initial render (120ms stagger).
- Longest-streak trophy: subtle gold glow on hover.
- Entire pill lifts 1px on hover with a short gold border flash.

### Today card

**Current:** white rounded card with border, "Today" header, date, IN/OUT blocks with times.

**New:**
- Card background becomes a faint Kente pattern underlay on a white-95% surface, with a 1px gold hairline border.
- Gold corner brackets (top-left, bottom-right) — thin decorative Deco-style frames, ~12px each.
- IN/OUT times: when they transition from `--:--` to a real time, the digits roll up with a 300ms spring (reuse `transition` + `will-change`; no external library).
- "Today" header gets a tiny animated dot (green pulse) to the left, indicating live refresh.

### Clock In / Clock Out buttons

**Current:** large green/red rounded buttons with LogIn/LogOut icon + bold text.

**New:**
- Keep the overall shape (20rem height, rounded-3xl). Remove the heavy drop shadow; replace with a subtle gold glow that pulses when the button is the only CTA.
- Inner structure gets a gold hairline border that animates in (draws clockwise from top-left) on button mount.
- Hover: magnetic effect — button translates 4px toward cursor (desktop only, via `onMouseMove` with transform). Background sheens a diagonal Kente-stripe gradient sweep.
- Press: scale `0.97` with a ripple emanating from the press point (CSS-only, no library).
- Icon: LogIn/LogOut rotates 15° on hover.

### Success screen (already styled nicely — tighten)

- Current check icon animation is fine; add a single gold confetti burst (10 small gold triangles from the check center, 800ms fade). Once per success, not on every re-render.

### Footer motto

**Current:** "Loyalty · Excellence · Service" in small gold caps.

**New:**
- Same text. Gain a slow left-to-right gold shimmer that fires once when the element scrolls/mounts into view.
- Dot separators animate in with a 200ms stagger.

### Body background

**Current:** `bg-background` (cream solid).

**New:**
- Keep the cream base.
- Add a very faint Kente SVG pattern, 3% opacity, tiled.
- Add a subtle mesh gradient (warm morning / cooler evening based on time of day) — a CSS `radial-gradient` with time-of-day-derived hue rotation. Changes across the day, not animated mid-session.

## Motion & Accessibility

- **Prefers-reduced-motion:** all animations wrap in `@media (prefers-reduced-motion: no-preference)`. When reduced, transitions become instant; static visual treatment stays (Kente pattern, gold frames, layout — all unaffected).
- **Touch targets:** all interactive elements stay ≥44px.
- **Contrast:** all text stays at AA contrast minimum. The Kente pattern at 3% opacity doesn't affect legibility.
- **No new dependencies:** all motion done in CSS + minimal React state (no Framer Motion / Motion / GSAP pulled in — keeps bundle lean).

## Technical Approach

- **New shared CSS file:** `packages/staff/src/styles/dashboard.css` — contains the keyframes (`shimmer`, `revolve`, `ripple`, `reveal-letter`, `draw-border`), pattern SVG data-URI, and utility classes.
- **Inline SVG Kente pattern** as a reusable component `packages/staff/src/components/KentePattern.tsx` that renders an absolutely-positioned `<svg>` overlay. Tunable opacity via prop.
- **Page-load cascade** is orchestrated in `ClockPage` via CSS `animation-delay` on each child. No JS orchestration — zero runtime cost.
- **Logo ring** is a second wrapper around the existing `<img>` with a `@keyframes revolve` animation (`infinite 60s linear`).
- **Letter-reveal for officer name:** split on spaces + letters, render each letter as a `<span>` with `animation-delay: calc(var(--i) * 30ms)`.
- **Magnetic hover on buttons:** 8 lines of React — `onMouseMove` sets `transform: translate3d()` based on cursor-relative position; clamp to ±6px; reset on `onMouseLeave`.
- **Ripple press:** add a span to the button on pointerdown at the click position, fade out via CSS in 500ms, then remove.

## Files Touched

- Create: `packages/staff/src/styles/dashboard.css` (keyframes + pattern).
- Create: `packages/staff/src/components/KentePattern.tsx` (reusable SVG overlay).
- Create: `packages/staff/src/components/LetterReveal.tsx` (name reveal helper).
- Create: `packages/staff/src/components/MagneticButton.tsx` (wraps the clock-in/out buttons).
- Modify: `packages/staff/src/pages/ClockPage.tsx` — restyle header + greeting + streak + today card + buttons + footer. No behavioural changes.
- Modify: `packages/staff/src/hooks/usePinChange.tsx` — nothing (keep as-is).
- Modify: `packages/staff/src/main.tsx` — import `styles/dashboard.css` if not imported via ClockPage.
- Modify: `packages/staff/src/tokens.css` — add any new CSS variables (e.g., `--gold-glow`, `--kente-pattern`).

## What's Explicitly NOT Changing

- Visitor management (`packages/web`) — untouched. This is staff-only.
- Clock-in flow, phase machine, mutation logic.
- Offline queue behaviour, service worker.
- Absence notice button component (keeps its current refined styling, now harmonises with the rest).
- Settings menu dropdown contents (Install + Push toggle).
- First-login PIN prompt overlay styling.
- The OHCS logo image itself (we restyle PRESENTATION; we do not regenerate the logo).

## Out of Scope

- Dark mode toggle (keep system-preference if already wired; do not add if not).
- Kente pattern customisation per directorate.
- Animated transitions between phases (idle → locating → photo → submitting → success). Existing Tailwind transitions stay.
- Sound effects.
- Haptics.

## Acceptance Criteria

1. Opening the staff app loads with a clear visual hierarchy cascade within ~700ms. No component shows flicker or layout shift.
2. Header logo rotates its gold ring visibly but slowly; shimmer passes every ~8s.
3. Officer name reveals letter-by-letter on first load; reverts to instant display on `prefers-reduced-motion: reduce`.
4. Clock-in/out buttons respond to hover (magnetic) and press (ripple) on pointer devices; stay tappable on touch.
5. Kente pattern visible on close inspection, invisible at normal viewing distance.
6. All existing functional tests still pass — this is a visual refresh, zero functional regressions.
7. No new runtime dependencies added.
8. Lighthouse accessibility score for the dashboard stays ≥ 90.

## Open Questions

None.
