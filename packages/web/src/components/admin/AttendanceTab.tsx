import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Directorate } from '@/lib/api';
import { cn, formatTime, formatDate } from '@/lib/utils';
import { generateCSV, downloadCSV } from '@/lib/csv';
import {
  Users, Clock, AlertTriangle, TrendingUp, CheckCircle2,
  XCircle, Download, Calendar, Building2, ChevronDown,
} from 'lucide-react';

interface TodayOverview {
  total_staff: number;
  clocked_in: number;
  clocked_out: number;
  not_clocked_in: number;
  late_arrivals: number;
  attendance_rate: number;
}

interface AttendanceRecord {
  user_id: string;
  name: string;
  staff_id: string | null;
  role: string;
  directorate_abbr: string | null;
  clock_in_time: string | null;
  clock_out_time: string | null;
  clock_in_photo: string | null;
  is_late: number;
  current_streak: number;
}

interface DirBreakdown {
  abbreviation: string;
  name: string;
  total_staff: number;
  present: number;
  late: number;
}

export function AttendanceTab() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [dirFilter, setDirFilter] = useState('');

  const { data: overviewData } = useQuery({
    queryKey: ['attendance', 'today', selectedDate],
    queryFn: () => api.get<TodayOverview>(`/attendance/today`),
  });

  const { data: recordsData, isLoading } = useQuery({
    queryKey: ['attendance', 'records', selectedDate, dirFilter],
    queryFn: () => {
      let url = `/attendance/records?date=${selectedDate}`;
      if (dirFilter) url += `&directorate_id=${dirFilter}`;
      return api.get<AttendanceRecord[]>(url);
    },
  });

  const { data: dirData } = useQuery({
    queryKey: ['attendance', 'by-directorate', selectedDate],
    queryFn: () => api.get<DirBreakdown[]>(`/attendance/by-directorate?date=${selectedDate}`),
  });

  const { data: dirsData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });

  const overview = overviewData?.data;
  const records = recordsData?.data ?? [];
  const dirBreakdown = dirData?.data ?? [];
  const directorates = dirsData?.data ?? [];

  const isToday = selectedDate === new Date().toISOString().slice(0, 10);

  function exportAttendanceCSV() {
    const headers = ['Name', 'Staff ID', 'Directorate', 'Clock In', 'Clock Out', 'Late', 'Streak'];
    const rows = records.map(r => [
      r.name,
      r.staff_id ?? '',
      r.directorate_abbr ?? '',
      r.clock_in_time ? formatTime(r.clock_in_time) : 'Absent',
      r.clock_out_time ? formatTime(r.clock_out_time) : '',
      r.is_late ? 'Yes' : 'No',
      String(r.current_streak),
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    downloadCSV(csv, `OHCS-Attendance-${selectedDate}.csv`);
  }

  return (
    <div className="space-y-6">
      {/* Date picker + export */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary" />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="h-10 px-3 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {!isToday && (
            <button
              onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
              className="h-10 px-4 text-[13px] font-medium text-primary border border-primary/20 rounded-xl hover:bg-primary/5 transition-all"
            >
              Today
            </button>
          )}
        </div>
        <button
          onClick={exportAttendanceCSV}
          className="inline-flex items-center gap-2 h-10 px-4 bg-surface text-foreground text-[13px] font-medium rounded-xl border border-border hover:border-accent/40 transition-all"
        >
          <Download className="h-4 w-4 text-accent-warm" />
          Export CSV
        </button>
      </div>

      {/* Overview cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={<Users className="h-4 w-4" />} label="Total Staff" value={overview.total_staff} color="primary" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Clocked In" value={overview.clocked_in} color="success" />
          <StatCard icon={<XCircle className="h-4 w-4" />} label="Not In" value={overview.not_clocked_in} color="danger" />
          <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="Late" value={overview.late_arrivals} color="warning" />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Clocked Out" value={overview.clocked_out} color="muted" />
          <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Rate" value={`${overview.attendance_rate}%`} color="accent" />
        </div>
      )}

      {/* Directorate breakdown */}
      {dirBreakdown.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-4 w-4 text-primary" />
            <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              By Directorate
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {dirBreakdown.filter(d => d.total_staff > 0).map(d => {
              const rate = d.total_staff > 0 ? Math.round((d.present / d.total_staff) * 100) : 0;
              return (
                <div key={d.abbreviation} className="bg-background rounded-xl p-3 border border-border-subtle">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-bold text-primary bg-primary/8 px-2 py-0.5 rounded-md">{d.abbreviation}</span>
                    <span className={cn('text-[13px] font-bold', rate >= 80 ? 'text-success' : rate >= 50 ? 'text-warning' : 'text-danger')}>
                      {rate}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-border rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', rate >= 80 ? 'bg-success' : rate >= 50 ? 'bg-warning' : 'bg-danger')}
                      style={{ width: `${rate}%` }} />
                  </div>
                  <p className="text-[11px] text-muted mt-1.5">{d.present}/{d.total_staff} present{d.late > 0 ? ` · ${d.late} late` : ''}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Records table */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />

        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4.5 w-4.5 text-primary" />
            <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Attendance Records — {formatDate(selectedDate + 'T00:00:00Z')}
            </h3>
          </div>
          <select
            value={dirFilter}
            onChange={e => setDirFilter(e.target.value)}
            className="h-9 px-3 rounded-xl border border-border bg-background text-[13px]"
          >
            <option value="">All Directorates</option>
            {directorates.map(d => (
              <option key={d.id} value={d.id}>{d.abbreviation}</option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-[14px] text-muted">Loading records...</div>
        ) : records.length === 0 ? (
          <div className="p-10 text-center text-[14px] text-muted">No attendance records for this date</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Staff</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Staff ID</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Dir</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Clock In</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Clock Out</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Streak</th>
                  <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Photo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.map(r => (
                  <tr key={r.user_id} className="hover:bg-background-warm/50 transition-colors">
                    <td className="px-5 py-3 text-[15px] font-semibold text-foreground">{r.name}</td>
                    <td className="px-5 py-3 text-[14px] font-mono text-muted">{r.staff_id ?? '—'}</td>
                    <td className="px-5 py-3">
                      {r.directorate_abbr ? (
                        <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-lg">
                          {r.directorate_abbr}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {r.clock_in_time ? (
                        <span className={cn('text-[14px] font-medium', r.is_late ? 'text-danger' : 'text-success')}>
                          {formatTime(r.clock_in_time)}
                        </span>
                      ) : (
                        <span className="text-[14px] text-muted-foreground italic">Absent</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[14px] text-foreground">
                        {r.clock_out_time ? formatTime(r.clock_out_time) : '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {!r.clock_in_time ? (
                        <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-danger/10 text-danger">Absent</span>
                      ) : r.is_late ? (
                        <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-warning/10 text-warning">Late</span>
                      ) : (
                        <span className="inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-full bg-success/10 text-success">On Time</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {r.current_streak > 0 ? (
                        <span className="text-[13px] font-medium text-accent-warm">{r.current_streak}d</span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {r.clock_in_photo ? (
                        <div className="w-8 h-8 rounded-lg overflow-hidden border border-border">
                          <img src={r.clock_in_photo} alt="" className="w-full h-full object-cover" />
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number;
  color: 'primary' | 'success' | 'danger' | 'warning' | 'muted' | 'accent';
}) {
  const colors = {
    primary: 'bg-primary/8 text-primary',
    success: 'bg-success/8 text-success',
    danger: 'bg-danger/8 text-danger',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-foreground/5 text-foreground',
    accent: 'bg-accent/10 text-accent-warm',
  };
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', colors[color])}>
        {icon}
      </div>
      <p className="text-xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{value}</p>
      <p className="text-[12px] text-muted font-medium mt-0.5">{label}</p>
    </div>
  );
}
