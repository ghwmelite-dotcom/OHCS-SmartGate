import type { FaceLandmarks, LivenessChallenge } from './types';

export interface MotionResult {
  completed: boolean;
  delta: number;
}

const THRESHOLDS = {
  blink: 0.015,
  turn_left: 0.04,
  turn_right: 0.04,
  smile: 0.02,
} as const;

function eyeOpenness(face: FaceLandmarks): number {
  // Without iris landmarks we use eye-y vs eye-x as a coarse proxy. Higher
  // y-coordinate (closer to the mouth) on both eyes correlates with a closing
  // eyelid. We compare absolute y-shift between baseline and current frame.
  return (face.leftEye[1] + face.rightEye[1]) / 2;
}

function noseRelative(face: FaceLandmarks): number {
  // Horizontal offset of nose from the midpoint of the eyes.
  // Positive = nose to the right of eye midpoint (image space).
  const eyeMidX = (face.leftEye[0] + face.rightEye[0]) / 2;
  return face.nose[0] - eyeMidX;
}

function mouthSpread(face: FaceLandmarks): number {
  return face.mouthRight[0] - face.mouthLeft[0];
}

export function detectMotion(
  frames: ReadonlyArray<FaceLandmarks | null>,
  challenge: LivenessChallenge,
): MotionResult {
  if (frames.length < 2 || frames.some((f) => f === null)) {
    return { completed: false, delta: 0 };
  }
  const safe = frames as ReadonlyArray<FaceLandmarks>;

  // safe is non-empty (length >= 2 already checked above)
  const first = safe[0]!;
  const last = safe[safe.length - 1]!;

  switch (challenge) {
    case 'blink': {
      const baseline = eyeOpenness(first);
      const peak = Math.max(...safe.slice(1).map(eyeOpenness));
      const delta = Math.abs(peak - baseline);
      return { completed: delta >= THRESHOLDS.blink, delta };
    }
    case 'turn_left': {
      const baseline = noseRelative(first);
      const end = noseRelative(last);
      const delta = end - baseline;
      return { completed: delta >= THRESHOLDS.turn_left, delta: Math.abs(delta) };
    }
    case 'turn_right': {
      const baseline = noseRelative(first);
      const end = noseRelative(last);
      const delta = baseline - end;
      return { completed: delta >= THRESHOLDS.turn_right, delta: Math.abs(delta) };
    }
    case 'smile': {
      const baseline = mouthSpread(first);
      const peak = Math.max(...safe.slice(1).map(mouthSpread));
      const delta = peak - baseline;
      return { completed: delta >= THRESHOLDS.smile, delta };
    }
  }
}
