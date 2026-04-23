import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { InstallButton } from './InstallButton';
import { PushToggle } from './PushToggle';
import { BiometricToggle } from './BiometricToggle';

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
  // Header icon sits on the right → panel drops down-left. Bottom-nav item sits on the left → panel opens up-right.
  const panelAnchor = variant === 'nav-item' ? 'left-0' : 'right-0';

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
        <div className={`absolute ${panelAnchor} ${panelPosition} z-30 bg-white rounded-xl shadow-xl border border-gray-200 w-64 max-w-[calc(100vw-16px)] p-3 space-y-3`}>
          <InstallButton />
          <PushToggle />
          <div className="h-px bg-gray-100" />
          <BiometricToggle />
        </div>
      )}
    </div>
  );
}
