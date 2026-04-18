# Mobile Nav + Logo Badges — Design

**Date:** 2026-04-18
**Scope:** `packages/staff` (header + new bottom nav + logo badge) and `packages/web` (header logo badge + safe-area fix). Fixes an installed-PWA bug where iOS/Android status bar overlaps the header, and visually differentiates the two apps on users' home screens / task switchers.

## Problem

On an installed PWA (iOS especially), the status bar (clock, battery, notifications) overlays the top of the screen — but our header doesn't reserve space for it, so the logo and menu buttons get obscured. Also, both apps share the same OHCS emblem; when a user has both installed, they can't tell them apart at a glance.

## Goals

1. Header respects the device's safe-area-top (notch / Dynamic Island / status bar) on both apps.
2. Staff app: menu items (Settings gear, PIN, Sign Out) move to a fixed bottom bar, native-mobile style.
3. Both apps: the OHCS logo gets a small differentiating badge — staff (clock icon, green) vs. VMS (user-plus icon, gold) — visible in the header and in the PWA install/task-switch thumbnail.

## Non-goals

- No change to VMS sidebar layout (desktop/tablet-first; sidebar is already well-placed).
- No change to auth flow, clock-in flow, absence notice, push, or offline queue.
- No new UI for logged-out screens (LoginPage stays as-is).
- No change to the PWA icon files in `/icons/` (the badge lives in-app, in the header component).

## Fix 1 — Safe-area padding on header (both apps)

Current staff header in `packages/staff/src/pages/ClockPage.tsx`:
```tsx
<div className="relative kente-weave shimmer-sweep" style={{ background: '...', '--kente-opacity': '0.05' }}>
  <div className="h-[2px]" style={{ ... Ghana flag stripe ... }} />
  <div className="flex items-center justify-between px-5 py-4">
    ...
  </div>
</div>
```

The inner `py-4` means 16px top padding — the status bar can be 44px+ on iPhones with Dynamic Island. Status bar overlaps our content.

Fix: set `padding-top: max(1rem, env(safe-area-inset-top) + 0.25rem)` on the inner flex div. Keep the Ghana flag stripe above the safe area (it's thin and part of the visual chrome; if it gets slightly clipped on a notch device, that's acceptable).

Same fix for VMS header at `packages/web/src/components/layout/Header.tsx`.

## Fix 2 — Staff: strip header menu items, add fixed bottom nav

### Header after change

Header retains ONLY: logo (left) + title/subtitle (left). Everything on the right side (Settings gear, PIN, Sign Out) is removed from the header.

### New component: `packages/staff/src/components/BottomNav.tsx`

Fixed-position bottom bar with three tap targets + safe-area awareness.

```tsx
import { Settings, KeyRound, LogOut } from 'lucide-react';
import { SettingsMenu } from './SettingsMenu';
import { useAuthStore } from '@/stores/auth';
import { useState } from 'react';
import { PinChangeModal } from '@/hooks/usePinChange';

export function BottomNav() {
  const logout = useAuthStore((s) => s.logout);
  const [showPin, setShowPin] = useState(false);
  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#D4A017]/20"
        style={{
          background: 'linear-gradient(180deg, #1A4D2E, #0F2E1B)',
          paddingBottom: 'env(safe-area-inset-bottom, 0)',
        }}
      >
        <div className="flex items-stretch justify-around h-[56px] px-2">
          <SettingsMenu placement="top" />
          <button
            type="button"
            onClick={() => setShowPin(true)}
            className="flex flex-col items-center justify-center gap-0.5 px-6 text-white/70 hover:text-white transition-colors"
          >
            <KeyRound className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">PIN</span>
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex flex-col items-center justify-center gap-0.5 px-6 text-white/70 hover:text-white transition-colors"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">Sign Out</span>
          </button>
        </div>
      </nav>
      {showPin && <PinChangeModal onClose={() => setShowPin(false)} />}
    </>
  );
}
```

The `SettingsMenu` component already exists and currently renders a gear button that opens a dropdown *downward*. For a bottom-anchored nav, the dropdown needs to open *upward*. We add a `placement?: 'top' | 'bottom'` prop (default `'bottom'` to preserve the existing contract) and switch the dropdown positioning when `placement === 'top'`.

In `SettingsMenu.tsx`:
- Dropdown panel class becomes `absolute ${placement === 'top' ? 'bottom-12' : 'top-11'} right-0 ...` (or similar — pick offset that looks right).
- Button styling for the nav context: icon + label stack, not the current small gear-only.

Actually, since the bottom-nav settings button wants a different visual (icon-above-label 56px tap target), it's cleaner to have `BottomNav` render its OWN settings trigger and just use the dropdown content separately. To keep the refactor tight: add a `renderAs?: 'dropdown-top' | 'dropdown-bottom-right' | 'nav-item'` OR expose `SettingsMenuContent` as its own component and let `BottomNav` compose the trigger.

### Decision: refactor `SettingsMenu`

Split into two exports:
- `SettingsMenu` — the current gear+dropdown component, unchanged defaults. Accepts optional `placement?: 'top' | 'bottom'` to flip the dropdown direction.
- `SettingsMenuTriggerAsNavItem` — a new component that renders a full-height nav-item-style button (icon+label) which, when pressed, toggles the same dropdown upward. Reuses the same menu content (Install + Push toggles).

Actually simpler: give `SettingsMenu` two props:
- `placement?: 'top' | 'bottom'` (dropdown direction, default `'bottom'`)
- `variant?: 'icon' | 'nav-item'` (trigger style, default `'icon'`)

`BottomNav` uses `<SettingsMenu placement="top" variant="nav-item" />`. The existing ClockPage header drops the SettingsMenu entirely, so the default variant is still rendered… actually the header no longer includes SettingsMenu at all — it's moved into BottomNav. The defaults exist for backward-compat but aren't exercised.

### ClockPage layout changes

The ClockPage root div currently:
```tsx
<div className="min-h-screen bg-background flex flex-col">
  {showFirstLoginPrompt && <FirstLoginPinPrompt />}
  {/* Header */}
  <div className="...header...">
    ...
  </div>
  <div className="flex-1 flex flex-col items-center px-5 py-6 safe-area-bottom kente-weave">
    ...body content...
    <div className="... footer motto ...">...</div>
  </div>
</div>
```

After change:
1. The `safe-area-bottom` class on the body container is **removed** — the bottom nav now owns the safe area. Replace with a bottom padding that reserves space for the nav: `pb-[72px]` (56px nav + 16px breathing) in addition to `paddingBottom: env(safe-area-inset-bottom)`.
2. `<BottomNav />` is rendered as the last child of the root `<div className="min-h-screen ...">`.
3. The Ghana flag stripe stays unchanged.
4. The header's inner flex div simplifies — no more right cluster.

## Fix 3 — Differentiating logo badges (both apps)

### Staff app (Clock badge, green)

In `ClockPage.tsx`, wrap the existing `logo-ring` + img with a relative container and overlay a badge:

```tsx
<div className="logo-ring w-[52px] h-[52px] flex-shrink-0 relative">
  <div className="w-full h-full rounded-full overflow-hidden ring-1 ring-[#D4A017]/30">
    <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
  </div>
  <div
    className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm ring-2 ring-[#0F2E1B]"
    style={{ background: '#1A7A3A' }}
    aria-hidden="true"
  >
    <Clock className="h-[10px] w-[10px] text-white" strokeWidth={2.5} />
  </div>
</div>
```

The `ring-2 ring-[#0F2E1B]` gives the badge a dark-green outline so it reads cleanly against both the Kente-patterned green header and any photo of the emblem underneath. Background `#1A7A3A` is our existing `--color-success` — matches the "clocked in" semantic.

### VMS app (UserPlus badge, gold)

In `packages/web/src/components/layout/Header.tsx`, same pattern — wrap the existing logo with a relative container, overlay a gold badge with `UserPlus`:

```tsx
<div className="relative">
  <div className="... existing logo wrapper ...">
    <img src="/ohcs-logo.jpg" alt="OHCS" ... />
  </div>
  <div
    className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm ring-2 ring-white"
    style={{ background: '#D4A017' }}
    aria-hidden="true"
  >
    <UserPlus className="h-[10px] w-[10px] text-white" strokeWidth={2.5} />
  </div>
</div>
```

Ring is white here because VMS header is light-themed (or the badge sits on a pale surface — I'll confirm on implementation).

### Why this matches the "differentiate at a glance" goal

Even at 32px in a home-screen icon context or task switcher thumbnail, the badge color (green vs gold) + silhouette (clock vs user) is distinguishable. For the full header size (52px logo + 18px badge), it's immediately obvious.

## Files touched

**New:**
- `packages/staff/src/components/BottomNav.tsx`

**Modified:**
- `packages/staff/src/pages/ClockPage.tsx` — strip header right cluster; add badge to logo; add bottom padding reservation; render `<BottomNav />`; safe-area-top on header.
- `packages/staff/src/components/SettingsMenu.tsx` — optional `placement` and `variant` props.
- `packages/web/src/components/layout/Header.tsx` — safe-area-top; badge overlay on logo.

## Rollout

1. Ship both frontends in one deploy cycle.
2. Users on devices see:
   - No more clipped header.
   - Settings/PIN/Sign Out at the bottom (staff).
   - A small colored badge on the logo.
3. If anyone reports the bottom nav awkward (desktop browsers), revisit. Desktop users who install the PWA get the same nav — acceptable, that's what they asked for with an install.

## Acceptance criteria

- iPhone 14 or similar (notch/Dynamic Island) running staff PWA: status bar no longer overlaps the logo or title.
- Staff PWA: bottom nav visible, always on-screen, 3 items tappable, SettingsMenu dropdown opens *upward*.
- VMS PWA: status bar no longer overlaps the header on mobile; existing sidebar behaviour unchanged.
- Both apps show a small distinct badge on the logo (green clock vs gold user-plus).
- Home-screen install icons (`/icons/icon-*.png`) are unchanged — we don't redesign those.
- No regressions in clock-in / check-in / absence notice / push / offline queue.

## Out of scope

- Redesigning the `/icons/*.png` PWA-install icons per app. (Deferred — would need asset work.)
- Animating the bottom nav (slide-up on first mount, etc.).
- Adding more items to the bottom nav (e.g., notifications tab).
- Applying the bottom nav to the VMS app.
- Responsive behaviour for desktop browsers on the staff app — the bottom nav shows regardless of viewport. Current staff app is phone-first; acceptable.

## Open questions

None.
