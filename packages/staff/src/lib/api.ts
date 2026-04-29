import { getToken } from './tokenStore';

const API_BASE = import.meta.env.PROD
  ? 'https://ohcs-smartgate-api.ohcsghana-main.workers.dev/api'
  : '/api';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  const json = await res.json() as ApiResponse<T>;
  if (!res.ok || json.error) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.location.href = '/login';
    throw new ApiError(json.error?.code ?? 'UNKNOWN', json.error?.message ?? 'Error', res.status);
  }
  return json;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }),
};

// ---- Clock-in re-auth + liveness helpers ----

export interface ClockPrompt {
  promptId: string;
  promptValue: string;
  expiresAt: number;
}

/** Issue a fresh single-use prompt for the next clock-in. */
export async function fetchClockPrompt(): Promise<ClockPrompt> {
  const res = await api.post<{ prompt_id: string; prompt_value: string; expires_at: number }>('/clock/prompt');
  if (!res.data) throw new Error('Empty prompt response');
  return {
    promptId: res.data.prompt_id,
    promptValue: res.data.prompt_value,
    expiresAt: res.data.expires_at,
  };
}

export interface ClockSubmission {
  type: 'clock_in' | 'clock_out';
  latitude: number;
  longitude: number;
  accuracy?: number;
  idempotencyKey?: string;
  promptId?: string;
  webauthnAssertion?: unknown;   // AuthenticationResponseJSON from @simplewebauthn/browser
  pin?: string;
}

export interface ClockResult {
  id: string;
  type: 'clock_in' | 'clock_out';
  timestamp: string;
  user_name: string;
  staff_id: string;
  within_geofence: boolean;
  distance_meters: number;
  streak: number;
  longest_streak: number;
  deduplicated?: boolean;
}

/** Submit a clock-in/out with optional re-auth + prompt fields. */
export async function submitClock(input: ClockSubmission): Promise<ClockResult> {
  const res = await api.post<ClockResult>('/clock/', {
    type: input.type,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracy: input.accuracy,
    idempotency_key: input.idempotencyKey,
    prompt_id: input.promptId,
    webauthn_assertion: input.webauthnAssertion,
    pin: input.pin,
  });
  if (!res.data) throw new Error('Empty clock response');
  return res.data;
}
