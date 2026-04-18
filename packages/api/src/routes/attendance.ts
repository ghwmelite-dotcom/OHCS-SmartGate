import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendAbsenceNoticePush, type AbsenceNoticeInput } from '../services/reminders';

export const attendanceRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

function requireAdmin(c: { get: (key: 'session') => SessionData }) {
  const role = c.get('session').role;
  return role === 'superadmin' || role === 'admin';
}

// Today's attendance overview
attendanceRoutes.get('/today', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const today = new Date().toISOString().slice(0, 10);

  const [totalStaff, clockedIn, clockedOut, lateArrivals] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1').first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as count FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(today).first<{ count: number }>(),

    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as count FROM clock_records WHERE type = 'clock_out' AND DATE(timestamp) = ?`
    ).bind(today).first<{ count: number }>(),

    // Late = clocked in after 8:30 AM
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as count FROM clock_records
       WHERE type = 'clock_in' AND DATE(timestamp) = ? AND TIME(timestamp) > '08:30:00'`
    ).bind(today).first<{ count: number }>(),
  ]);

  const total = totalStaff?.count ?? 0;
  const present = clockedIn?.count ?? 0;

  return success(c, {
    total_staff: total,
    clocked_in: present,
    clocked_out: clockedOut?.count ?? 0,
    not_clocked_in: total - present,
    late_arrivals: lateArrivals?.count ?? 0,
    attendance_rate: total > 0 ? Math.round((present / total) * 100) : 0,
  });
});

// Today's detailed records
attendanceRoutes.get('/records', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const directorateId = c.req.query('directorate_id');

  let sql = `SELECT u.id as user_id, u.name, u.staff_id, u.role,
                    d.abbreviation as directorate_abbr,
                    ci.timestamp as clock_in_time, co.timestamp as clock_out_time,
                    ci.photo_url as clock_in_photo,
                    CASE WHEN TIME(ci.timestamp) > '08:30:00' THEN 1 ELSE 0 END as is_late,
                    u.current_streak
             FROM users u
             LEFT JOIN directorates d ON u.directorate_id = d.id
             LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
             LEFT JOIN clock_records co ON co.user_id = u.id AND co.type = 'clock_out' AND DATE(co.timestamp) = ?
             WHERE u.is_active = 1`;
  const params: unknown[] = [date, date];

  if (directorateId) {
    sql += ' AND u.directorate_id = ?';
    params.push(directorateId);
  }

  sql += ' ORDER BY ci.timestamp ASC, u.name ASC';

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

// Directorate breakdown
attendanceRoutes.get('/by-directorate', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);

  const results = await c.env.DB.prepare(
    `SELECT d.abbreviation, d.name,
            COUNT(DISTINCT u.id) as total_staff,
            COUNT(DISTINCT ci.user_id) as present,
            COUNT(DISTINCT CASE WHEN TIME(ci.timestamp) > '08:30:00' THEN ci.user_id END) as late
     FROM directorates d
     LEFT JOIN users u ON u.directorate_id = d.id AND u.is_active = 1
     LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
     WHERE d.is_active = 1
     GROUP BY d.id
     ORDER BY d.abbreviation`
  ).bind(date).all();

  return success(c, results.results ?? []);
});

// Monthly summary for a user
attendanceRoutes.get('/user/:userId/monthly', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);

  const userId = c.req.param('userId');
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7); // YYYY-MM

  const records = await c.env.DB.prepare(
    `SELECT DATE(timestamp) as date, type, TIME(timestamp) as time
     FROM clock_records WHERE user_id = ? AND strftime('%Y-%m', timestamp) = ?
     ORDER BY timestamp`
  ).bind(userId, month).all();

  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(userId).first();

  // Group by date
  const days: Record<string, { clock_in?: string; clock_out?: string; is_late: boolean }> = {};
  for (const r of (records.results ?? []) as Array<{ date: string; type: string; time: string }>) {
    if (!days[r.date]) days[r.date] = { is_late: false };
    if (r.type === 'clock_in') {
      days[r.date]!.clock_in = r.time;
      days[r.date]!.is_late = r.time > '08:30:00';
    }
    if (r.type === 'clock_out') days[r.date]!.clock_out = r.time;
  }

  const totalDays = Object.keys(days).length;
  const lateDays = Object.values(days).filter(d => d.is_late).length;

  return success(c, {
    user,
    month,
    total_days_present: totalDays,
    late_days: lateDays,
    on_time_days: totalDays - lateDays,
    daily_records: days,
  });
});

// Leave requests
const leaveSchema = z.object({
  type: z.enum(['annual', 'sick', 'permission', 'compassionate', 'maternity', 'study']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).optional(),
});

attendanceRoutes.post('/leave', zValidator('json', leaveSchema), async (c) => {
  const session = c.get('session');
  const body = c.req.valid('json');
  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    'INSERT INTO leave_requests (id, user_id, type, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, session.userId, body.type, body.start_date, body.end_date, body.reason || null).run();

  return success(c, { id, status: 'pending' });
});

attendanceRoutes.get('/leave', async (c) => {
  const session = c.get('session');
  const isAdmin = session.role === 'superadmin' || session.role === 'admin';

  let sql: string;
  const params: unknown[] = [];

  if (isAdmin) {
    sql = `SELECT lr.*, u.name, u.staff_id FROM leave_requests lr JOIN users u ON lr.user_id = u.id ORDER BY lr.created_at DESC LIMIT 50`;
  } else {
    sql = `SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`;
    params.push(session.userId);
  }

  const results = await c.env.DB.prepare(sql).bind(...params).all();
  return success(c, results.results ?? []);
});

attendanceRoutes.post('/leave/:id/approve', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const id = c.req.param('id');
  const session = c.get('session');

  await c.env.DB.prepare(
    "UPDATE leave_requests SET status = 'approved', approved_by = ? WHERE id = ?"
  ).bind(session.userId, id).run();

  return success(c, { message: 'Leave approved' });
});

attendanceRoutes.post('/leave/:id/reject', async (c) => {
  if (!requireAdmin(c)) return error(c, 'FORBIDDEN', 'Admin access required', 403);
  const id = c.req.param('id');
  const session = c.get('session');

  await c.env.DB.prepare(
    "UPDATE leave_requests SET status = 'rejected', approved_by = ? WHERE id = ?"
  ).bind(session.userId, id).run();

  return success(c, { message: 'Leave rejected' });
});

const absenceNoticeSchema = z.object({
  reason: z.enum(['sick', 'family_emergency', 'transport', 'other']),
  note: z.string().max(200).optional(),
  expected_return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

attendanceRoutes.post('/absence-notice', zValidator('json', absenceNoticeSchema), async (c) => {
  const session = c.get('session');
  const body = c.req.valid('json');
  const today = new Date().toISOString().slice(0, 10);

  if (body.expected_return_date && body.expected_return_date < today) {
    return error(c, 'INVALID_DATE', 'expected_return_date cannot be in the past', 400);
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  await c.env.DB.prepare(
    `INSERT INTO absence_notices (id, user_id, reason, note, notice_date, expected_return_date)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, session.userId, body.reason, body.note ?? null, today, body.expected_return_date ?? null).run();

  const notice: AbsenceNoticeInput = {
    id,
    user_id: session.userId,
    reason: body.reason,
    note: body.note ?? null,
    notice_date: today,
    expected_return_date: body.expected_return_date ?? null,
  };

  c.executionCtx.waitUntil(sendAbsenceNoticePush(c.env, notice));

  return success(c, notice);
});

attendanceRoutes.get('/absence-notice/today', async (c) => {
  const session = c.get('session');
  const today = new Date().toISOString().slice(0, 10);

  const row = await c.env.DB.prepare(
    `SELECT id, user_id, reason, note, notice_date, expected_return_date, created_at
     FROM absence_notices
     WHERE user_id = ?
       AND ? BETWEEN notice_date AND COALESCE(expected_return_date, notice_date)
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(session.userId, today).first();

  return success(c, row ?? null);
});
