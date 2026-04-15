import type { Context } from 'hono';

export function errorHandler(err: Error, c: Context) {
  console.error(`[ERROR] ${err.message}`, err.stack);
  return c.json({
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: c.env.ENVIRONMENT === 'development' ? err.message : 'An unexpected error occurred',
    },
  }, 500);
}
