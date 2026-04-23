import { useState } from 'react';
import { api, resolvePhotoUrl } from '@/lib/api';
import { cn, formatDate, formatTime } from '@/lib/utils';
import { Search, ShieldCheck, ShieldX, User, Building2, Clock, MapPin } from 'lucide-react';

interface BadgeData {
  badge_code: string;
  status: string;
  visitor_name: string;
  organisation: string | null;
  photo_url: string | null;
  host_name: string | null;
  directorate: string | null;
  directorate_abbr: string | null;
  floor: string | null;
  wing: string | null;
  check_in_at: string;
  check_out_at: string | null;
}

export function VerifyBadgePage() {
  const [code, setCode] = useState('');
  const [badge, setBadge] = useState<BadgeData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setIsLoading(true);
    setNotFound(false);
    setBadge(null);

    try {
      const res = await api.get<BadgeData>(`/badges/${trimmed}`);
      setBadge(res.data);
    } catch {
      setNotFound(true);
    } finally {
      setIsLoading(false);
    }
  }

  function reset() {
    setCode('');
    setBadge(null);
    setNotFound(false);
  }

  const isActive = badge?.status === 'checked_in';

  return (
    <div className="min-h-screen bg-background bg-kente flex flex-col">
      {/* Header bar */}
      <div className="shrink-0" style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)' }}>
        <div className="h-[2px]" style={{
          background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
        }} />
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="w-9 h-9 rounded-lg overflow-hidden">
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-[15px] font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              SmartGate Security
            </h1>
            <p className="text-[10px] text-[#D4A017]/70 tracking-wide uppercase">Badge Verification</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-5">
        <div className="w-full max-w-md space-y-5">

          {/* Search form */}
          <form onSubmit={handleVerify} className="space-y-3">
            <label className="block text-[13px] font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Enter Badge Code
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SG-XXXXXXXX"
                className="flex-1 h-14 px-4 rounded-2xl border border-border bg-surface text-[18px] font-mono font-bold tracking-wider text-foreground text-center uppercase focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                autoFocus
              />
              <button
                type="submit"
                disabled={isLoading || !code.trim()}
                className="h-14 w-14 bg-primary text-white rounded-2xl flex items-center justify-center hover:bg-primary-light disabled:opacity-50 transition-all shadow-lg shadow-primary/15 active:scale-95 shrink-0"
              >
                {isLoading
                  ? <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Search className="h-5 w-5" />
                }
              </button>
            </div>
          </form>

          {/* Not found */}
          {notFound && (
            <div className="bg-danger-light border border-danger/20 rounded-2xl p-6 text-center animate-fade-in-up">
              <ShieldX className="h-10 w-10 text-danger mx-auto mb-3" />
              <p className="text-[16px] font-bold text-danger" style={{ fontFamily: 'var(--font-display)' }}>
                Badge Not Found
              </p>
              <p className="text-[14px] text-muted mt-1">
                No visitor badge matches "{code}". Check the code and try again.
              </p>
              <button onClick={reset} className="mt-4 h-10 px-5 text-[14px] font-medium text-danger border border-danger/20 rounded-xl hover:bg-danger/5 transition-all">
                Try Again
              </button>
            </div>
          )}

          {/* Badge result */}
          {badge && (
            <div className="bg-surface rounded-2xl border border-border shadow-lg overflow-hidden animate-fade-in-up">
              {/* Status banner */}
              <div className={cn(
                'px-5 py-3 flex items-center gap-3',
                isActive ? 'bg-success/10' : 'bg-foreground/5'
              )}>
                {isActive
                  ? <ShieldCheck className="h-6 w-6 text-success" />
                  : <ShieldX className="h-6 w-6 text-muted-foreground" />
                }
                <div>
                  <p className={cn(
                    'text-[16px] font-bold',
                    isActive ? 'text-success' : 'text-muted-foreground'
                  )} style={{ fontFamily: 'var(--font-display)' }}>
                    {isActive ? 'ACTIVE VISITOR' : 'VISIT ENDED'}
                  </p>
                  <p className="text-[12px] text-muted">{badge.badge_code}</p>
                </div>
              </div>

              <div className="p-5 space-y-4">
                {/* Visitor info */}
                <div className="flex items-center gap-4">
                  {badge.photo_url ? (
                    <div className="w-16 h-16 rounded-2xl overflow-hidden border border-border shrink-0">
                      <img src={resolvePhotoUrl(badge.photo_url)!} alt="" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-xl font-bold shrink-0">
                      <User className="h-7 w-7" />
                    </div>
                  )}
                  <div>
                    <p className="text-[20px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                      {badge.visitor_name}
                    </p>
                    {badge.organisation && (
                      <p className="text-[14px] text-muted">{badge.organisation}</p>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-2.5 pt-2">
                  {badge.host_name && (
                    <DetailRow icon={<User className="h-4 w-4" />} label="Host" value={badge.host_name} />
                  )}
                  {badge.directorate && (
                    <DetailRow icon={<Building2 className="h-4 w-4" />} label="Directorate" value={`${badge.directorate_abbr} — ${badge.directorate}`} />
                  )}
                  {(badge.floor || badge.wing) && (
                    <DetailRow icon={<MapPin className="h-4 w-4" />} label="Location" value={`${badge.floor ?? ''}${badge.wing ? `, ${badge.wing} Wing` : ''}`} />
                  )}
                  <DetailRow icon={<Clock className="h-4 w-4" />} label="Check In" value={`${formatDate(badge.check_in_at)} at ${formatTime(badge.check_in_at)}`} />
                  {badge.check_out_at && (
                    <DetailRow icon={<Clock className="h-4 w-4" />} label="Check Out" value={`${formatDate(badge.check_out_at)} at ${formatTime(badge.check_out_at)}`} />
                  )}
                </div>
              </div>

              {/* Verify another */}
              <div className="px-5 py-3 border-t border-border">
                <button onClick={reset} className="w-full h-10 text-[14px] font-medium text-primary hover:bg-primary/5 rounded-xl transition-all">
                  Verify Another Badge
                </button>
              </div>
            </div>
          )}

          {/* Help text when empty */}
          {!badge && !notFound && !isLoading && (
            <div className="text-center pt-4">
              <ShieldCheck className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[14px] text-muted">
                Ask the visitor for their badge code and enter it above
              </p>
              <p className="text-[12px] text-muted-foreground mt-1">
                Badge codes start with "SG-"
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 py-3 text-center">
        <p className="text-[10px] text-muted-foreground">
          OHCS SmartGate Security Verification
        </p>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted">{icon}</span>
      <span className="text-[12px] text-muted font-medium min-w-[80px]">{label}</span>
      <span className="text-[15px] text-foreground font-medium">{value}</span>
    </div>
  );
}
