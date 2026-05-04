import { useEffect, useRef, useState } from 'react';
import type { LivenessChallenge, LivenessUiState, FrameBurst } from './types';
import type { LandmarkSnapshot } from './challengeDetector';
import { detectClientChallenge } from './challengeDetector';
import { createMediaPipeRunner, type MediaPipeRunner } from './mediapipeRunner';
import { captureFrameBurst } from './frameBurstEncoder';

interface Props {
  challenge: LivenessChallenge;
  onComplete: (burst: FrameBurst, claimedCompleted: boolean) => void;
  onCameraError: (err: Error) => void;
  onRequestManualReview: () => void;
}

const HINT_BY_CHALLENGE: Record<LivenessChallenge, string> = {
  blink: 'Blink slowly',
  turn_left: 'Turn slightly left',
  turn_right: 'Turn slightly right',
  smile: 'Smile briefly',
};

export function LivenessCapture(props: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const baselineRef = useRef<LandmarkSnapshot | null>(null);
  const completedRef = useRef(false);
  const failedAttemptsRef = useRef(0);
  const [uiState, setUiState] = useState<LivenessUiState>('idle');

  useEffect(() => {
    let cancelled = false;
    let runner: MediaPipeRunner | null = null;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 640 }, facingMode: 'user' },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setUiState('looking-for-face');

        runner = await createMediaPipeRunner();
        if (cancelled) return;

        runner.start(videoRef.current!, (snap) => {
          if (completedRef.current) return;
          if (!baselineRef.current) {
            baselineRef.current = snap;
            setUiState('challenge-active');
            void runCapture();
            return;
          }
          if (detectClientChallenge(props.challenge, baselineRef.current, snap)) {
            setUiState('challenge-detected');
            completedRef.current = true;
          }
        });
      } catch (err) {
        props.onCameraError(err as Error);
      }
    })();

    async function runCapture() {
      try {
        setUiState('capturing');
        const burst = await captureFrameBurst(videoRef.current!);
        props.onComplete(burst, completedRef.current);
      } catch {
        failedAttemptsRef.current += 1;
        setUiState('failed');
      }
    }

    return () => {
      cancelled = true;
      runner?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [props.challenge]);

  const ringColor =
    uiState === 'challenge-detected' ? 'ring-emerald-400'
    : uiState === 'challenge-active' || uiState === 'capturing' ? 'ring-emerald-300'
    : uiState === 'looking-for-face' ? 'ring-zinc-400'
    : 'ring-amber-400';

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/60 [mask:radial-gradient(circle_at_center,transparent_140px,black_141px)]" />
      <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] rounded-full ring-4 ${ringColor} ${uiState === 'challenge-detected' ? '' : 'motion-safe:animate-pulse'}`} />
      <div className="absolute bottom-24 left-0 right-0 text-center text-white text-base font-medium">
        {uiState === 'looking-for-face' && 'Hold steady'}
        {uiState === 'challenge-active' && HINT_BY_CHALLENGE[props.challenge]}
        {uiState === 'challenge-detected' && '✓'}
        {uiState === 'capturing' && ''}
        {uiState === 'failed' && (
          <>
            <div>Having trouble?</div>
            {failedAttemptsRef.current >= 2 && (
              <button
                className="mt-2 underline text-sm text-amber-300"
                onClick={props.onRequestManualReview}
              >
                Submit for HR review →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
