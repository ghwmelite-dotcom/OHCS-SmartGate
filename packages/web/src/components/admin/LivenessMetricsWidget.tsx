import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface LivenessMetrics {
  total: number;
  pass_rate: number;
  review_rate: number;
  skipped_rate: number;
  per_challenge: Record<string, { total: number; pass: number }>;
  median_ms: number;
  days: number;
}

export function LivenessMetricsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['liveness-metrics', 7],
    queryFn: () => api.get<LivenessMetrics>('/clock/admin/liveness-metrics?days=7'),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <div className="text-sm text-zinc-500">Loading liveness metrics…</div>;

  const metrics = data?.data;
  if (!metrics || metrics.total === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-4">
      <div className="text-sm font-medium mb-2">Liveness — last {metrics.days} days</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Tile
          label="Pass rate"
          value={pct(metrics.pass_rate)}
          target="≥97%"
          ok={metrics.pass_rate >= 0.97}
        />
        <Tile
          label="Manual reviews"
          value={pct(metrics.review_rate)}
          target="<2%"
          ok={metrics.review_rate < 0.02}
        />
        <Tile
          label="Median latency"
          value={`${metrics.median_ms}ms`}
          target="<2500ms"
          ok={metrics.median_ms < 2500}
        />
        <Tile
          label="Skipped"
          value={pct(metrics.skipped_rate)}
          target="<0.5%"
          ok={metrics.skipped_rate < 0.005}
        />
      </div>
      {Object.keys(metrics.per_challenge).length > 0 && (
        <div className="mt-3 text-xs text-zinc-600">
          Per-challenge:&nbsp;
          {Object.entries(metrics.per_challenge).map(([k, v]) => (
            <span key={k} className="mr-3">
              <span className="font-mono">{k}</span>{' '}
              {pct(v.total ? v.pass / v.total : 0)} ({v.total})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  target,
  ok,
}: {
  label: string;
  value: string;
  target: string;
  ok: boolean;
}) {
  return (
    <div className={`rounded-lg p-2 ${ok ? 'bg-emerald-50' : 'bg-amber-50'}`}>
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="text-lg font-mono">{value}</div>
      <div className="text-[10px] text-zinc-500">target {target}</div>
    </div>
  );
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
