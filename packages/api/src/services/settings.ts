import type { Env } from '../types';

export interface AppSettings {
  work_start_time: string;      // "HH:MM"
  late_threshold_time: string;  // "HH:MM"
  work_end_time: string;        // "HH:MM"
  updated_by: string | null;
  updated_at: string;
}

const KV_KEY = 'app-settings:v1';
const KV_TTL = 300;          // 5 min KV cache
const MEMO_TTL_MS = 60_000;  // 60s per-isolate memo

const DEFAULTS: AppSettings = {
  work_start_time: '08:00',
  late_threshold_time: '08:30',
  work_end_time: '17:00',
  updated_by: null,
  updated_at: '1970-01-01T00:00:00Z',
};

let memo: { value: AppSettings; ts: number } | null = null;

export async function getAppSettings(env: Env): Promise<AppSettings> {
  const now = Date.now();
  if (memo && now - memo.ts < MEMO_TTL_MS) return memo.value;

  const cached = await env.KV.get(KV_KEY, 'json') as AppSettings | null;
  if (cached) {
    memo = { value: cached, ts: now };
    return cached;
  }

  const row = await env.DB.prepare(
    'SELECT work_start_time, late_threshold_time, work_end_time, updated_by, updated_at FROM app_settings WHERE id = 1'
  ).first<AppSettings>();

  const settings = row ?? DEFAULTS;
  await env.KV.put(KV_KEY, JSON.stringify(settings), { expirationTtl: KV_TTL });
  memo = { value: settings, ts: now };
  return settings;
}

export async function invalidateSettingsCache(env: Env): Promise<void> {
  memo = null;
  await env.KV.delete(KV_KEY);
}

// "HH:MM" → "HH:MM:00" for SQLite TIME() comparison
export function toSqlTime(hhmm: string): string {
  return `${hhmm}:00`;
}

// "HH:MM" → minutes since midnight
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
