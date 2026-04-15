import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/lib/utils';
import { NotificationBell } from '../NotificationBell';
import { MapPin } from 'lucide-react';

export function Header() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="h-[60px] bg-surface-warm border-b border-border px-6 flex items-center justify-between shrink-0 relative">
      {/* Left — location & date */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 text-accent">
          <MapPin className="h-3.5 w-3.5" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-foreground/80 tracking-wide">
            Office of the Head of Civil Service
          </p>
          <p className="text-[10px] text-muted-foreground">
            Accra, Ghana &middot; {formatDate(new Date().toISOString())}
          </p>
        </div>
      </div>

      {/* Right — notifications + user */}
      <div className="flex items-center gap-4">
        <NotificationBell />

        <div className="h-8 w-[1px] bg-border" />

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[13px] font-semibold text-foreground">{user?.name}</p>
            <p className="text-[10px] text-accent font-medium uppercase tracking-wide">{user?.role}</p>
          </div>
          <div className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center text-xs font-bold shadow-sm">
            {user?.name?.charAt(0) ?? '?'}
          </div>
        </div>
      </div>
    </header>
  );
}
