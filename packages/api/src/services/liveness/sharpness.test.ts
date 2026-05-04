import { describe, it, expect } from 'vitest';
import { selectSharpestFrame } from './sharpness';
import type { FrameAnalysis } from './types';

function fa(faceConfidence: number, sharpness = 0): FrameAnalysis {
  return {
    landmarks: {
      leftEye: [0.4, 0.4], rightEye: [0.6, 0.4], nose: [0.5, 0.5],
      mouthLeft: [0.45, 0.65], mouthRight: [0.55, 0.65],
      faceConfidence,
    },
    sharpness,
  };
}

describe('selectSharpestFrame', () => {
  it('picks the frame with the highest faceConfidence', () => {
    const frames = [fa(0.80), fa(0.95), fa(0.85)];
    const idx = selectSharpestFrame(frames);
    expect(idx).toBe(1);
  });

  it('breaks ties by proximity to burst midpoint', () => {
    const frames = [fa(0.95), fa(0.95), fa(0.95)];
    const idx = selectSharpestFrame(frames);
    expect(idx).toBe(1); // middle frame wins on tie
  });

  it('falls back to index 0 when no frame has landmarks', () => {
    const frames: FrameAnalysis[] = [
      { landmarks: null, sharpness: 0 },
      { landmarks: null, sharpness: 0 },
      { landmarks: null, sharpness: 0 },
    ];
    expect(selectSharpestFrame(frames)).toBe(0);
  });
});
