import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type VisitorDetail, type Visit } from '@/lib/api';
import { cn, getInitials, formatDate, formatTime, formatDateTime } from '@/lib/utils';
import { VISIT_STATUS, ID_TYPES } from '@/lib/constants';
import {
  ChevronLeft,
  User,
  Phone,
  Mail,
  Briefcase,
  CreditCard,
  Calendar,
  Clock,
  Building2,
} from 'lucide-react';

export function VisitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['visitor', id],
    queryFn: () => api.get<VisitorDetail>(`/visitors/${id}`),
    enabled: !!id,
  });

  const visitor = data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !visitor) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-muted">Visitor not found</p>
        <button onClick={() => navigate('/visitors')} className="text-sm text-primary font-medium mt-2 hover:underline">
          Back to visitors
        </button>
      </div>
    );
  }

  const idTypeLabel = ID_TYPES.find((t) => t.value === visitor.id_type)?.label;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/visitors')}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        All Visitors
      </button>

      {/* Profile card */}
      <div className="bg-surface rounded-xl border border-border shadow-sm p-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-bold shrink-0">
            {getInitials(visitor.first_name, visitor.last_name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-foreground">
              {visitor.first_name} {visitor.last_name}
            </h2>
            {visitor.organisation && (
              <p className="text-sm text-muted mt-0.5">{visitor.organisation}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mt-4">
              {visitor.phone && (
                <DetailRow icon={<Phone className="h-3.5 w-3.5" />} label="Phone" value={visitor.phone} />
              )}
              {visitor.email && (
                <DetailRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={visitor.email} />
              )}
              {visitor.id_type && (
                <DetailRow icon={<CreditCard className="h-3.5 w-3.5" />} label="ID Type" value={idTypeLabel ?? visitor.id_type} />
              )}
              {visitor.id_number && (
                <DetailRow icon={<CreditCard className="h-3.5 w-3.5" />} label="ID Number" value={visitor.id_number} />
              )}
              <DetailRow icon={<Calendar className="h-3.5 w-3.5" />} label="Total Visits" value={String(visitor.total_visits)} />
              {visitor.last_visit_at && (
                <DetailRow icon={<Clock className="h-3.5 w-3.5" />} label="Last Visit" value={formatDate(visitor.last_visit_at)} />
              )}
            </div>
          </div>

          <button
            onClick={() => navigate('/check-in')}
            className="h-9 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors shrink-0"
          >
            Check In
          </button>
        </div>
      </div>

      {/* Visit history */}
      <div className="bg-surface rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Visit History</h3>
          <p className="text-xs text-muted mt-0.5">Last 20 visits</p>
        </div>

        {visitor.visits.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            No visit history yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Date</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Check In</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Check Out</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Duration</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Host</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Directorate</th>
                  <th className="text-left px-5 py-2.5 text-xs font-medium text-muted">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visitor.visits.map((visit: Visit) => {
                  const statusCfg = VISIT_STATUS[visit.status];
                  return (
                    <tr key={visit.id} className="hover:bg-background/30 transition-colors">
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {formatDate(visit.check_in_at)}
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {formatTime(visit.check_in_at)}
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {visit.check_out_at ? formatTime(visit.check_out_at) : '—'}
                      </td>
                      <td className="px-5 py-3 text-foreground whitespace-nowrap">
                        {visit.duration_minutes ? `${visit.duration_minutes}m` : '—'}
                      </td>
                      <td className="px-5 py-3 text-foreground truncate max-w-[160px]">
                        {visit.host_name ?? '—'}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {visit.directorate_abbr ? (
                          <span className="inline-flex items-center h-5 px-1.5 text-[10px] font-medium bg-primary/10 text-primary rounded">
                            {visit.directorate_abbr}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center h-5 px-2 text-[10px] font-medium rounded-full',
                            statusCfg.color
                          )}
                        >
                          {statusCfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted">{icon}</span>
      <span className="text-xs text-muted">{label}:</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
