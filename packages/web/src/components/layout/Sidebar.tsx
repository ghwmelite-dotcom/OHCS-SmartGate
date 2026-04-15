import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LayoutDashboard, ClipboardCheck, Users, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/check-in', icon: ClipboardCheck, label: 'Check-In' },
  { to: '/visitors', icon: Users, label: 'Visitors' },
];

const ADMIN_NAV = [
  { to: '/admin', icon: Settings, label: 'Admin' },
];

export function Sidebar() {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const isSuperadmin = user?.role === 'superadmin';

  return (
    <aside className="w-64 h-screen flex flex-col shrink-0 relative overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #1A4D2E 0%, #0F2E1B 60%, #071A0F 100%)',
      }}
    >
      {/* Subtle kente pattern overlay */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 12px),
          repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 12px)`,
      }} />

      {/* Gold accent line at top */}
      <div className="h-[2px] w-full shrink-0" style={{
        background: 'linear-gradient(90deg, transparent, #D4A017 30%, #F5D76E 50%, #D4A017 70%, transparent)',
      }} />

      {/* Logo section */}
      <div className="relative px-5 pt-5 pb-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl overflow-hidden ring-2 ring-accent/30 shadow-lg shadow-black/20 shrink-0">
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="font-bold text-[15px] tracking-wide text-white" style={{ fontFamily: 'var(--font-display)' }}>
              SmartGate
            </h1>
            <p className="text-[10px] tracking-[0.12em] uppercase text-accent/70 font-medium leading-tight">
              Visitor Management System
            </p>
          </div>
        </div>

        {/* Ghana flag bar */}
        <div className="mt-4 h-[2px] rounded-full overflow-hidden">
          <div className="h-full w-full" style={{
            background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
          }} />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 relative">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-200 group relative',
                isActive
                  ? 'bg-white/12 text-white shadow-inner shadow-white/5'
                  : 'text-white/55 hover:bg-white/8 hover:text-white/90'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
                )}
                <item.icon className={cn(
                  'h-[18px] w-[18px] shrink-0 transition-colors',
                  isActive ? 'text-accent' : 'text-white/40 group-hover:text-white/70'
                )} />
                {item.label}
              </>
            )}
          </NavLink>
        ))}

        {/* Admin section — superadmin only */}
        {isSuperadmin && (
          <>
            <div className="h-[1px] w-full bg-white/8 my-2" />
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-200 group relative',
                    isActive
                      ? 'bg-white/12 text-white shadow-inner shadow-white/5'
                      : 'text-white/55 hover:bg-white/8 hover:text-white/90'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
                    )}
                    <item.icon className={cn(
                      'h-[18px] w-[18px] shrink-0 transition-colors',
                      isActive ? 'text-accent' : 'text-white/40 group-hover:text-white/70'
                    )} />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* Motto */}
      <div className="relative px-5 py-3">
        <p className="text-[9px] tracking-[0.2em] uppercase text-center font-semibold" style={{ color: '#D4A017' }}>
          Loyalty &middot; Excellence &middot; Service
        </p>
      </div>

      {/* Sign out */}
      <div className="relative px-3 pb-4">
        <div className="h-[1px] w-full bg-white/8 mb-3" />
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-medium text-white/40 hover:bg-secondary/30 hover:text-white/80 w-full transition-all duration-200"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
