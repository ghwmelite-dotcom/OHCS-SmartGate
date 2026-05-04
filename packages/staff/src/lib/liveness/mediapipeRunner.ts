import type { LandmarkSnapshot } from './challengeDetector';

export interface MediaPipeRunner {
  start(video: HTMLVideoElement, onFrame: (snap: LandmarkSnapshot) => void): void;
  stop(): void;
  ready: Promise<void>;
}

export async function createMediaPipeRunner(): Promise<MediaPipeRunner> {
  // Dynamic import keeps the ~2MB WASM out of the initial bundle.
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');

  const filesetResolver = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
  );

  const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  });

  let raf: number | null = null;
  let onFrameCb: ((snap: LandmarkSnapshot) => void) | null = null;

  function loop(video: HTMLVideoElement) {
    if (video.readyState >= 2) {
      const result = landmarker.detectForVideo(video, performance.now());
      const lm = result.faceLandmarks?.[0];
      const blend = result.faceBlendshapes?.[0]?.categories ?? [];
      if (lm && onFrameCb) {
        const blinkL = blend.find((c) => c.categoryName === 'eyeBlinkLeft')?.score ?? 0;
        const blinkR = blend.find((c) => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
        const smile = blend.find((c) => c.categoryName === 'mouthSmileLeft')?.score ?? 0;
        const snap: LandmarkSnapshot = {
          leftEyeOpenness: 1 - blinkL,
          rightEyeOpenness: 1 - blinkR,
          nosePos: [lm[1]!.x, lm[1]!.y],
          eyeMidpoint: [(lm[33]!.x + lm[263]!.x) / 2, (lm[33]!.y + lm[263]!.y) / 2],
          mouthSpread: Math.abs(lm[61]!.x - lm[291]!.x) + smile * 0.05,
        };
        onFrameCb(snap);
      }
    }
    raf = requestAnimationFrame(() => loop(video));
  }

  return {
    start(video, cb) {
      onFrameCb = cb;
      loop(video);
    },
    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      onFrameCb = null;
      landmarker.close();
    },
    ready: Promise.resolve(),
  };
}
