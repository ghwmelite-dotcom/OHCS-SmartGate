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
