import type { Env } from '../types';

export async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const bucketKey = `rl:${key}`;
  const raw = await env.KV.get(bucketKey);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) {
    return { allowed: false, retryAfter: windowSeconds };
  }
  await env.KV.put(bucketKey, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, retryAfter: 0 };
}
