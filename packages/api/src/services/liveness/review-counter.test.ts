import { describe, it, expect, vi } from 'vitest';
import { isoWeekKey, getReviewCount, incrementReviewCount } from './review-counter';

function mockKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace;
}

describe('isoWeekKey', () => {
  it('produces "YYYY-Www" format for a known date', () => {
    // 2026-05-04 is a Monday — the start of ISO week 19 of 2026.
    const d = new Date('2026-05-04T12:00:00Z');
    expect(isoWeekKey(d)).toBe('2026-W19');
  });

  it('rolls forward at midnight UTC Sunday→Monday', () => {
    const sunday = new Date('2026-05-10T23:59:59Z');
    const monday = new Date('2026-05-11T00:00:01Z');
    expect(isoWeekKey(sunday)).toBe('2026-W19');
    expect(isoWeekKey(monday)).toBe('2026-W20');
  });
});

describe('getReviewCount', () => {
  it('returns 0 for a missing key', async () => {
    const kv = mockKv();
    const n = await getReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(n).toBe(0);
  });

  it('returns the stored count', async () => {
    const kv = mockKv({ 'clock-liveness-review:user-1:2026-W19': '2' });
    const n = await getReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(n).toBe(2);
  });
});

describe('incrementReviewCount', () => {
  it('writes 1 on first increment with 8-day TTL', async () => {
    const kv = mockKv();
    const next = await incrementReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(next).toBe(1);
    expect(kv.put).toHaveBeenCalledWith(
      'clock-liveness-review:user-1:2026-W19',
      '1',
      { expirationTtl: 8 * 86400 },
    );
  });

  it('increments an existing count', async () => {
    const kv = mockKv({ 'clock-liveness-review:user-1:2026-W19': '1' });
    const next = await incrementReviewCount(kv, 'user-1', new Date('2026-05-04T12:00:00Z'));
    expect(next).toBe(2);
  });
});
