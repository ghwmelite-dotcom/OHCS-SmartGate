import { describe, it, expect, vi } from 'vitest';
import { verifyLivenessBurst } from './index';

function mockAi(perFrameResponses: unknown[]) {
  let i = 0;
  return {
    run: vi.fn(async () => perFrameResponses[i++] ?? { faces: [] }),
  } as unknown as Ai;
}

const PASSING_BLINK = [
  { faces: [{ bbox: [0,0,1,1], score: 0.95, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
  { faces: [{ bbox: [0,0,1,1], score: 0.93, kps: [[0.40,0.42],[0.60,0.42],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
  { faces: [{ bbox: [0,0,1,1], score: 0.96, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }] },
];

const STATIC_FRAMES = Array(3).fill({
  faces: [{ bbox: [0,0,1,1], score: 0.92, kps: [[0.40,0.40],[0.60,0.40],[0.50,0.50],[0.45,0.65],[0.55,0.65]] }],
});

const f = (n: number) => new ArrayBuffer(n);

describe('verifyLivenessBurst', () => {
  it('returns pass when challenge is completed', async () => {
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(true);
    expect(result.decision).toBe('pass');
    expect(result.signature.challenge_completed).toBe(true);
    expect(result.signature.model_version).toBe('buffalo_s_v1');
    expect(result.canonicalFrame).toBeInstanceOf(ArrayBuffer);
  });

  it('returns fail when no motion detected', async () => {
    const ai = mockAi(STATIC_FRAMES);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
    expect(result.signature.challenge_completed).toBe(false);
  });

  it('returns skipped on AI error', async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error('AI down')) } as unknown as Ai;
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.decision).toBe('skipped');
    expect(result.pass).toBe(false);
  });

  it('rejects fewer than 3 frames', async () => {
    const ai = mockAi([]);
    await expect(verifyLivenessBurst({
      ai,
      frames: [f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    })).rejects.toThrow('exactly 3 frames');
  });

  it('records ms_total', async () => {
    const ai = mockAi(PASSING_BLINK);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.signature.ms_total).toBeGreaterThanOrEqual(0);
  });

  it('returns fail with all-null landmarks (no face detected anywhere)', async () => {
    const ai = mockAi([{ faces: [] }, { faces: [] }, { faces: [] }]);
    const result = await verifyLivenessBurst({
      ai,
      frames: [f(64), f(64), f(64)],
      challenge: 'blink',
      modelVersion: 'buffalo_s_v1',
    });
    expect(result.pass).toBe(false);
    expect(result.decision).toBe('fail');
    expect(result.signature.face_score).toBe(0);
  });
});
