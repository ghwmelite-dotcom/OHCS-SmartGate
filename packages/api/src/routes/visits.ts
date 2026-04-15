import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { CheckInSchema } from '../lib/validation';
import { success, created, notFound, error } from '../lib/response';
import { z } from 'zod';

export const visitRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const listSchema = z.object({
  date: z.string().optional(),
  status: z.enum(['checked_in', 'checked_out', 'cancelled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

visitRoutes.get('/', zValidator('query', listSchema), async (c) => {
  const { date, status, limit, cursor } = c.req.valid('query');
  let sql = `SELECT v.*, vis.first_name, vis.last_name, vis.organisation, vis.phone,
             o.name as host_name, d.abbreviation as directorate_abbr
             FROM visits v
             JOIN visitors vis ON v.visitor_id = vis.id
             LEFT JOIN officers o ON v.host_officer_id = o.id
             LEFT JOIN directorates d ON v.directorate_id = d.id`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (date) {
    conditions.push('DATE(v.check_in_at) = ?');
    params.push(date);
  }
  if (status) {
    conditions.push('v.status = ?');
    params.push(status);
  }
  if (cursor) {
    conditions.push('v.check_in_at < ?');
    params.push(cursor);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY v.check_in_at DESC LIMIT ?';
  params.push(limit + 1);

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  const rows = results.results ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? (items[items.length - 1] as { check_in_at: string }).check_in_at : undefined;

  return success(c, items, { cursor: nextCursor, hasMore });
});

visitRoutes.get('/active', async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.status = 'checked_in'
     ORDER BY v.check_in_at DESC`
  ).all();

  return success(c, results.results ?? []);
});

visitRoutes.post('/check-in', zValidator('json', CheckInSchema), async (c) => {
  const body = c.req.valid('json');
  const session = c.get('session');

  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(body.visitor_id).first();
  if (!visitor) return notFound(c, 'Visitor');

  const visitId = crypto.randomUUID().replace(/-/g, '');
  const badgeCode = `SG-${Date.now().toString(36).toUpperCase()}`;

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO visits (id, visitor_id, host_officer_id, directorate_id, purpose_raw, purpose_category, badge_code, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'checked_in', ?)`
    ).bind(visitId, body.visitor_id, body.host_officer_id || null, body.directorate_id || null,
           body.purpose_raw || null, body.purpose_category || null, badgeCode, session.userId),

    c.env.DB.prepare(
      `UPDATE visitors SET total_visits = total_visits + 1, last_visit_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
    ).bind(body.visitor_id),
  ]);

  const visit = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.id = ?`
  ).bind(visitId).first();

  return created(c, visit);
});

visitRoutes.post('/:id/check-out', async (c) => {
  const id = c.req.param('id');

  const visit = await c.env.DB.prepare('SELECT id, check_in_at, status FROM visits WHERE id = ?').bind(id).first<{ id: string; check_in_at: string; status: string }>();
  if (!visit) return notFound(c, 'Visit');
  if (visit.status !== 'checked_in') return error(c, 'ALREADY_CHECKED_OUT', 'This visit has already ended', 400);

  const checkOutAt = new Date().toISOString();
  const checkInDate = new Date(visit.check_in_at);
  const durationMinutes = Math.round((new Date(checkOutAt).getTime() - checkInDate.getTime()) / 60000);

  await c.env.DB.prepare(
    `UPDATE visits SET status = 'checked_out', check_out_at = ?, duration_minutes = ? WHERE id = ?`
  ).bind(checkOutAt, durationMinutes, id).run();

  const updated = await c.env.DB.prepare(
    `SELECT v.*, vis.first_name, vis.last_name, vis.organisation,
            o.name as host_name, d.abbreviation as directorate_abbr
     FROM visits v
     JOIN visitors vis ON v.visitor_id = vis.id
     LEFT JOIN officers o ON v.host_officer_id = o.id
     LEFT JOIN directorates d ON v.directorate_id = d.id
     WHERE v.id = ?`
  ).bind(id).first();

  return success(c, updated);
});
