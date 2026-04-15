import { createMiddleware } from 'hono/factory';
import type { Env, SessionData } from '../types';
import { getSession } from '../services/auth';
import { getCookie } from 'hono/cookie';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: { session: SessionData };
}>(async (c, next) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const session = await getSession(sessionId, c.env);
  if (!session) {
    return c.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, 401);
  }

  c.set('session', session);
  await next();
});
