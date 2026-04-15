import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, notFound } from '../lib/response';

export const officerRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

officerRoutes.get('/', async (c) => {
  const directorateId = c.req.query('directorate_id');
  let sql = `SELECT o.*, d.name as directorate_name, d.abbreviation as directorate_abbr
             FROM officers o
             JOIN directorates d ON o.directorate_id = d.id`;
  const params: unknown[] = [];

  if (directorateId) {
    sql += ' WHERE o.directorate_id = ?';
    params.push(directorateId);
  }
  sql += ' ORDER BY d.abbreviation, o.name';

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

officerRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const officer = await c.env.DB.prepare(
    `SELECT o.*, d.name as directorate_name, d.abbreviation as directorate_abbr
     FROM officers o JOIN directorates d ON o.directorate_id = d.id WHERE o.id = ?`
  ).bind(id).first();
  if (!officer) return notFound(c, 'Officer');
  return success(c, officer);
});
