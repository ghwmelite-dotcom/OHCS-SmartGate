# Staff Dashboard Refined Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Kente Executive refined visual refresh of the staff ClockPage — Kente pattern signature, rotating logo ring, letter-reveal greeting, magnetic/ripple clock buttons, footer shimmer, success confetti burst — without touching any functional behaviour.

**Architecture:** Extend the existing `tokens.css` with new keyframes and utility classes (the file already has Kente + shimmer primitives to build on). Add two small React components — `LetterReveal` for the name cascade and `MagneticButton` for the hover effect. Restyle `ClockPage.tsx` in place. Zero new runtime dependencies.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 4 (via `@theme`). Playfair Display + DM Sans already loaded in `index.html`. All motion via CSS keyframes + small transform calculations; no Framer Motion / Motion / GSAP.

---

## File Structure

**New files:**
- `packages/staff/src/components/LetterReveal.tsx` — renders text with per-letter staggered entrance animation.
- `packages/staff/src/components/MagneticButton.tsx` — button wrapper with cursor-following transform and ripple on press.
- `packages/staff/src/components/ConfettiBurst.tsx` — one-shot SVG triangle burst on clock-in success.

**Modified files:**
- `packages/staff/src/tokens.css` — append keyframes (`revolve`, `ring-rotate`, `draw-border`, `ripple`, `ember-fade`, `shimmer-sweep`, `confetti-burst`), utility classes (`.logo-ring`, `.magnetic`, `.gold-frame`, `.shimmer-sweep`), and SVG Kente background data-URI (richer than current diagonal stripes).
- `packages/staff/src/pages/ClockPage.tsx` — restyle header, greeting, streak pill, today card, clock buttons, success screen, footer. No behavioural changes.

**Files NOT touched:**
- `packages/staff/src/components/AbsenceNoticeButton.tsx` — already on-palette.
- `packages/staff/src/components/SettingsMenu.tsx` — drop-down inner content unchanged (only the trigger icon colour harmonises via inherited CSS vars).
- `packages/staff/src/components/FirstLoginPinPrompt.tsx` — sits above this design, no changes.
- `packages/staff/src/components/OfflineBanner.tsx` — already serviceable.
- `packages/staff/public/sw.js`, `main.tsx`, `App.tsx`, `stores/*`, `hooks/*`, `lib/*` — zero changes.

---

## Task 1: Extend `tokens.css` with Kente Executive primitives

**Files:**
- Modify: `packages/staff/src/tokens.css` (append to end; preserve existing content)

- [ ] **Step 1: Append the new keyframes and utility classes**

At the end of `packages/staff/src/tokens.css`, append:

```css
/* ========== Kente Executive refined visual primitives ========== */

/* Richer Kente weave — diagonal warp + weft, tunable opacity via --kente-opacity */
.kente-weave {
  --kente-opacity: 0.03;
  background-image:
    repeating-linear-gradient(
      45deg,
      rgba(212, 160, 23, var(--kente-opacity)) 0px,
      rgba(212, 160, 23, var(--kente-opacity)) 1px,
      transparent 1px,
      transparent 14px
    ),
    repeating-linear-gradient(
      -45deg,
      rgba(26, 77, 46, var(--kente-opacity)) 0px,
      rgba(26, 77, 46, var(--kente-opacity)) 1px,
      transparent 1px,
      transparent 14px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(206, 17, 38, calc(var(--kente-opacity) * 0.5)) 0px,
      rgba(206, 17, 38, calc(var(--kente-opacity) * 0.5)) 1px,
      transparent 1px,
      transparent 42px
    );
}

/* Logo ring — rotating gold frame around the OHCS emblem */
.logo-ring {
  position: relative;
  border-radius: 9999px;
}
.logo-ring::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 9999px;
  border: 1.5px solid rgba(212, 160, 23, 0.5);
  border-top-color: rgba(245, 215, 110, 0.95);
  animation: ring-rotate 60s linear infinite;
  pointer-events: none;
}
@keyframes ring-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Shimmer sweep — a gold highlight sliding across a surface every 8s */
.shimmer-sweep {
  position: relative;
  overflow: hidden;
}
.shimmer-sweep::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    115deg,
    transparent 40%,
    rgba(245, 215, 110, 0.35) 50%,
    transparent 60%
  );
  transform: translateX(-120%);
  animation: shimmer-sweep 8s ease-in-out infinite;
  pointer-events: none;
}
@keyframes shimmer-sweep {
  0%, 80% { transform: translateX(-120%); }
  90%, 100% { transform: translateX(120%); }
}

/* Decorative gold corner frames for cards */
.gold-frame {
  position: relative;
}
.gold-frame::before,
.gold-frame::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border: 1.5px solid rgba(212, 160, 23, 0.7);
  pointer-events: none;
}
.gold-frame::before {
  top: -1px;
  left: -1px;
  border-right: none;
  border-bottom: none;
  border-top-left-radius: inherit;
}
.gold-frame::after {
  bottom: -1px;
  right: -1px;
  border-left: none;
  border-top: none;
  border-bottom-right-radius: inherit;
}

/* Letter-reveal entrance — one letter fades in at a time via --i inline var */
@keyframes letter-reveal {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
.letter-reveal {
  display: inline-block;
  opacity: 0;
  animation: letter-reveal 0.45s ease-out forwards;
  animation-delay: calc(var(--i, 0) * 30ms);
}

/* Draw-border — thin gold border that draws in on mount */
@keyframes draw-border {
  from { clip-path: inset(0 100% 0 0); }
  to   { clip-path: inset(0 0 0 0); }
}

/* Ripple — click feedback on magnetic buttons */
@keyframes ripple {
  from { transform: scale(0); opacity: 0.55; }
  to   { transform: scale(3.5); opacity: 0; }
}
.ripple-dot {
  position: absolute;
  width: 24px;
  height: 24px;
  margin: -12px 0 0 -12px;
  border-radius: 9999px;
  background: rgba(245, 215, 110, 0.6);
  pointer-events: none;
  animation: ripple 600ms ease-out forwards;
}

/* Ember fade — for the streak flames appearing one at a time */
@keyframes ember-fade {
  from { opacity: 0; transform: translateY(4px) scale(0.6); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.ember {
  display: inline-block;
  opacity: 0;
  animation: ember-fade 0.4s ease-out forwards;
  animation-delay: calc(var(--i, 0) * 120ms);
}

/* Confetti triangle — small gold triangle that falls + rotates */
@keyframes confetti-burst {
  0%   { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
  100% { opacity: 0; transform: translate(var(--dx, 60px), var(--dy, 60px)) rotate(var(--r, 180deg)) scale(0.5); }
}
.confetti-triangle {
  position: absolute;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 8px solid #D4A017;
  animation: confetti-burst 800ms ease-out forwards;
  pointer-events: none;
}

/* Underline flourish — gold hairline that grows right-to-left */
@keyframes underline-draw {
  from { transform: scaleX(0); transform-origin: right; }
  to   { transform: scaleX(1); transform-origin: right; }
}
.underline-flourish {
  display: block;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(212, 160, 23, 0.9), transparent);
  transform: scaleX(0);
  animation: underline-draw 0.5s ease-out 0.4s forwards;
}

/* Magnetic button — smooth transform transition only */
.magnetic {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
}

/* Respect reduced motion — flatten every animation we added */
@media (prefers-reduced-motion: reduce) {
  .logo-ring::before,
  .shimmer-sweep::after,
  .letter-reveal,
  .ember,
  .ripple-dot,
  .confetti-triangle,
  .underline-flourish {
    animation: none !important;
  }
  .letter-reveal,
  .ember,
  .underline-flourish {
    opacity: 1 !important;
    transform: none !important;
  }
  .magnetic {
    transition: none !important;
  }
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/tokens.css
git commit -m "feat(staff): add Kente Executive visual primitives to tokens.css"
```

---

## Task 2: `LetterReveal` component

**Files:**
- Create: `packages/staff/src/components/LetterReveal.tsx`

- [ ] **Step 1: Write the component**

Create `packages/staff/src/components/LetterReveal.tsx` with exactly:

```tsx
import { useMemo } from 'react';

interface Props {
  text: string;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'span' | 'p';
  delayOffsetMs?: number;
}

/**
 * Renders each character as a span with a staggered entrance animation.
 * Spaces are preserved as non-animated whitespace (no visible flicker).
 */
export function LetterReveal({ text, className, as: Tag = 'span', delayOffsetMs = 0 }: Props) {
  const parts = useMemo(() => {
    return Array.from(text).map((ch, i) => ({ ch, i }));
  }, [text]);
  const baseOffset = Math.max(0, Math.round(delayOffsetMs / 30));
  return (
    <Tag className={className}>
      {parts.map(({ ch, i }) =>
        ch === ' ' ? (
          <span key={i}>&nbsp;</span>
        ) : (
          <span key={i} className="letter-reveal" style={{ ['--i' as unknown as string]: i + baseOffset }}>
            {ch}
          </span>
        ),
      )}
    </Tag>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/LetterReveal.tsx
git commit -m "feat(staff): add LetterReveal component for staggered text entrance"
```

---

## Task 3: `MagneticButton` component

**Files:**
- Create: `packages/staff/src/components/MagneticButton.tsx`

- [ ] **Step 1: Write the component**

Create `packages/staff/src/components/MagneticButton.tsx` with exactly:

```tsx
import { useRef } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

interface Props extends ButtonProps {
  children: React.ReactNode;
}

/**
 * Button with magnetic-cursor hover (desktop only, no-op on touch) and
 * ripple feedback on press. All CSS-driven — the animation uses the
 * `.magnetic` and `.ripple-dot` classes defined in tokens.css.
 */
export function MagneticButton({ children, onPointerDown, onMouseMove, onMouseLeave, className, ...rest }: Props) {
  const ref = useRef<HTMLButtonElement>(null);

  function handleMove(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (!el || e.pointerType === 'touch') {
      onMouseMove?.(e);
      return;
    }
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    const clampX = Math.max(-6, Math.min(6, mx * 0.08));
    const clampY = Math.max(-6, Math.min(6, my * 0.08));
    el.style.transform = `translate3d(${clampX}px, ${clampY}px, 0)`;
    onMouseMove?.(e);
  }

  function handleLeave(e: React.MouseEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (el) el.style.transform = 'translate3d(0,0,0)';
    onMouseLeave?.(e);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const el = ref.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const dot = document.createElement('span');
      dot.className = 'ripple-dot';
      dot.style.left = `${e.clientX - rect.left}px`;
      dot.style.top = `${e.clientY - rect.top}px`;
      el.appendChild(dot);
      setTimeout(() => dot.remove(), 650);
    }
    onPointerDown?.(e);
  }

  return (
    <button
      ref={ref}
      className={`magnetic relative overflow-hidden ${className ?? ''}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onPointerDown={handlePointerDown}
      {...rest}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/MagneticButton.tsx
git commit -m "feat(staff): add MagneticButton with cursor-follow + ripple"
```

---

## Task 4: `ConfettiBurst` component

**Files:**
- Create: `packages/staff/src/components/ConfettiBurst.tsx`

- [ ] **Step 1: Write the component**

Create `packages/staff/src/components/ConfettiBurst.tsx` with exactly:

```tsx
import { useEffect, useState } from 'react';

interface Piece {
  id: number;
  dx: number;
  dy: number;
  r: number;
}

/**
 * One-shot gold-triangle burst. Renders 10 pieces with randomised
 * trajectories, then cleans up after 900ms.
 */
export function ConfettiBurst() {
  const [pieces, setPieces] = useState<Piece[]>([]);

  useEffect(() => {
    const fresh: Piece[] = Array.from({ length: 10 }, (_, id) => {
      const angle = (id / 10) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 40 + Math.random() * 30;
      return {
        id,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        r: Math.round((Math.random() - 0.5) * 360),
      };
    });
    setPieces(fresh);
    const t = setTimeout(() => setPieces([]), 900);
    return () => clearTimeout(t);
  }, []);

  if (pieces.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-triangle"
          style={{
            ['--dx' as unknown as string]: `${p.dx}px`,
            ['--dy' as unknown as string]: `${p.dy}px`,
            ['--r' as unknown as string]: `${p.r}deg`,
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/ConfettiBurst.tsx
git commit -m "feat(staff): add ConfettiBurst component for clock-in success"
```

---

## Task 5: Restyle `ClockPage` header

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Add imports near the top of ClockPage**

Below the existing imports in `packages/staff/src/pages/ClockPage.tsx`, add:

```tsx
import { LetterReveal } from '@/components/LetterReveal';
```

(We don't import `MagneticButton` or `ConfettiBurst` yet — that's Tasks 7–8. The existing lucide icon imports stay.)

- [ ] **Step 2: Rewrite the header block**

Read `packages/staff/src/pages/ClockPage.tsx`. Find the header block (approximately lines 208–227):

```tsx
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)' }}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg overflow-hidden">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-[14px] font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
              <p className="text-[10px] text-[#D4A017]/70 tracking-wide uppercase">OHCS Clock System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SettingsMenu />
            <PinChangeButton />
            <button onClick={logout} className="text-[12px] text-white/50 hover:text-white/80 transition-colors">Sign Out</button>
          </div>
        </div>
      </div>
```

Replace the entire block with:

```tsx
      {/* Header */}
      <div className="relative kente-weave shimmer-sweep" style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)', ['--kente-opacity' as unknown as string]: '0.05' }}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="logo-ring w-[52px] h-[52px] flex-shrink-0">
              <div className="w-full h-full rounded-full overflow-hidden ring-1 ring-[#D4A017]/30">
                <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
              </div>
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-white leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
              <p className="text-[10px] text-[#D4A017]/80 tracking-[0.25em] uppercase mt-0.5">OHCS Clock System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SettingsMenu />
            <PinChangeButton />
            <button
              onClick={logout}
              className="group relative text-[12px] text-white/60 hover:text-white transition-colors"
            >
              Sign Out
              <span className="absolute left-0 -bottom-0.5 h-[1px] w-full scale-x-0 bg-[#D4A017] origin-right transition-transform duration-300 group-hover:scale-x-100 group-hover:origin-left" />
            </button>
          </div>
        </div>
      </div>
```

Key changes:
- Added `.kente-weave` + `.shimmer-sweep` classes to the header outer div; lifted Kente opacity to 0.05 for the dark header.
- Logo container promoted to 52px inside a `.logo-ring` wrapper (adds the rotating gold ring).
- Title font size 14 → 16, subtitle tracking `0.25em`.
- Sign Out gains a gold underline that slides in from the right on hover.

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): restyle ClockPage header (logo ring, Kente weave, shimmer)"
```

---

## Task 6: Restyle greeting + streak pill + Today card

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Rewrite the greeting block**

Find the greeting + streak + today card block (approximately lines 229–275). Current:

```tsx
      <div className="flex-1 flex flex-col items-center px-5 py-6 safe-area-bottom">
        {/* Greeting */}
        <p className="text-[14px] text-muted">{greeting},</p>
        <h2 className="text-[24px] font-bold text-foreground mt-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
          {user?.name}
        </h2>

        {/* Streak */}
        {status && status.streak > 0 && (
          <div className="flex items-center gap-2 mt-3 px-4 py-1.5 bg-accent/10 rounded-full">
            <Flame className="h-4 w-4 text-accent-warm" />
            <span className="text-[13px] font-semibold text-accent-warm">{status.streak} day streak</span>
            {status.longest_streak > status.streak && (
              <span className="text-[11px] text-muted">
                <Trophy className="h-3 w-3 inline" /> Best: {status.longest_streak}
              </span>
            )}
          </div>
        )}

        {/* Today's status */}
        <div className="w-full max-w-sm mt-6 bg-surface rounded-2xl border border-border shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted" />
              <span className="text-[13px] font-medium text-muted">Today</span>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex-1 text-center">
              <p className="text-[11px] text-muted uppercase tracking-wide">In</p>
              <p className={cn('text-[16px] font-bold mt-0.5', status?.clocked_in ? 'text-success' : 'text-muted-foreground')}>
                {status?.clock_in_time ? formatTime(status.clock_in_time) : '--:--'}
              </p>
            </div>
            <div className="w-[1px] bg-border" />
            <div className="flex-1 text-center">
              <p className="text-[11px] text-muted uppercase tracking-wide">Out</p>
              <p className={cn('text-[16px] font-bold mt-0.5', status?.clocked_out ? 'text-foreground' : 'text-muted-foreground')}>
                {status?.clock_out_time ? formatTime(status.clock_out_time) : '--:--'}
              </p>
            </div>
          </div>
        </div>
```

Replace the entire block (up to AND INCLUDING the closing `</div>` of the Today card — i.e., up to the line that currently reads `</div>` just before `{/* Main action area */}`) with:

```tsx
      <div className="relative flex-1 flex flex-col items-center px-5 py-6 safe-area-bottom kente-weave" style={{ ['--kente-opacity' as unknown as string]: '0.025' }}>
        {/* Greeting */}
        <p className="text-[11px] text-accent-warm tracking-[0.2em] uppercase font-semibold">{greeting}</p>
        <h2 className="text-[28px] font-bold text-foreground mt-1 leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
          <LetterReveal text={user?.name ?? ''} />
        </h2>
        <span className="underline-flourish w-16 mt-1.5" />

        {/* Streak */}
        {status && status.streak > 0 && (
          <div className="flex items-center gap-2 mt-4 px-4 py-1.5 bg-accent/10 border border-accent/20 rounded-full">
            <span className="flex items-center gap-0.5">
              {Array.from({ length: Math.min(5, status.streak) }).map((_, i) => (
                <Flame key={i} className="h-3.5 w-3.5 text-accent-warm ember" style={{ ['--i' as unknown as string]: i }} />
              ))}
            </span>
            <span className="text-[13px] font-semibold text-accent-warm">{status.streak} day streak</span>
            {status.longest_streak > status.streak && (
              <span className="text-[11px] text-muted ml-1">
                <Trophy className="h-3 w-3 inline" /> Best: {status.longest_streak}
              </span>
            )}
          </div>
        )}

        {/* Today's status */}
        <div className="gold-frame w-full max-w-sm mt-6 bg-surface rounded-2xl border border-border shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <Clock className="h-4 w-4 text-muted" />
              <span className="text-[13px] font-medium text-muted">Today</span>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted uppercase tracking-[0.2em]">In</p>
              <p className={cn(
                'text-[18px] font-bold mt-1 transition-all duration-500',
                status?.clocked_in ? 'text-success' : 'text-muted-foreground',
              )} style={{ fontFamily: "'Playfair Display', serif" }}>
                {status?.clock_in_time ? formatTime(status.clock_in_time) : '--:--'}
              </p>
            </div>
            <div className="w-[1px] bg-gradient-to-b from-transparent via-border to-transparent" />
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted uppercase tracking-[0.2em]">Out</p>
              <p className={cn(
                'text-[18px] font-bold mt-1 transition-all duration-500',
                status?.clocked_out ? 'text-foreground' : 'text-muted-foreground',
              )} style={{ fontFamily: "'Playfair Display', serif" }}>
                {status?.clock_out_time ? formatTime(status.clock_out_time) : '--:--'}
              </p>
            </div>
          </div>
        </div>
```

Key changes:
- Outer container gains `.kente-weave` at 2.5% opacity.
- "Good Morning" becomes gold small-caps tracking 0.2em, on its own.
- Officer name uses `<LetterReveal>`, bumped 24 → 28px.
- Gold underline flourish beneath the name.
- Streak pill: ember-fade flames (up to 5), pill gains subtle gold border.
- Today card: `.gold-frame` adds deco corner brackets; "Today" label gains live pulse dot (green); IN/OUT times switch to Playfair Display serif 18px; vertical divider becomes a gradient.

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): restyle greeting, streak pill, and Today card (Kente Executive)"
```

---

## Task 7: Restyle Clock In / Clock Out buttons with `MagneticButton`

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Add import**

Below the `LetterReveal` import added in Task 5, add:

```tsx
import { MagneticButton } from '@/components/MagneticButton';
```

- [ ] **Step 2: Replace the idle-phase clock buttons**

Find the `{phase === 'idle' && ...}` block (approximately lines 281–313). Locate the two `<button>` elements for Clock In and Clock Out:

```tsx
              {canClockIn && (
                <button
                  onClick={() => startClock('clock_in')}
                  className="w-full h-20 bg-primary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-xl shadow-primary/25 hover:bg-primary-light active:scale-[0.98] transition-all"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogIn className="h-7 w-7" />
                  Clock In
                </button>
              )}
              {canClockOut && (
                <button
                  onClick={() => startClock('clock_out')}
                  className="w-full h-20 bg-secondary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-xl shadow-secondary/25 hover:bg-secondary-light active:scale-[0.98] transition-all"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogOut className="h-7 w-7" />
                  Clock Out
                </button>
              )}
```

Replace with:

```tsx
              {canClockIn && (
                <MagneticButton
                  onClick={() => startClock('clock_in')}
                  className="w-full h-20 bg-primary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-[0_14px_30px_rgba(26,77,46,0.3)] ring-1 ring-[#D4A017]/30 hover:ring-[#D4A017]/60 hover:shadow-[0_18px_40px_rgba(212,160,23,0.25)] transition-[box-shadow,ring] duration-300"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogIn className="h-7 w-7 transition-transform duration-300 group-hover:rotate-[15deg]" />
                  Clock In
                </MagneticButton>
              )}
              {canClockOut && (
                <MagneticButton
                  onClick={() => startClock('clock_out')}
                  className="w-full h-20 bg-secondary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-[0_14px_30px_rgba(139,26,26,0.3)] ring-1 ring-[#D4A017]/30 hover:ring-[#D4A017]/60 hover:shadow-[0_18px_40px_rgba(212,160,23,0.25)] transition-[box-shadow,ring] duration-300"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogOut className="h-7 w-7 transition-transform duration-300 group-hover:rotate-[15deg]" />
                  Clock Out
                </MagneticButton>
              )}
```

Note: `MagneticButton` sets `position: relative; overflow: hidden` internally so the ripple dot stays contained. The icon rotation uses Tailwind's group-hover (works because MagneticButton carries the hover target).

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): clock-in/out buttons use MagneticButton with gold ring"
```

---

## Task 8: Success screen confetti burst

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Add import**

Below the existing component imports, add:

```tsx
import { ConfettiBurst } from '@/components/ConfettiBurst';
```

- [ ] **Step 2: Render the burst inside the success phase**

Find the `{phase === 'success' && result && (` block (approximately line 363). Immediately INSIDE the wrapping div that contains the check icon animation, add `<ConfettiBurst />` as a sibling of the check icon so it centres on the same point.

Specifically, find the success block which starts like this (paraphrased; actual code may differ — read the file):

```tsx
          {phase === 'success' && result && (
            <div className="text-center space-y-4 w-full animate-fade-in-up">
              <div ...>
                <Check ... />
              </div>
              ...
            </div>
          )}
```

Locate the outermost `<div className="text-center space-y-4 w-full animate-fade-in-up">`. Make it `relative` and insert `<ConfettiBurst />` as the first child:

```tsx
          {phase === 'success' && result && (
            <div className="relative text-center space-y-4 w-full animate-fade-in-up">
              <ConfettiBurst />
              {/* existing success content unchanged */}
              ...
            </div>
          )}
```

The `ConfettiBurst` component is absolutely-positioned to fill the parent and self-cleans after 900ms, so it adds no visual clutter after the burst.

- [ ] **Step 3: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): add gold confetti burst on clock-in success"
```

---

## Task 9: Footer motto shimmer

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

- [ ] **Step 1: Restyle the footer**

Find the footer block (around lines 417–423):

```tsx
        {/* Footer motto */}
        <div className="flex items-center gap-3 mt-6" style={{ color: '#D4A017' }}>
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-60">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-40" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-60">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-40" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-60">Service</span>
        </div>
```

Replace with:

```tsx
        {/* Footer motto */}
        <div className="relative flex items-center gap-3 mt-6 shimmer-sweep py-2 px-3 rounded-full" style={{ color: '#D4A017' }}>
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-1">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-50 animate-fade-in stagger-2" />
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-3">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-50 animate-fade-in stagger-4" />
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-5">Service</span>
        </div>
```

Note: the `shimmer-sweep` class adds the periodic gold sweep. Tokens like `stagger-1`..`stagger-5` are already in tokens.css from the existing codebase.

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): footer motto gets shimmer sweep + staggered reveal"
```

---

## Task 10: Local smoke test + deploy

**Files:** none modified.

- [ ] **Step 1: Local build sanity check**

From repo root:

```bash
node node_modules/typescript/bin/tsc -b packages/staff
node node_modules/vite/bin/vite.js build packages/staff
```

Expected: clean build, dist produced, no errors.

- [ ] **Step 2: (Optional) Spin up dev server to eyeball**

```bash
cd packages/staff
npm run dev
```

Load `http://localhost:5173`, log in, verify:
- Header logo has a visible rotating gold ring.
- Officer name reveals letter-by-letter.
- Streak pill fills with staggered embers (if streak > 0).
- Today card has gold corner brackets and a pulsing live dot.
- Clock In button has a gold ring, follows cursor (desktop), ripples on press.
- Clock Out button same (when applicable).
- Footer shimmer visible within 8 seconds of load.
- `prefers-reduced-motion: reduce` in DevTools → all animations flatten cleanly (no broken states).

Leave any minor spacing tweaks to post-deploy if functional.

- [ ] **Step 3: Deploy staff Pages**

```bash
cd packages/staff
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=staff-attendance --branch=main --commit-dirty=true
```

Expected: deployment URL printed.

- [ ] **Step 4: Push to GitHub**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
git push origin main
```

---

## Self-Review Notes

**Spec coverage:**
- Kente pattern texture → Task 1 (utility class) + Tasks 5, 6 (applied on header + body).
- Logo rotating gold ring + shimmer → Task 1 (`.logo-ring`, `.shimmer-sweep`) + Task 5 (markup).
- Officer name letter-reveal → Task 2 (`LetterReveal`) + Task 6 (usage).
- Gold underline flourish → Task 1 (`.underline-flourish`) + Task 6.
- Streak ember fade → Task 1 + Task 6.
- Today card gold-frame + live pulse + serif times → Task 1 (`.gold-frame`) + Task 6.
- Clock button magnetic + ripple + gold ring → Tasks 3, 7.
- Success confetti burst → Tasks 4, 8.
- Footer shimmer + stagger → Task 1 (existing stagger classes) + Task 9.
- `prefers-reduced-motion` respect → Task 1 (media query at end of CSS block).
- No new dependencies → confirmed; only new TSX files + CSS appended.
- Deploy → Task 10.

**Type consistency:**
- `LetterReveal` prop `text: string` matches the call site `user?.name ?? ''`.
- `MagneticButton` extends `ButtonHTMLAttributes<HTMLButtonElement>`; all existing button props (`onClick`, `className`, `style`) carry over.
- CSS variables `--i`, `--dx`, `--dy`, `--r`, `--kente-opacity` are consistently the same names across JSX consumers and keyframes.

**Known risks:**
- Ripple dot is appended to the DOM via vanilla `document.createElement` — confirms it doesn't leak after unmount because `setTimeout(..., 650)` removes it. Even if the button unmounts before the timeout fires, the orphan element is dropped with the detached parent.
- Magnetic transform lives in inline `style`; CSS `.magnetic` transitions it. If another class also sets `transform`, it will fight. Safe here because no other class on the clock buttons sets `transform`.
- `LetterReveal` splits on characters including non-ASCII — fine for the seeded superadmin "System Administrator" and real officer names. Preserves whitespace explicitly via `&nbsp;`.
- `prefers-reduced-motion: reduce` media block uses `!important` to unconditionally disable our additions. It won't affect other project animations (they live in different blocks).
