import { describe, it, expect, vi } from 'vitest';
import { analyzeFrame } from './ai';

function mockAi(response: unknown) {
  return { run: vi.fn().mockResolvedValue(response) } as unknown as Ai;
}

describe('analyzeFrame', () => {
  it('returns landmarks for a successful detection', async () => {
    const ai = mockAi({
      faces: [{
        bbox: [0.2, 0.2, 0.8, 0.8],
        score: 0.97,
        kps: [
          [0.40, 0.40], [0.60, 0.40], [0.50, 0.50],
          [0.45, 0.65], [0.55, 0.65],
        ],
      }],
    });
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks).not.toBeNull();
    expect(result.landmarks?.faceConfidence).toBeCloseTo(0.97);
    expect(result.landmarks?.nose).toEqual([0.50, 0.50]);
  });

  it('returns null landmarks when no face detected', async () => {
    const ai = mockAi({ faces: [] });
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks).toBeNull();
  });

  it('returns null landmarks on AI error', async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error('AI down')) } as unknown as Ai;
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks).toBeNull();
  });

  it('picks the face with the highest score when multiple are detected', async () => {
    const ai = mockAi({
      faces: [
        { bbox: [0,0,0.3,0.3], score: 0.60, kps: [[0.1,0.1],[0.2,0.1],[0.15,0.15],[0.12,0.18],[0.18,0.18]] },
        { bbox: [0.4,0.4,0.9,0.9], score: 0.97, kps: [[0.5,0.5],[0.7,0.5],[0.6,0.6],[0.55,0.7],[0.65,0.7]] },
      ],
    });
    const result = await analyzeFrame(ai, new ArrayBuffer(64));
    expect(result.landmarks?.faceConfidence).toBeCloseTo(0.97);
  });
});
