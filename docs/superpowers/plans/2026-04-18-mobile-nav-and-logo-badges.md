# Mobile Nav + Logo Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the mobile-PWA header-clip bug and differentiate the two apps visually. Staff gets a fixed bottom nav with Settings/PIN/Sign Out; both apps get a safe-area-top header and a small coloured badge on the OHCS logo.

**Architecture:** Refactor `SettingsMenu` to accept a `placement` prop so its dropdown can open upward. Add a new `BottomNav` component to the staff package and remove the header right-side cluster. Add badge overlay markup inside the existing logo wrappers in both apps. Zero new runtime deps.

**Tech Stack:** React 18 + TypeScript + Tailwind 4 + Zustand + lucide-react. Existing `.logo-ring` / `.kente-weave` / `.shimmer-sweep` utilities stay.

---

## File Structure

**New files:**
- `packages/staff/src/components/BottomNav.tsx`

**Modified files:**
- `packages/staff/src/components/SettingsMenu.tsx` — add `placement` + `variant` props.
- `packages/staff/src/pages/ClockPage.tsx` — safe-area-top; remove header right cluster; add logo badge; render `<BottomNav />`; adjust body padding so nav doesn't cover content.
- `packages/web/src/components/layout/Header.tsx` — safe-area-top; add logo badge.

---

## Task 1: Refactor `SettingsMenu` with placement + variant props

**Files:**
- Modify: `packages/staff/src/components/SettingsMenu.tsx`

- [ ] **Step 1: Replace the file entirely with**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { InstallButton } from './InstallButton';
import { PushToggle } from './PushToggle';

interface Props {
  /** Which direction the dropdown panel opens. Default: 'bottom' (opens below the trigger). */
  placement?: 'top' | 'bottom';
  /** Trigger visual style. 'icon' = current small gear (header). 'nav-item' = stacked icon+label for bottom nav. */
  variant?: 'icon' | 'nav-item';
}

export function SettingsMenu({ placement = 'bottom', variant = 'icon' }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const panelPosition = placement === 'top' ? 'bottom-[calc(100%+8px)]' : 'top-11';

  return (
    <div ref={menuRef} className="relative">
      {variant === 'nav-item' ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label="Settings"
          aria-expanded={open}
          className="flex flex-col items-center justify-center gap-0.5 px-6 h-full text-white/70 hover:text-white transition-colors"
        >
          <Settings className="h-5 w-5" />
          <span className="text-[10px] font-medium tracking-wide">Settings</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label="Settings"
          aria-expanded={open}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Settings className="h-4 w-4" />
        </button>
      )}
      {open && (
        <div className={`absolute right-0 ${panelPosition} z-30 bg-white rounded-xl shadow-xl border border-gray-200 w-64 p-3 space-y-2`}>
          <InstallButton />
          <PushToggle />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check + commit**

Run from repo root:

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
```

Expected: no errors.

```bash
git add packages/staff/src/components/SettingsMenu.tsx
git commit -m "feat(staff): SettingsMenu accepts placement + variant props"
```

---

## Task 2: Create `BottomNav` component

**Files:**
- Create: `packages/staff/src/components/BottomNav.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { SettingsMenu } from './SettingsMenu';
import { PinChangeModal } from '@/hooks/usePinChange';
import { useAuthStore } from '@/stores/auth';

export function BottomNav() {
  const logout = useAuthStore((s) => s.logout);
  const [showPin, setShowPin] = useState(false);

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#D4A017]/20"
        style={{
          background: 'linear-gradient(180deg, #1A4D2E, #0F2E1B)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        aria-label="Primary navigation"
      >
        <div className="flex items-stretch justify-around h-[56px] px-2">
          <SettingsMenu placement="top" variant="nav-item" />
          <button
            type="button"
            onClick={() => setShowPin(true)}
            className="flex flex-col items-center justify-center gap-0.5 px-6 h-full text-white/70 hover:text-white transition-colors"
          >
            <KeyRound className="h-5 w-5" />
            <span className="text-[10px] font-medium tracking-wide">PIN</span>
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex flex-col items-center justify-center gap-0.5 px-6 h-full text-white/70 hover:text-white transition-colors"
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

- [ ] **Step 2: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/components/BottomNav.tsx
git commit -m "feat(staff): add BottomNav component (Settings/PIN/Sign Out)"
```

---

## Task 3: Restructure staff `ClockPage` — strip header right cluster, add logo badge, safe-area-top, render BottomNav

**Files:**
- Modify: `packages/staff/src/pages/ClockPage.tsx`

Read the file first to locate the exact edit points; line numbers are approximate.

- [ ] **Step 1: Swap out imports**

Find the import line:

```tsx
import { PinChangeButton } from '@/hooks/usePinChange';
```

Remove it (no longer needed — PIN change is triggered from `BottomNav` via `PinChangeModal` directly).

Below the other `@/components/...` imports, add:

```tsx
import { BottomNav } from '@/components/BottomNav';
```

Also remove any `SettingsMenu` import from the header line — it now lives inside `BottomNav` only. Search for `SettingsMenu` in the file. If there's an import like `import { SettingsMenu } from '@/components/SettingsMenu';`, remove it.

Check that `useAuthStore`'s `logout` is still used elsewhere in the file. If `logout` was destructured only for the old header button and is now unused, remove that destructure to keep the linter happy. If `useAuthStore` is imported elsewhere, leave it alone.

- [ ] **Step 2: Update the header JSX — safe-area-top, logo badge, drop right cluster**

Find the current header block (around lines 208–240 in the recent version). It begins with:

```tsx
      {/* Header */}
      <div className="relative kente-weave shimmer-sweep" style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)', ['--kente-opacity' as unknown as string]: '0.05' }}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
        <div className="flex items-center justify-between px-5 py-4">
```

Replace the entire header block (from the `{/* Header */}` comment to its closing `</div>` after the Ghana-flag stripe + inner flex) with:

```tsx
      {/* Header */}
      <div className="relative kente-weave shimmer-sweep" style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)', ['--kente-opacity' as unknown as string]: '0.05' }}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
        <div
          className="flex items-center gap-4 px-5 pb-4"
          style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top, 0px) + 0.25rem))' }}
        >
          <div className="logo-ring w-[52px] h-[52px] flex-shrink-0 relative">
            <div className="w-full h-full rounded-full overflow-hidden ring-1 ring-[#D4A017]/30">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <div
              className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm"
              style={{ background: '#1A7A3A', boxShadow: '0 0 0 2px #0F2E1B' }}
              aria-hidden="true"
            >
              <Clock className="h-[10px] w-[10px] text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-white leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
            <p className="text-[10px] text-[#D4A017]/80 tracking-[0.25em] uppercase mt-0.5">OHCS Clock System</p>
          </div>
        </div>
      </div>
```

Note: `Clock` is already imported from `lucide-react` at the top of this file (used in the Today card). Nothing new to import.

The right-side cluster (Settings / PIN / Sign Out) is now gone.

- [ ] **Step 3: Adjust the body container — reserve bottom-nav space + drop `safe-area-bottom`**

Locate the body wrapper div (currently has the `safe-area-bottom` class). It looks like:

```tsx
      <div className="relative flex-1 flex flex-col items-center px-5 py-6 safe-area-bottom kente-weave" style={{ ['--kente-opacity' as unknown as string]: '0.025' }}>
```

Replace with:

```tsx
      <div
        className="relative flex-1 flex flex-col items-center px-5 py-6 kente-weave"
        style={{
          ['--kente-opacity' as unknown as string]: '0.025',
          paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 1.5rem)',
        }}
      >
```

This replaces the `.safe-area-bottom` Tailwind utility class with an inline `paddingBottom` that reserves 56px for the nav + the safe-area-bottom env + 1.5rem breathing room.

- [ ] **Step 4: Render `<BottomNav />` as the last child of the root div**

The root of the return is currently:

```tsx
    <div className="min-h-screen bg-background flex flex-col">
      {showFirstLoginPrompt && <FirstLoginPinPrompt />}
      {/* Header */}
      ...
      {/* Body wrapper */}
      ...
    </div>
```

Add `<BottomNav />` just before the closing `</div>` of the root:

```tsx
    <div className="min-h-screen bg-background flex flex-col">
      {showFirstLoginPrompt && <FirstLoginPinPrompt />}
      {/* Header */}
      ...
      {/* Body wrapper */}
      ...
      <BottomNav />
    </div>
```

- [ ] **Step 5: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/staff/tsconfig.json
git add packages/staff/src/pages/ClockPage.tsx
git commit -m "feat(staff): safe-area-top header, logo badge, bottom nav; remove header menu cluster"
```

---

## Task 4: VMS — safe-area-top + logo badge in `packages/web/src/components/layout/Header.tsx`

**Files:**
- Modify: `packages/web/src/components/layout/Header.tsx`

- [ ] **Step 1: Add `UserPlus` to the lucide import**

Current:
```tsx
import { MapPin, Sun, Moon, Monitor } from 'lucide-react';
```

Change to:
```tsx
import { MapPin, Sun, Moon, Monitor, UserPlus } from 'lucide-react';
```

- [ ] **Step 2: Apply safe-area-top to the `<header>`**

Current:
```tsx
    <header className="h-[60px] bg-surface-warm border-b border-border px-4 md:px-6 flex items-center justify-between shrink-0 relative">
```

Replace with:
```tsx
    <header
      className="bg-surface-warm border-b border-border px-4 md:px-6 flex items-center justify-between shrink-0 relative"
      style={{
        minHeight: '60px',
        paddingTop: 'max(0px, env(safe-area-inset-top, 0px))',
      }}
    >
```

Height changes from fixed `60px` to a `minHeight` so the safe-area padding can push content down without cropping.

- [ ] **Step 3: Wrap the mobile logo with a relative container + add the badge overlay**

Find the mobile logo block (around lines 22–28):

```tsx
        {/* Mobile: show OHCS logo instead of location text */}
        <div className="lg:hidden flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden">
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          <span className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>SmartGate</span>
        </div>
```

Replace with:

```tsx
        {/* Mobile: show OHCS logo instead of location text */}
        <div className="lg:hidden flex items-center gap-2.5">
          <div className="relative w-8 h-8 flex-shrink-0">
            <div className="w-full h-full rounded-lg overflow-hidden">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <div
              className="absolute -bottom-1 -right-1 w-[14px] h-[14px] rounded-full flex items-center justify-center shadow-sm"
              style={{ background: '#D4A017', boxShadow: '0 0 0 1.5px var(--color-surface-warm)' }}
              aria-hidden="true"
            >
              <UserPlus className="h-[8px] w-[8px] text-white" strokeWidth={2.5} />
            </div>
          </div>
          <span className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>SmartGate</span>
        </div>
```

Note: on the desktop `lg:` variant, the header shows the `MapPin` location block — no logo there, so no badge to add. The badge lives only on the mobile logo where it matters.

- [ ] **Step 4: Type-check + commit**

```bash
node node_modules/typescript/bin/tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors.

```bash
git add packages/web/src/components/layout/Header.tsx
git commit -m "feat(web): safe-area-top header + gold UserPlus badge on logo"
```

---

## Task 5: Build + deploy

**Files:** none modified — operational.

- [ ] **Step 1: Build staff**

From repo root:

```bash
node node_modules/typescript/bin/tsc -b packages/staff
node node_modules/vite/bin/vite.js build packages/staff
```

Expected: clean build.

- [ ] **Step 2: Build web**

```bash
node node_modules/typescript/bin/tsc -b packages/web
node node_modules/vite/bin/vite.js build packages/web
```

- [ ] **Step 3: Deploy both Pages projects**

```bash
cd packages/staff
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=staff-attendance --branch=main --commit-dirty=true
cd ../web
node ../../node_modules/wrangler/bin/wrangler.js pages deploy dist --project-name=ohcs-smartgate --branch=main --commit-dirty=true
```

- [ ] **Step 4: Push to GitHub**

```bash
cd "C:/Users/USER/OneDrive - Smart Workplace/Desktop/Projects/OHCS SmartGate & Staff Attendance"
git push origin main
```

- [ ] **Step 5: User verification on device**

Have the user reload the installed staff PWA on their phone. Expected:

- Header no longer clipped by status bar; logo fully visible; "Staff Attendance" + "OHCS CLOCK SYSTEM" readable.
- A small green badge with a clock icon sits on the bottom-right of the logo.
- A dark-green bottom nav bar is pinned to the bottom of the screen with three items: Settings, PIN, Sign Out.
- Tapping Settings opens the dropdown upward (Install button, push toggle).
- Tapping PIN opens the PIN change modal.
- Tapping Sign Out logs out.
- Clock-in area is clear of the nav (bottom padding works).

For the VMS app on a phone:

- Header no longer clipped.
- A small gold badge with a user-plus icon sits on the logo.
- Otherwise no changes.

---

## Self-Review Notes

**Spec coverage:**
- Fix 1 (safe-area-top both apps) → Task 3 Step 2 (staff header) + Task 4 Step 2 (web header).
- Fix 2 (bottom nav staff) → Tasks 1, 2, and 3 Step 4.
- Fix 2.a (SettingsMenu opens upward in nav) → Task 1 adds `placement` prop; Task 2 uses it.
- Fix 3 (staff clock badge) → Task 3 Step 2 (logo wrapper).
- Fix 3 (VMS user-plus badge) → Task 4 Step 3.

**Placeholder scan:** no TBDs, no vague instructions — all steps contain the exact code to write.

**Type consistency:**
- `SettingsMenu` props `placement`, `variant` — used identically in Task 2.
- `BottomNav` is a zero-prop component; rendered once in Task 3 Step 4.
- `PinChangeModal` imported from `@/hooks/usePinChange` — same import path already exercised by `FirstLoginPinPrompt`.
- `useAuthStore`'s `logout` action — same signature used in Task 2.

**Known risks:**
- If the user currently has an active PWA install running, the service worker will serve the old asset bundle until the next SW activation. The existing SW already reloads on activate; nothing special needed here.
- The `safe-area-bottom` Tailwind utility class is defined in `tokens.css` as `padding-bottom: env(safe-area-inset-bottom, 0)`. Dropping it from the body and using inline `paddingBottom` means we compute the total (nav height + safe area + breathing) in one place. No regression — the class was only applied to this one div.
- If iOS's `env(safe-area-inset-top)` returns `0` on non-notch devices, `max(1rem, calc(0px + 0.25rem))` resolves to `1rem` — same as today. No regression on non-notch.
- VMS mobile logo badge uses `boxShadow: 0 0 0 1.5px var(--color-surface-warm)`. If `--color-surface-warm` is undefined in light mode (it isn't — it's in `tokens.css`), the shadow would be invisible but non-breaking.
