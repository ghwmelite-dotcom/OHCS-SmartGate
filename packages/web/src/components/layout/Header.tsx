import { useAuthStore } from '@/stores/auth';
import { formatDate } from '@/lib/utils';
import { NotificationBell } from '../NotificationBell';

export function Header() {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="h-14 bg-surface border-b border-border px-6 flex items-center justify-between shrink-0">
      <div>
        <p className="text-xs text-muted">{formatDate(new Date().toISOString())} — Office of the Head of Civil Service</p>
      </div>
      <div className="flex items-center gap-3">
        <NotificationBell />
        <div className="text-right">
          <p className="text-sm font-medium text-foreground">{user?.name}</p>
          <p className="text-xs text-muted capitalize">{user?.role}</p>
        </div>
        <div className="w-8 h-8 bg-primary/10 text-primary rounded-full flex items-center justify-center text-xs font-semibold">
          {user?.name?.charAt(0) ?? '?'}
        </div>
      </div>
    </header>
  );
}
