import type { Context } from 'hono';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  meta?: { cursor?: string; hasMore?: boolean; total?: number };
}

export function success<T>(c: Context, data: T, meta?: ApiResponse<T>['meta'], status = 200) {
  return c.json<ApiResponse<T>>({ data, error: null, meta }, status);
}

export function created<T>(c: Context, data: T) {
  return success(c, data, undefined, 201);
}

export function error(c: Context, code: string, message: string, status = 400, details?: unknown) {
  return c.json<ApiResponse<null>>({ data: null, error: { code, message, details } }, status);
}

export function notFound(c: Context, resource = 'Resource') {
  return error(c, 'NOT_FOUND', `${resource} not found`, 404);
}
