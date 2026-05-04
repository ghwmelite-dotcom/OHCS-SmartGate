import { describe, it, expect } from 'vitest';
import { detectClientChallenge, type LandmarkSnapshot } from './challengeDetector';

function snap(over: Partial<LandmarkSnapshot> = {}): LandmarkSnapshot {
  return {
    leftEyeOpenness: 0.5,
    rightEyeOpenness: 0.5,
    nosePos: [0.5, 0.5],
    eyeMidpoint: [0.5, 0.4],
    mouthSpread: 0.10,
    ...over,
  };
}

describe('detectClientChallenge — blink', () => {
  it('fires when both eyes close significantly', () => {
    const baseline = snap();
    const peak = snap({ leftEyeOpenness: 0.10, rightEyeOpenness: 0.10 });
    expect(detectClientChallenge('blink', baseline, peak)).toBe(true);
  });

  it('does not fire on a static look', () => {
    const a = snap();
    expect(detectClientChallenge('blink', a, a)).toBe(false);
  });
});

describe('detectClientChallenge — turn_left', () => {
  it('fires when the nose drifts right of the eye midpoint', () => {
    const baseline = snap({ nosePos: [0.50, 0.50], eyeMidpoint: [0.50, 0.40] });
    const peak = snap({ nosePos: [0.58, 0.50], eyeMidpoint: [0.50, 0.40] });
    expect(detectClientChallenge('turn_left', baseline, peak)).toBe(true);
  });
});

describe('detectClientChallenge — turn_right', () => {
  it('fires when the nose drifts left of the eye midpoint', () => {
    const baseline = snap({ nosePos: [0.50, 0.50], eyeMidpoint: [0.50, 0.40] });
    const peak = snap({ nosePos: [0.42, 0.50], eyeMidpoint: [0.50, 0.40] });
    expect(detectClientChallenge('turn_right', baseline, peak)).toBe(true);
  });
});

describe('detectClientChallenge — smile', () => {
  it('fires when mouth spread increases', () => {
    const baseline = snap({ mouthSpread: 0.10 });
    const peak = snap({ mouthSpread: 0.14 });
    expect(detectClientChallenge('smile', baseline, peak)).toBe(true);
  });
});
