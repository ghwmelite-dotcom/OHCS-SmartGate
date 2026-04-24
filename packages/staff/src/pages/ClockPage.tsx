import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FirstLoginPinPrompt } from '@/components/FirstLoginPinPrompt';
import { BottomNav } from '@/components/BottomNav';
import { AbsenceNoticeButton } from '@/components/AbsenceNoticeButton';
import { LetterReveal } from '@/components/LetterReveal';
import { MagneticButton } from '@/components/MagneticButton';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { api } from '@/lib/api';
import { getToken } from '@/lib/tokenStore';
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

  const [phase, setPhase] = useState<Phase>('idle');
  const [clockType, setClockType] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
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
    mutationFn: async (data: {
      type: string; latitude: number; longitude: number; accuracy: number; photo: Blob | null;
    }) => {
      const { photo, ...clockData } = data;
      const res = await apiOrQueue<ClockResult>('clock-queue', '/clock', clockData);
      if (!('queued' in res) && res.data && photo) {
        const apiBase = import.meta.env.PROD ? 'https://ohcs-smartgate-api.ohcsghana-main.workers.dev' : '';
        const token = getToken();
        try {
          const uploadRes = await fetch(`${apiBase}/api/clock/${res.data.id}/photo`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'image/jpeg',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: await photo.arrayBuffer(),
          });
          if (!uploadRes.ok) console.error('[clock] photo upload failed:', uploadRes.status, await uploadRes.text().catch(() => ''));
        } catch (e) {
          console.error('[clock] photo upload error:', e);
        }
      }
      return res;
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
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
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
    clockMutation.mutate({
      type: clockType,
      latitude: location.lat,
      longitude: location.lng,
      accuracy: location.accuracy,
      photo: photo ?? photoBlob ?? null,
    });
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
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const greetingEmoji = hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showFirstLoginPrompt && <FirstLoginPinPrompt />}
      {/* Header */}
      <div className="relative kente-weave shimmer-sweep" style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)', ['--kente-opacity' as unknown as string]: '0.05' }}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
        <div
          className="flex items-center gap-4 px-5 pb-4"
          style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top, 0px) + 0.25rem))' }}
        >
          <div className="logo-ring w-[52px] h-[52px] flex-shrink-0 relative">
            <div className="w-full h-full rounded-full overflow-hidden ring-1 ring-[#D4A017]/30">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <div
              className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm"
              style={{ background: '#1A7A3A', boxShadow: '0 0 0 2px #0F2E1B' }}
              aria-hidden="true"
            >
              <Clock className="h-[10px] w-[10px] text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-white leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
            <p className="text-[10px] text-[#D4A017]/80 tracking-[0.25em] uppercase mt-0.5">OHCS Clock System</p>
          </div>
        </div>
      </div>

      <div
        className="relative flex-1 flex flex-col items-center px-5 py-6 kente-weave"
        style={{
          ['--kente-opacity' as unknown as string]: '0.025',
          paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 1.5rem)',
        }}
      >
        {/* Greeting */}
        <p className="text-[11px] text-accent-warm tracking-[0.2em] uppercase font-semibold">
          <span aria-hidden="true" className="mr-1.5 not-italic tracking-normal">{greetingEmoji}</span>
          {greeting}
        </p>
        <h2 className="text-[28px] font-bold text-foreground mt-1 leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
          <LetterReveal text={user?.name ?? ''} />
        </h2>
        <span className="underline-flourish w-16 mt-1.5" />

        {/* Streak */}
        {status && status.streak > 0 && (
          <div className="flex items-center gap-2 mt-4 px-4 py-1.5 bg-accent/10 border border-accent/20 rounded-full">
            <span className="flex items-center gap-0.5">
              {Array.from({ length: Math.min(5, status.streak) }).map((_, i) => (
                <Flame key={i} className="h-3.5 w-3.5 text-accent-warm ember" style={{ ['--i' as unknown as string]: i }} />
              ))}
            </span>
            <span className="text-[13px] font-semibold text-accent-warm">{status.streak} day streak</span>
            {status.longest_streak > status.streak && (
              <span className="text-[11px] text-muted ml-1">
                <Trophy className="h-3 w-3 inline" /> Best: {status.longest_streak}
              </span>
            )}
          </div>
        )}

        {/* Today's status */}
        <div className="gold-frame w-full max-w-sm mt-6 bg-surface rounded-2xl border border-border shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <Clock className="h-4 w-4 text-muted" />
              <span className="text-[13px] font-medium text-muted">Today</span>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted uppercase tracking-[0.2em]">In</p>
              <p className={cn(
                'text-[18px] font-bold mt-1 transition-all duration-500',
                status?.clocked_in ? 'text-success' : 'text-muted-foreground',
              )} style={{ fontFamily: "'Playfair Display', serif" }}>
                {status?.clock_in_time ? formatTime(status.clock_in_time) : '--:--'}
              </p>
            </div>
            <div className="w-[1px] bg-gradient-to-b from-transparent via-border to-transparent" />
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted uppercase tracking-[0.2em]">Out</p>
              <p className={cn(
                'text-[18px] font-bold mt-1 transition-all duration-500',
                status?.clocked_out ? 'text-foreground' : 'text-muted-foreground',
              )} style={{ fontFamily: "'Playfair Display', serif" }}>
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
                <MagneticButton
                  onClick={() => startClock('clock_in')}
                  className="group w-full h-20 bg-primary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-[0_14px_30px_rgba(26,77,46,0.3)] ring-1 ring-[#D4A017]/30 hover:ring-[#D4A017]/60 hover:shadow-[0_18px_40px_rgba(212,160,23,0.25)] transition-[box-shadow,ring] duration-300"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogIn className="h-7 w-7 transition-transform duration-300 group-hover:rotate-[15deg]" />
                  Clock In
                </MagneticButton>
              )}
              {canClockOut && (
                <MagneticButton
                  onClick={() => startClock('clock_out')}
                  className="group w-full h-20 bg-secondary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-[0_14px_30px_rgba(139,26,26,0.3)] ring-1 ring-[#D4A017]/30 hover:ring-[#D4A017]/60 hover:shadow-[0_18px_40px_rgba(212,160,23,0.25)] transition-[box-shadow,ring] duration-300"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogOut className="h-7 w-7 transition-transform duration-300 group-hover:rotate-[15deg]" />
                  Clock Out
                </MagneticButton>
              )}
              {!canClockIn && !canClockOut && (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
                  <p className="text-[18px] font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                    🎉 You're done for today
                  </p>
                  <p className="text-[14px] text-muted mt-1">See you tomorrow 👋</p>
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
              <p className="text-[16px] font-semibold text-foreground">📍 Locating you…</p>
              <p className="text-[13px] text-muted mt-1">🛰️ Please allow location access</p>
            </div>
          )}

          {/* PHOTO CAPTURE */}
          {phase === 'photo' && (
            <div className="text-center space-y-4 w-full">
              <p className="text-[15px] font-semibold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                📸 Quick selfie for verification
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
                ⏳ Clocking {clockType === 'clock_in' ? 'in' : 'out'}…
              </p>
              <p className="text-[12px] text-muted mt-1">Securing your record 🔐</p>
            </div>
          )}

          {/* SUCCESS */}
          {phase === 'success' && result && (
            <div className="relative text-center space-y-4 w-full animate-fade-in-up">
              <ConfettiBurst />
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div>
                <p className="text-[20px] font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                  {result.type === 'clock_in' ? '🎉 Clocked In!' : '🏁 Clocked Out!'}
                </p>
                <p className="text-[16px] text-foreground font-medium mt-1">
                  {result.user_name} &middot; {formatTime(result.timestamp)}
                </p>
                <p className="text-[13px] text-muted mt-0.5">🪪 Staff ID: {result.staff_id}</p>
              </div>
              {photoPreview && (
                <div className="w-20 h-20 rounded-2xl overflow-hidden mx-auto border border-border">
                  <img src={photoPreview} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              {result.streak > 1 && (
                <div className="flex items-center justify-center gap-2 px-4 py-2 bg-accent/10 rounded-full">
                  <Flame className="h-4 w-4 text-accent-warm" />
                  <span className="text-[14px] font-bold text-accent-warm">🔥 {result.streak} day streak!</span>
                </div>
              )}
              <button onClick={resetState}
                className="h-10 px-6 text-[14px] font-medium text-primary border border-primary/20 rounded-xl hover:bg-primary/5 transition-all">
                ✅ Done
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
                ⚠️ {errorMsg}
              </p>
              <button onClick={resetState}
                className="h-10 px-6 text-[14px] font-medium text-foreground border border-border rounded-xl hover:bg-background transition-all">
                🔄 Try Again
              </button>
            </div>
          )}
        </div>

        <div className="w-full flex justify-center mt-8">
          <AbsenceNoticeButton />
        </div>

        {/* Footer motto */}
        <div className="relative flex items-center gap-3 mt-6 shimmer-sweep py-2 px-3 rounded-full" style={{ color: '#D4A017' }}>
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-1">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-50 animate-fade-in stagger-2" />
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-3">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-50 animate-fade-in stagger-4" />
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-5">Service</span>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
