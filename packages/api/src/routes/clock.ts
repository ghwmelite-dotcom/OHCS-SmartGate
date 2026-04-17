import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';

export const clockRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// OHCS Building geofence — exact location (Office of The Head of Civil Service, Accra)
const GEOFENCE = {
  lat: 5.5526925,
  lng: -0.1974803,
  radiusMeters: 150,
};

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Clock in or out
const clockSchema = z.object({
  type: z.enum(['clock_in', 'clock_out']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

clockRoutes.post('/', zValidator('json', clockSchema), async (c) => {
  const session = c.get('session');
  const { type, latitude, longitude } = c.req.valid('json');

  // Check geofence
  const distance = haversineDistance(latitude, longitude, GEOFENCE.lat, GEOFENCE.lng);
  const withinGeofence = distance <= GEOFENCE.radiusMeters;

  if (!withinGeofence) {
    return error(c, 'OUTSIDE_GEOFENCE', `You are ${Math.round(distance)}m from OHCS. Please be within ${GEOFENCE.radiusMeters}m to clock ${type === 'clock_in' ? 'in' : 'out'}.`, 400);
  }

  // Check if already clocked in/out today
  const today = new Date().toISOString().slice(0, 10);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM clock_records WHERE user_id = ? AND type = ? AND DATE(timestamp) = ?`
  ).bind(session.userId, type, today).first();

  if (existing) {
    return error(c, 'ALREADY_CLOCKED', `You have already clocked ${type === 'clock_in' ? 'in' : 'out'} today.`, 400);
  }

  // If clocking out, must have clocked in first
  if (type === 'clock_out') {
    const clockedIn = await c.env.DB.prepare(
      `SELECT id FROM clock_records WHERE user_id = ? AND type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(session.userId, today).first();
    if (!clockedIn) {
      return error(c, 'NOT_CLOCKED_IN', 'You must clock in before clocking out.', 400);
    }
  }

  const id = crypto.randomUUID().replace(/-/g, '');

  await c.env.DB.prepare(
    `INSERT INTO clock_records (id, user_id, type, latitude, longitude, within_geofence)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, session.userId, type, latitude, longitude, withinGeofence ? 1 : 0).run();

  // Update streak on clock-in
  if (type === 'clock_in') {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const yesterdayRecord = await c.env.DB.prepare(
      `SELECT id FROM clock_records WHERE user_id = ? AND type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(session.userId, yesterday).first();

    if (yesterdayRecord) {
      // Consecutive day — increment streak
      await c.env.DB.prepare(
        `UPDATE users SET current_streak = current_streak + 1,
         longest_streak = MAX(longest_streak, current_streak + 1) WHERE id = ?`
      ).bind(session.userId).run();
    } else {
      // Streak broken — reset to 1
      await c.env.DB.prepare(
        `UPDATE users SET current_streak = 1,
         longest_streak = MAX(longest_streak, 1) WHERE id = ?`
      ).bind(session.userId).run();
    }
  }

  // Get updated user for response
  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(session.userId).first<{ name: string; staff_id: string; current_streak: number; longest_streak: number }>();

  console.log(`[CLOCK] ${user?.name} (${user?.staff_id}) — ${type} at ${new Date().toISOString()}`);

  return success(c, {
    id,
    type,
    timestamp: new Date().toISOString(),
    user_name: user?.name ?? session.name,
    staff_id: user?.staff_id ?? '',
    within_geofence: withinGeofence,
    distance_meters: Math.round(distance),
    streak: user?.current_streak ?? 0,
    longest_streak: user?.longest_streak ?? 0,
  });
});

// Upload clock photo
clockRoutes.post('/:id/photo', async (c) => {
  const session = c.get('session');
  const clockId = c.req.param('id');

  const record = await c.env.DB.prepare(
    'SELECT id FROM clock_records WHERE id = ? AND user_id = ?'
  ).bind(clockId, session.userId).first();
  if (!record) return error(c, 'NOT_FOUND', 'Clock record not found', 404);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY', 'No photo', 400);
  if (body.byteLength > 500_000) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);

  const key = `photos/clock/${clockId}.jpg`;
  await c.env.STORAGE.put(key, body, { httpMetadata: { contentType: 'image/jpeg' } });

  const photoUrl = `/api/photos/clock/${clockId}`;
  await c.env.DB.prepare('UPDATE clock_records SET photo_url = ? WHERE id = ?').bind(photoUrl, clockId).run();

  return success(c, { photo_url: photoUrl });
});

// Get my status today
clockRoutes.get('/my-status', async (c) => {
  const session = c.get('session');
  const today = new Date().toISOString().slice(0, 10);

  const records = await c.env.DB.prepare(
    `SELECT type, timestamp FROM clock_records WHERE user_id = ? AND DATE(timestamp) = ? ORDER BY timestamp`
  ).bind(session.userId, today).all();

  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(session.userId).first<{ name: string; staff_id: string; current_streak: number; longest_streak: number }>();

  const clockIn = (records.results ?? []).find((r: Record<string, unknown>) => r.type === 'clock_in');
  const clockOut = (records.results ?? []).find((r: Record<string, unknown>) => r.type === 'clock_out');

  return success(c, {
    user_name: user?.name ?? '',
    staff_id: user?.staff_id ?? '',
    clocked_in: !!clockIn,
    clocked_out: !!clockOut,
    clock_in_time: clockIn ? (clockIn as Record<string, unknown>).timestamp : null,
    clock_out_time: clockOut ? (clockOut as Record<string, unknown>).timestamp : null,
    streak: user?.current_streak ?? 0,
    longest_streak: user?.longest_streak ?? 0,
  });
});

// Get my history
clockRoutes.get('/my-history', async (c) => {
  const session = c.get('session');
  const days = Number(c.req.query('days') ?? 30);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const records = await c.env.DB.prepare(
    `SELECT id, type, timestamp, within_geofence, photo_url
     FROM clock_records WHERE user_id = ? AND DATE(timestamp) >= ?
     ORDER BY timestamp DESC`
  ).bind(session.userId, from).all();

  return success(c, records.results ?? []);
});
