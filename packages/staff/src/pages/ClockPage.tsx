import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PinChangeButton } from '@/hooks/usePinChange';
import { SettingsMenu } from '@/components/SettingsMenu';
import { FirstLoginPinPrompt } from '@/components/FirstLoginPinPrompt';
import { api } from '@/lib/api';
import { apiOrQueue, type ApiOrQueueResult } from '@/lib/offlineQueue';
import { cn, formatTime } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import {
  LogIn, LogOut, MapPin, Camera, RotateCcw, Check, Flame, Trophy,
  Clock, CheckCircle2, Loader2,
} from 'lucide-react';

interface ClockStatus {
  clocked_in: boolean;
  clocked_out: boolean;
  clock_in_time: string | null;
  clock_out_time: string | null;
  streak: number;
  longest_streak: number;
}

interface ClockResult {
  id: string;
  type: string;
  timestamp: string;
  user_name: string;
  staff_id: string;
  within_geofence: boolean;
  distance_meters: number;
  streak: number;
  longest_streak: number;
}

type Phase = 'idle' | 'locating' | 'photo' | 'submitting' | 'success' | 'error';

export function ClockPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const showFirstLoginPrompt = user ? !user.pin_acknowledged : false;
  const logout = useAuthStore((s) => s.logout);

  const [phase, setPhase] = useState<Phase>('idle');
  const [clockType, setClockType] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ClockResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { data: statusData } = useQuery({
    queryKey: ['clock-status'],
    queryFn: () => api.get<ClockStatus>('/clock/my-status'),
    refetchInterval: 30_000,
  });

  const status = statusData?.data;
  const canClockIn = !status?.clocked_in;
  const canClockOut = status?.clocked_in && !status?.clocked_out;

  const clockMutation = useMutation({
    mutationFn: async (data: { type: string; latitude: number; longitude: number }) => {
      return await apiOrQueue<ClockResult>('clock-queue', '/clock', data);
    },
    onSuccess: async (res: ApiOrQueueResult<ClockResult>) => {
      if ('queued' in res) {
        setResult({
          id: res.id,
          type: clockType,
          timestamp: new Date().toISOString(),
          user_name: user?.name ?? '',
          staff_id: '',
          within_geofence: true,
          distance_meters: 0,
          streak: status?.streak ?? 0,
          longest_streak: status?.longest_streak ?? 0,
        } as ClockResult);
        setPhase('success');
        stopCamera();
        return;
      }
      if (res.data && photoBlob) {
        const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ghwmelite.workers.dev' : '';
        await fetch(`${apiBase}/api/clock/${res.data.id}/photo`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'image/jpeg' },
          body: await photoBlob.arrayBuffer(),
        }).catch(() => {});
      }
      setResult(res.data);
      setPhase('success');
      queryClient.invalidateQueries({ queryKey: ['clock-status'] });
      stopCamera();
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to clock');
      setPhase('error');
      stopCamera();
    },
  });

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'queue-drained') {
        queryClient.invalidateQueries({ queryKey: ['clock-status'] });
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [queryClient]);

  // Get GPS location
  function startClock(type: 'clock_in' | 'clock_out') {
    setClockType(type);
    setPhase('locating');
    setErrorMsg('');
    setPhotoBlob(null);
    setPhotoPreview(null);
    setResult(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        startCamera(type);
      },
      (err) => {
        setErrorMsg(err.code === 1 ? 'Location access denied. Please enable GPS.' : 'Could not get your location. Please try again.');
        setPhase('error');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  // Camera
  const startCamera = useCallback(async (_type: string) => {
    setPhase('photo');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      // Camera failed — proceed without photo
      submitClock();
    }
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) { submitClock(); return; }

    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(300, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 300, 300);

    canvas.toBlob((blob) => {
      if (blob) {
        setPhotoBlob(blob);
        setPhotoPreview(canvas.toDataURL('image/jpeg', 0.8));
      }
      stopCamera();
      submitClock(blob ?? undefined);
    }, 'image/jpeg', 0.8);
  }

  function submitClock(photo?: Blob) {
    if (!location) return;
    if (photo) setPhotoBlob(photo);
    setPhase('submitting');
    clockMutation.mutate({ type: clockType, latitude: location.lat, longitude: location.lng });
  }

  function resetState() {
    setPhase('idle');
    setErrorMsg('');
    setPhotoBlob(null);
    setPhotoPreview(null);
    setResult(null);
    stopCamera();
  }

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good Morning' : now.getHours() < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showFirstLoginPrompt && <FirstLoginPinPrompt />}
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)' }}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg overflow-hidden">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="text-[14px] font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
              <p className="text-[10px] text-[#D4A017]/70 tracking-wide uppercase">OHCS Clock System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SettingsMenu />
            <PinChangeButton />
            <button onClick={logout} className="text-[12px] text-white/50 hover:text-white/80 transition-colors">Sign Out</button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-5 py-6 safe-area-bottom">
        {/* Greeting */}
        <p className="text-[14px] text-muted">{greeting},</p>
        <h2 className="text-[24px] font-bold text-foreground mt-0.5" style={{ fontFamily: "'Playfair Display', serif" }}>
          {user?.name}
        </h2>

        {/* Streak */}
        {status && status.streak > 0 && (
          <div className="flex items-center gap-2 mt-3 px-4 py-1.5 bg-accent/10 rounded-full">
            <Flame className="h-4 w-4 text-accent-warm" />
            <span className="text-[13px] font-semibold text-accent-warm">{status.streak} day streak</span>
            {status.longest_streak > status.streak && (
              <span className="text-[11px] text-muted">
                <Trophy className="h-3 w-3 inline" /> Best: {status.longest_streak}
              </span>
            )}
          </div>
        )}

        {/* Today's status */}
        <div className="w-full max-w-sm mt-6 bg-surface rounded-2xl border border-border shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted" />
              <span className="text-[13px] font-medium text-muted">Today</span>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex-1 text-center">
              <p className="text-[11px] text-muted uppercase tracking-wide">In</p>
              <p className={cn('text-[16px] font-bold mt-0.5', status?.clocked_in ? 'text-success' : 'text-muted-foreground')}>
                {status?.clock_in_time ? formatTime(status.clock_in_time) : '--:--'}
              </p>
            </div>
            <div className="w-[1px] bg-border" />
            <div className="flex-1 text-center">
              <p className="text-[11px] text-muted uppercase tracking-wide">Out</p>
              <p className={cn('text-[16px] font-bold mt-0.5', status?.clocked_out ? 'text-foreground' : 'text-muted-foreground')}>
                {status?.clock_out_time ? formatTime(status.clock_out_time) : '--:--'}
              </p>
            </div>
          </div>
        </div>

        {/* Main action area */}
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mt-6">

          {/* IDLE — show big buttons */}
          {phase === 'idle' && (
            <div className="space-y-4 w-full">
              {canClockIn && (
                <button
                  onClick={() => startClock('clock_in')}
                  className="w-full h-20 bg-primary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-xl shadow-primary/25 hover:bg-primary-light active:scale-[0.98] transition-all"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogIn className="h-7 w-7" />
                  Clock In
                </button>
              )}
              {canClockOut && (
                <button
                  onClick={() => startClock('clock_out')}
                  className="w-full h-20 bg-secondary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-xl shadow-secondary/25 hover:bg-secondary-light active:scale-[0.98] transition-all"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogOut className="h-7 w-7" />
                  Clock Out
                </button>
              )}
              {!canClockIn && !canClockOut && (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
                  <p className="text-[18px] font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                    You're done for today
                  </p>
                  <p className="text-[14px] text-muted mt-1">See you tomorrow!</p>
                </div>
              )}
            </div>
          )}

          {/* LOCATING */}
          {phase === 'locating' && (
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                <MapPin className="h-7 w-7 text-primary" />
              </div>
              <p className="text-[16px] font-semibold text-foreground">Getting your location...</p>
              <p className="text-[13px] text-muted mt-1">Please allow location access</p>
            </div>
          )}

          {/* PHOTO CAPTURE */}
          {phase === 'photo' && (
            <div className="text-center space-y-4 w-full">
              <p className="text-[15px] font-semibold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                Quick selfie for verification
              </p>
              <div className="relative w-48 h-48 mx-auto rounded-3xl overflow-hidden bg-primary-deep">
                <video ref={videoRef} autoPlay playsInline muted
                  className="w-full h-full object-cover scale-x-[-1]" />
                <div className="absolute inset-0 rounded-3xl border-2 border-dashed border-accent/30 pointer-events-none" />
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex gap-3 justify-center">
                <button onClick={() => { stopCamera(); submitClock(); }}
                  className="h-10 px-5 text-[13px] font-medium text-muted border border-border rounded-xl hover:text-foreground transition-all">
                  Skip
                </button>
                <button onClick={capturePhoto}
                  className="h-12 px-8 bg-primary text-white text-[15px] font-bold rounded-2xl shadow-lg shadow-primary/20 active:scale-95 transition-all flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  Capture
                </button>
              </div>
            </div>
          )}

          {/* SUBMITTING */}
          {phase === 'submitting' && (
            <div className="text-center">
              <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
              <p className="text-[16px] font-semibold text-foreground">
                Clocking {clockType === 'clock_in' ? 'in' : 'out'}...
              </p>
            </div>
          )}

          {/* SUCCESS */}
          {phase === 'success' && result && (
            <div className="text-center space-y-4 w-full animate-fade-in-up">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div>
                <p className="text-[20px] font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                  {result.type === 'clock_in' ? 'Clocked In!' : 'Clocked Out!'}
                </p>
                <p className="text-[16px] text-foreground font-medium mt-1">
                  {result.user_name} &middot; {formatTime(result.timestamp)}
                </p>
                <p className="text-[13px] text-muted mt-0.5">Staff ID: {result.staff_id}</p>
              </div>
              {photoPreview && (
                <div className="w-20 h-20 rounded-2xl overflow-hidden mx-auto border border-border">
                  <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              {result.streak > 1 && (
                <div className="flex items-center justify-center gap-2 px-4 py-2 bg-accent/10 rounded-full">
                  <Flame className="h-4 w-4 text-accent-warm" />
                  <span className="text-[14px] font-bold text-accent-warm">{result.streak} day streak!</span>
                </div>
              )}
              <button onClick={resetState}
                className="h-10 px-6 text-[14px] font-medium text-primary border border-primary/20 rounded-xl hover:bg-primary/5 transition-all">
                Done
              </button>
            </div>
          )}

          {/* ERROR */}
          {phase === 'error' && (
            <div className="text-center space-y-4 w-full">
              <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto">
                <MapPin className="h-8 w-8 text-danger" />
              </div>
              <p className="text-[16px] font-bold text-danger" style={{ fontFamily: "'Playfair Display', serif" }}>
                {errorMsg}
              </p>
              <button onClick={resetState}
                className="h-10 px-6 text-[14px] font-medium text-foreground border border-border rounded-xl hover:bg-background transition-all">
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer motto */}
        <div className="flex items-center gap-3 mt-6" style={{ color: '#D4A017' }}>
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-60">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-40" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-60">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-40" />
          <span className="text-[9px] tracking-[0.2em] uppercase font-semibold opacity-60">Service</span>
        </div>
      </div>
    </div>
  );
}
