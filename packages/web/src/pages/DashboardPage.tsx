import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Visit } from '@/lib/api';
import { cn, formatTime, timeAgo, getInitials } from '@/lib/utils';
import { VISIT_STATUS } from '@/lib/constants';
import {
  Users,
  LogIn,
  LogOut as LogOutIcon,
  Clock,
  RefreshCw,
  ArrowRight,
  Search,
} from 'lucide-react';

export function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const { data: activeVisits, isLoading } = useQuery({
    queryKey: ['visits', 'active'],
    queryFn: () => api.get<Visit[]>('/visits/active'),
    refetchInterval: 15_000,
  });

  const { data: todayVisits } = useQuery({
    queryKey: ['visits', 'today'],
    queryFn: () =>
      api.get<Visit[]>(
        `/visits?date=${new Date().toISOString().slice(0, 10)}&limit=100`
      ),
  });

  const checkOutMutation = useMutation({
    mutationFn: (visitId: string) => api.post(`/visits/${visitId}/check-out`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      setCheckingOut(null);
    },
  });

  const active = activeVisits?.data ?? [];
  const today = todayVisits?.data ?? [];
  const checkedOutToday = today.filter((v) => v.status === 'checked_out').length;
  const avgDuration =
    today.filter((v) => v.duration_minutes).length > 0
      ? Math.round(
          today
            .filter((v) => v.duration_minutes)
            .reduce((sum, v) => sum + (v.duration_minutes ?? 0), 0) /
            today.filter((v) => v.duration_minutes).length
        )
      : 0;

  function handleCheckOut(visitId: string) {
    setCheckingOut(visitId);
    checkOutMutation.mutate(visitId);
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="In Building"
          value={active.length}
          accent="text-secondary"
          bg="bg-secondary/10"
        />
        <StatCard
          icon={<LogIn className="h-5 w-5" />}
          label="Checked In Today"
          value={today.length}
          accent="text-info"
          bg="bg-info/10"
        />
        <StatCard
          icon={<LogOutIcon className="h-5 w-5" />}
          label="Checked Out Today"
          value={checkedOutToday}
          accent="text-success"
          bg="bg-success/10"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label="Avg Duration"
          value={avgDuration > 0 ? `${avgDuration}m` : '--'}
          accent="text-accent"
          bg="bg-accent/10"
        />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => navigate('/check-in')}
          className="inline-flex items-center gap-2 h-10 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors"
        >
          <LogIn className="h-4 w-4" />
          New Check-In
        </button>
        <button
          onClick={() => navigate('/visitors')}
          className="inline-flex items-center gap-2 h-10 px-4 bg-surface text-foreground text-sm font-medium rounded-lg border border-border hover:bg-background transition-colors"
        >
          <Search className="h-4 w-4" />
          Find Visitor
        </button>
      </div>

      {/* Active visits - live feed */}
      <div className="bg-surface rounded-xl border border-border shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Active Visits
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Currently in building — auto-refreshes every 15s
            </p>
          </div>
          <button
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['visits', 'active'] })
            }
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-background transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted text-sm">
            Loading active visits...
          </div>
        ) : active.length === 0 ? (
          <div className="p-8 text-center">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted">No visitors currently in building</p>
            <button
              onClick={() => navigate('/check-in')}
              className="inline-flex items-center gap-1 text-sm text-primary font-medium mt-2 hover:underline"
            >
              Check in a visitor <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {active.map((visit) => (
              <div
                key={visit.id}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-background/50 transition-colors"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                  {getInitials(visit.first_name ?? '', visit.last_name ?? '')}
                </div>

                {/* Visitor info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {visit.first_name} {visit.last_name}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                    {visit.organisation && (
                      <span className="truncate">{visit.organisation}</span>
                    )}
                    {visit.organisation && visit.host_name && (
                      <span className="text-border-strong">·</span>
                    )}
                    {visit.host_name && (
                      <span className="truncate">Host: {visit.host_name}</span>
                    )}
                  </div>
                </div>

                {/* Directorate badge */}
                {visit.directorate_abbr && (
                  <span className="hidden sm:inline-flex items-center h-6 px-2 text-xs font-medium bg-primary/10 text-primary rounded-md">
                    {visit.directorate_abbr}
                  </span>
                )}

                {/* Time */}
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-xs text-muted">
                    {formatTime(visit.check_in_at)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {timeAgo(visit.check_in_at)}
                  </p>
                </div>

                {/* Badge code */}
                {visit.badge_code && (
                  <span className="hidden md:inline-flex items-center h-6 px-2 text-xs font-mono bg-accent/10 text-accent rounded-md">
                    {visit.badge_code}
                  </span>
                )}

                {/* Check-out button */}
                <button
                  onClick={() => handleCheckOut(visit.id)}
                  disabled={checkingOut === visit.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg transition-colors shrink-0',
                    'bg-danger/10 text-danger hover:bg-danger hover:text-white',
                    checkingOut === visit.id && 'opacity-50 cursor-wait'
                  )}
                >
                  <LogOutIcon className="h-3.5 w-3.5" />
                  {checkingOut === visit.id ? 'Checking out...' : 'Check Out'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent: string;
  bg: string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4 flex items-center gap-4">
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
          bg,
          accent
        )}
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground leading-tight">
          {value}
        </p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}
