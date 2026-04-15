import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { CreateVisitorSchema, UpdateVisitorSchema } from '../lib/validation';
import { success, created, notFound } from '../lib/response';
import { z } from 'zod';

export const visitorRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const searchSchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

visitorRoutes.get('/', zValidator('query', searchSchema), async (c) => {
  const { q, limit, cursor } = c.req.valid('query');
  let sql = 'SELECT * FROM visitors';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (q && q.length > 0) {
    conditions.push('(first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR organisation LIKE ?)');
    const pattern = `%${q}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  if (cursor) {
    conditions.push('created_at < ?');
    params.push(cursor);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit + 1);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = results.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1] as { created_at: string }).created_at : undefined;

  return success(c, items, { cursor: nextCursor, hasMore });
});

visitorRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  if (!visitor) return notFound(c, 'Visitor');

  const visits = await c.env.DB.prepare(
    `SELECT v.*, o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.visitor_id = ?
     ORDER BY v.check_in_at DESC LIMIT 20`
  ).bind(id).all();

  return success(c, { ...visitor, visits: visits.results ?? [] });
});

visitorRoutes.post('/', zValidator('json', CreateVisitorSchema), async (c) => {
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    `INSERT INTO visitors (id, first_name, last_name, phone, email, organisation, id_type, id_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.first_name, body.last_name, body.phone || null, body.email || null, body.organisation || null, body.id_type || null, body.id_number || null).run();

  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  return created(c, visitor);
});

visitorRoutes.put('/:id', zValidator('json', UpdateVisitorSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(id).first();
  if (!existing) return notFound(c, 'Visitor');

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value || null);
    }
  }
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  if (fields.length > 1) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE visitors SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  const visitor = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(id).first();
  return success(c, visitor);
});
