import { describe, it, expect } from 'vitest';
import { detectMotion } from './motion';
import type { FaceLandmarks, LivenessChallenge } from './types';

function lm(over: Partial<FaceLandmarks> = {}): FaceLandmarks {
  return {
    leftEye: [0.40, 0.40],
    rightEye: [0.60, 0.40],
    nose: [0.50, 0.50],
    mouthLeft: [0.45, 0.65],
    mouthRight: [0.55, 0.65],
    faceConfidence: 0.95,
    ...over,
  };
}

describe('detectMotion — blink', () => {
  it('detects a blink (eye openness drops then recovers)', () => {
    const frames: FaceLandmarks[] = [
      lm({ leftEye: [0.40, 0.40], rightEye: [0.60, 0.40] }),
      lm({ leftEye: [0.40, 0.42], rightEye: [0.60, 0.42] }),
      lm({ leftEye: [0.40, 0.40], rightEye: [0.60, 0.40] }),
    ];
    const result = detectMotion(frames, 'blink');
    expect(result.completed).toBe(true);
    expect(result.delta).toBeGreaterThan(0.015);
  });

  it('rejects a static stare', () => {
    const frames: FaceLandmarks[] = [lm(), lm(), lm()];
    const result = detectMotion(frames, 'blink');
    expect(result.completed).toBe(false);
  });
});

describe('detectMotion — turn_left', () => {
  it('detects a leftward head turn (nose moves right relative to eyes)', () => {
    const frames: FaceLandmarks[] = [
      lm({ nose: [0.50, 0.50] }),
      lm({ nose: [0.55, 0.50] }),
      lm({ nose: [0.58, 0.50] }),
    ];
    const result = detectMotion(frames, 'turn_left');
    expect(result.completed).toBe(true);
    expect(result.delta).toBeGreaterThan(0.04);
  });

  it('rejects a rightward turn when left was requested', () => {
    const frames: FaceLandmarks[] = [
      lm({ nose: [0.50, 0.50] }),
      lm({ nose: [0.45, 0.50] }),
      lm({ nose: [0.42, 0.50] }),
    ];
    const result = detectMotion(frames, 'turn_left');
    expect(result.completed).toBe(false);
  });
});

describe('detectMotion — turn_right', () => {
  it('detects a rightward head turn (nose moves left in image space)', () => {
    const frames: FaceLandmarks[] = [
      lm({ nose: [0.50, 0.50] }),
      lm({ nose: [0.45, 0.50] }),
      lm({ nose: [0.42, 0.50] }),
    ];
    const result = detectMotion(frames, 'turn_right');
    expect(result.completed).toBe(true);
  });
});

describe('detectMotion — smile', () => {
  it('detects a smile (mouth corners spread apart)', () => {
    const frames: FaceLandmarks[] = [
      lm({ mouthLeft: [0.45, 0.65], mouthRight: [0.55, 0.65] }),
      lm({ mouthLeft: [0.43, 0.66], mouthRight: [0.57, 0.66] }),
      lm({ mouthLeft: [0.42, 0.66], mouthRight: [0.58, 0.66] }),
    ];
    const result = detectMotion(frames, 'smile');
    expect(result.completed).toBe(true);
    expect(result.delta).toBeGreaterThan(0.02);
  });

  it('rejects a static neutral mouth', () => {
    const frames: FaceLandmarks[] = [lm(), lm(), lm()];
    const result = detectMotion(frames, 'smile');
    expect(result.completed).toBe(false);
  });
});

describe('detectMotion — missing face', () => {
  it('returns not-completed when any frame lacks landmarks', () => {
    const result = detectMotion([null, null, null], 'blink');
    expect(result.completed).toBe(false);
    expect(result.delta).toBe(0);
  });
});
