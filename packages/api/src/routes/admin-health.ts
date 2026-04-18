import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success } from '../lib/response';
import { requireRole } from '../lib/require-role';

export const adminHealthRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const TRACKED_STATUSES = [0, 200, 201, 202, 400, 401, 403, 404, 410, 429, 500, 502, 503];

adminHealthRoutes.get('/push', async (c) => {
  const blocked = requireRole(c, 'superadmin');
  if (blocked) return blocked;

  const today = new Date();
  const days: Array<{ date: string; statuses: Record<string, number> }> = [];

  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(today.getTime() - offset * 86400000);
    const date = d.toISOString().slice(0, 10);
    const statuses: Record<string, number> = {};
    await Promise.all(
      TRACKED_STATUSES.map(async (s) => {
        const raw = await c.env.KV.get(`push-stat:${date}:${s}`);
        if (raw) statuses[String(s)] = parseInt(raw, 10);
      }),
    );
    days.push({ date, statuses });
  }

  return success(c, { days });
});
