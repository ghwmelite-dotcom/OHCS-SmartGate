import { useAuthStore } from '@/stores/auth';
import { useThemeStore } from '@/stores/theme';
import { useSidebarStore } from '@/stores/sidebar';
import { formatDate } from '@/lib/utils';
import { NotificationBell } from '../NotificationBell';
import { MapPin, Sun, Moon, Monitor, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Header() {
  const user = useAuthStore((s) => s.user);
  const { theme, setTheme } = useThemeStore();
  const toggleMobile = useSidebarStore((s) => s.toggleMobile);

  const themeOptions = [
    { value: 'light' as const, icon: Sun, label: 'Light' },
    { value: 'dark' as const, icon: Moon, label: 'Dark' },
    { value: 'system' as const, icon: Monitor, label: 'System' },
  ];

  return (
    <header className="h-[60px] bg-surface-warm border-b border-border px-4 md:px-6 flex items-center justify-between shrink-0 relative">
      {/* Left — hamburger + location */}
      <div className="flex items-center gap-3">
        {/* Hamburger — tablet/mobile only */}
        <button
          onClick={toggleMobile}
          className="lg:hidden h-9 w-9 rounded-xl flex items-center justify-center text-foreground hover:bg-background transition-all"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="hidden md:flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-accent">
            <MapPin className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-foreground/80 tracking-wide">
              Office of the Head of Civil Service
            </p>
            <p className="text-[11px] text-muted-foreground">
              Accra, Ghana &middot; {formatDate(new Date().toISOString())}
            </p>
          </div>
        </div>
      </div>

      {/* Right — theme + notifications + user */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Theme toggle */}
        <div className="flex items-center bg-background rounded-lg border border-border p-0.5">
          {themeOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={cn(
                'h-7 w-7 rounded-md flex items-center justify-center transition-all',
                theme === opt.value
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              )}
              title={opt.label}
            >
              <opt.icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <NotificationBell />

        <div className="hidden md:block h-8 w-[1px] bg-border" />

        <div className="hidden md:flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold text-foreground">{user?.name}</p>
            <p className="text-[11px] text-accent font-medium uppercase tracking-wide">{user?.role}</p>
          </div>
        </div>
        <div className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center text-sm font-bold shadow-sm">
          {user?.name?.charAt(0) ?? '?'}
        </div>
      </div>
    </header>
  );
}
