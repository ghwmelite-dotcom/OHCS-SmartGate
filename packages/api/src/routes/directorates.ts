import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';

export const directorateRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

directorateRoutes.get('/', async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT * FROM directorates WHERE is_active = 1 ORDER BY abbreviation'
  ).all();
  return success(c, results.results ?? []);
});
