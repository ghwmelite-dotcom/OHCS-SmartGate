import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendLateClockAlert } from '../services/reminders';
import { getAppSettings, hhmmToMinutes } from '../services/settings';
import { devLog } from '../lib/log';

export const clockRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// OHCS Building geofence — actual building footprint (Office of The Head of
// Civil Service, Accra). Corners traced from Google Maps satellite view.
// Order: walk around the perimeter (winding direction is irrelevant for the
// ray-casting point-in-polygon test). Replaces the previous radius-around-
// centre rule, which let users on the road across from the building clock in.
type LatLng = readonly [number, number];
const OHCS_POLYGON: readonly LatLng[] = [
  [5.552442263884538, -0.1977421643383777],
  [5.552519712150007, -0.19777261304724877],
  [5.552735220313383, -0.1971196574014586],
  [5.552656649637954, -0.19709146415250392],
];

// How far outside the polygon we still treat as "at the building wall" — gives
// staff right at the entrance some forgiveness when GPS drifts a few metres.
const WALL_BUFFER_METERS = 10;

// Reject a clock-in if the device can't localise to better than this many metres.
const MAX_GPS_ACCURACY_METERS = 75;

// Ray-casting: cast a horizontal ray east from the point and count crossings.
function pointInPolygon(lat: number, lng: number, poly: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i] as LatLng;
    const [yj, xj] = poly[j] as LatLng;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Distance in metres from (lat,lng) to the closest point on segment AB.
// Uses an equirectangular projection — accurate over the ~tens-of-metres
// scale of a single building.
function distanceToSegmentMeters(
  lat: number, lng: number,
  latA: number, lngA: number,
  latB: number, lngB: number,
): number {
  const R = 6371000;
  const cosLat = Math.cos(((latA + latB) / 2) * Math.PI / 180);
  const x = (lng - lngA) * cosLat;
  const y = lat - latA;
  const dx = (lngB - lngA) * cosLat;
  const dy = latB - latA;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (x * dx + y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = dx * t - x;
  const py = dy * t - y;
  return Math.sqrt(px * px + py * py) * (Math.PI / 180) * R;
}

function distanceToPolygonMeters(lat: number, lng: number, poly: readonly LatLng[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as LatLng;
    const b = poly[j] as LatLng;
    const d = distanceToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

// Clock in or out
const clockSchema = z.object({
  type: z.enum(['clock_in', 'clock_out']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
  idempotency_key: z.string().min(1).max(100).optional(),
});

clockRoutes.post('/', zValidator('json', clockSchema), async (c) => {
  const session = c.get('session');
  const { type, latitude, longitude, accuracy, idempotency_key } = c.req.valid('json');

  // Idempotency check — return existing record immediately (before geofence re-validation)
  if (idempotency_key) {
    const existing = await c.env.DB.prepare(
      "SELECT id, type, timestamp FROM clock_records WHERE user_id = ? AND idempotency_key = ? LIMIT 1"
    ).bind(session.userId, idempotency_key).first<{ id: string; type: string; timestamp: string }>();
    if (existing) {
      return success(c, {
        id: existing.id,
        type: existing.type,
        timestamp: existing.timestamp,
        user_name: session.name,
        staff_id: '',
        within_geofence: true,
        distance_meters: 0,
        streak: 0,
        longest_streak: 0,
        deduplicated: true,
      });
    }
  }

  // Reject clock-in if GPS is too imprecise to make a reliable call.
  if (accuracy !== undefined && accuracy > MAX_GPS_ACCURACY_METERS) {
    return error(
      c,
      'GPS_TOO_IMPRECISE',
      `GPS accuracy is too poor (\u00B1${Math.round(accuracy)}m). Move somewhere with clearer sky and try again.`,
      400,
    );
  }

  // Check geofence — must be inside the OHCS building polygon, or within a
  // small wall buffer (after forgiving half the GPS accuracy as drift).
  const inside = pointInPolygon(latitude, longitude, OHCS_POLYGON);
  const distance = inside ? 0 : distanceToPolygonMeters(latitude, longitude, OHCS_POLYGON);
  const acc = accuracy && accuracy > 0 ? accuracy : 0;
  const withinGeofence = inside || (distance - acc * 0.5) <= WALL_BUFFER_METERS;
  devLog(c.env, `[CLOCK_GEO] inside=${inside} dist=${Math.round(distance)}m acc=${Math.round(acc)}m -> ${withinGeofence ? 'IN' : 'OUT'}`);

  if (!withinGeofence) {
    const accStr = acc > 0 ? ` (GPS accuracy \u00B1${Math.round(acc)}m)` : '';
    return error(
      c,
      'OUTSIDE_GEOFENCE',
      `You are ${Math.round(distance)}m outside the OHCS building${accStr}. You must be inside the building to clock ${type === 'clock_in' ? 'in' : 'out'}.`,
      400,
    );
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
    `INSERT INTO clock_records (id, user_id, type, latitude, longitude, within_geofence, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, session.userId, type, latitude, longitude, withinGeofence ? 1 : 0, idempotency_key ?? null).run();

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

  // Late-clock alert: fires for clock_in past the configured late threshold (Ghana time = UTC+0).
  if (type === 'clock_in') {
    const settings = await getAppSettings(c.env);
    const thresholdMin = hhmmToMinutes(settings.late_threshold_time);
    const now = new Date();
    const minOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minOfDay > thresholdMin) {
      c.executionCtx.waitUntil(sendLateClockAlert(c.env, session.userId, now.toISOString()));
    }
  }

  // Get updated user for response
  const user = await c.env.DB.prepare(
    'SELECT name, staff_id, current_streak, longest_streak FROM users WHERE id = ?'
  ).bind(session.userId).first<{ name: string; staff_id: string; current_streak: number; longest_streak: number }>();

  devLog(c.env, `[CLOCK] ${user?.name} (${user?.staff_id}) — ${type} at ${new Date().toISOString()}`);

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
