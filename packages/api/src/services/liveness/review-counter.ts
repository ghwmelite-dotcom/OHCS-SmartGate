const TTL_SECONDS = 8 * 86400;

/** ISO 8601 calendar week — "YYYY-Www" — in UTC, Monday-to-Sunday. */
export function isoWeekKey(d: Date): string {
  // Algorithm from ISO 8601 §3.5: week 1 is the week containing the first Thursday.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // shift to Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function key(userId: string, d: Date): string {
  return `clock-liveness-review:${userId}:${isoWeekKey(d)}`;
}

export async function getReviewCount(kv: KVNamespace, userId: string, now: Date = new Date()): Promise<number> {
  const raw = await kv.get(key(userId, now));
  return raw ? Number(raw) : 0;
}

export async function incrementReviewCount(
  kv: KVNamespace,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const current = await getReviewCount(kv, userId, now);
  const next = current + 1;
  await kv.put(key(userId, now), String(next), { expirationTtl: TTL_SECONDS });
  return next;
}
