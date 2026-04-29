import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AuthenticationResponseJSON } from '@simplewebauthn/types';
import type { Env, SessionData } from '../types';
import { success, error } from '../lib/response';
import { sendLateClockAlert } from '../services/reminders';
import { getAppSettings, hhmmToMinutes } from '../services/settings';
import { verifyClockWebAuthnAssertion, verifyClockPin } from '../services/clock-reauth';
import { devLog } from '../lib/log';

export const clockRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// OHCS building footprints (Office of The Head of the Civil Service, Accra).
// Corners traced from Google Maps satellite view. Each polygon is one
// building; a clock-in is allowed if the user is inside ANY of them. Order
// within a polygon is the perimeter walk; winding direction is irrelevant
// for the ray-casting test.
type LatLng = readonly [number, number];
const OHCS_POLYGONS: readonly (readonly LatLng[])[] = [
  // Building 1 (~15m x 28m)
  [
    [5.552642231596962, -0.19766533600075373],
    [5.55270572629351, -0.19769244846778028],
    [5.552780332553211, -0.19748033328457254],
    [5.552717631548359, -0.19743727230753033],
  ],
  // Building 2 (~16m x 27m)
  [
    [5.552807794779271, -0.1974000832414714],
    [5.552879226292339, -0.19716723499524333],
    [5.552814144247448, -0.19715288133622927],
    [5.55273636325754, -0.19739370383746516],
  ],
  // Building 3 (~33m x 74m — the main block)
  [
    [5.552437120671583, -0.19774728898780675],
    [5.552518292169384, -0.19777004828570785],
    [5.552737266386741, -0.19712520151184268],
    [5.5526598703364645, -0.1970986489976247],
  ],
];

// Reject a clock-in if the device can't localise to better than this many
// metres. Tight cap: GPS error directly translates to false-positive risk.
const MAX_GPS_ACCURACY_METERS = 30;

// Tight wall buffer to absorb 1-3m GPS edge jitter for staff genuinely
// inside the building. Keep small — a typical road kerb sits 8-15m from
// a building wall, so anything above ~7m starts re-opening the
// across-the-street false positive we already closed.
const WALL_BUFFER_METERS = 5;

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

function insideAnyPolygon(lat: number, lng: number): boolean {
  for (const poly of OHCS_POLYGONS) {
    if (pointInPolygon(lat, lng, poly)) return true;
  }
  return false;
}

function distanceToNearestPolygonMeters(lat: number, lng: number): number {
  let min = Infinity;
  for (const poly of OHCS_POLYGONS) {
    const d = distanceToPolygonMeters(lat, lng, poly);
    if (d < min) min = d;
  }
  return min;
}

// ---- Clock-in re-auth + liveness prompt ----
// 2-digit prompt (10..99) issued at the start of every clock-in. Must be
// visible in the captured selfie. Stored single-use in KV with the user
// binding so a session swap can't replay another user's prompt.

interface ClockPrompt {
  userId: string;
  value: string;        // "10".."99"
  expiresAt: number;    // unix ms
}

function generatePromptValue(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  // 10..99 inclusive
  return String(10 + (array[0]! % 90));
}

function promptKey(promptId: string): string {
  return `clock-prompt:${promptId}`;
}

// Clock in or out
const clockSchema = z.object({
  type: z.enum(['clock_in', 'clock_out']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
  idempotency_key: z.string().min(1).max(100).optional(),
  // Re-auth + liveness (optional in soft-rollout; required when
  // app_settings.clockin_reauth_enforce = 1).
  prompt_id: z.string().uuid().optional(),
  webauthn_assertion: z.unknown().optional(),
  pin: z.string().min(4).max(10).optional(),
});

// Issue a fresh 2-digit prompt for the next clock-in. Single-use, 90s TTL
// (configurable via app_settings.clockin_prompt_ttl_seconds).
clockRoutes.post('/prompt', async (c) => {
  const session = c.get('session');
  const settings = await getAppSettings(c.env);
  const ttl = Math.max(30, Math.min(300, settings.clockin_prompt_ttl_seconds));

  const promptId = crypto.randomUUID();
  const value = generatePromptValue();
  const expiresAt = Date.now() + ttl * 1000;

  const data: ClockPrompt = { userId: session.userId, value, expiresAt };
  await c.env.KV.put(promptKey(promptId), JSON.stringify(data), { expirationTtl: ttl });

  devLog(c.env, `[CLOCK_PROMPT] issued ${promptId} value=${value} ttl=${ttl}s user=${session.userId}`);
  return success(c, { prompt_id: promptId, prompt_value: value, expires_at: expiresAt });
});

clockRoutes.post('/', zValidator('json', clockSchema), async (c) => {
  const session = c.get('session');
  const body = c.req.valid('json');
  const { type, latitude, longitude, accuracy, idempotency_key } = body;
  const promptId = body.prompt_id;
  const webauthnAssertion = body.webauthn_assertion as AuthenticationResponseJSON | undefined;
  const pin = body.pin;

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

  // ---- Prompt + re-auth gate (post-idempotency, pre-geofence) ----
  const settings = await getAppSettings(c.env);
  const enforce = settings.clockin_reauth_enforce === 1;
  const devBypass = c.env.DEV_BYPASS_REAUTH === 'true';

  let promptValue: string | null = null;
  let reauthMethod: 'webauthn' | 'pin' | null = null;

  if (promptId) {
    const raw = await c.env.KV.get(promptKey(promptId));
    if (!raw) {
      return error(c, 'PROMPT_NOT_FOUND', 'Your clock-in prompt has expired or was already used. Please try again.', 410);
    }
    const stored = JSON.parse(raw) as ClockPrompt;
    if (stored.userId !== session.userId) {
      return error(c, 'PROMPT_USER_MISMATCH', 'Prompt does not belong to this user', 403);
    }
    if (stored.expiresAt < Date.now()) {
      await c.env.KV.delete(promptKey(promptId));
      return error(c, 'PROMPT_EXPIRED', 'Your clock-in prompt has expired. Please try again.', 410);
    }
    promptValue = stored.value;
  } else if (enforce) {
    return error(c, 'PROMPT_REQUIRED', 'A fresh clock-in prompt is required.', 400);
  }

  // Re-auth: try WebAuthn first; on absence/failure, fall back to PIN.
  if (webauthnAssertion && promptId) {
    if (devBypass) {
      reauthMethod = 'webauthn';
    } else {
      const outcome = await verifyClockWebAuthnAssertion(c, session.userId, promptId, webauthnAssertion);
      if (outcome.ok) {
        reauthMethod = 'webauthn';
      } else if (pin === undefined && enforce) {
        return error(c, 'REAUTH_FAILED', 'Biometric verification failed. Try your PIN.', 401);
      }
    }
  }

  if (reauthMethod === null && pin !== undefined) {
    const outcome = await verifyClockPin(c.env, session.userId, pin, settings.clockin_pin_attempt_cap);
    if (outcome.ok) {
      reauthMethod = 'pin';
    } else if (outcome.reason === 'rate_limited') {
      return error(c, 'REAUTH_RATE_LIMITED', 'Too many wrong PIN attempts. Try again tomorrow.', 429);
    } else if (enforce) {
      return error(c, 'REAUTH_FAILED', 'PIN verification failed.', 401);
    }
  }

  if (enforce && reauthMethod === null) {
    return error(c, 'REAUTH_REQUIRED', 'Biometric or PIN verification is required to clock in.', 401);
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

  // Check geofence — inside any OHCS polygon, or within the small wall buffer.
  const inside = insideAnyPolygon(latitude, longitude);
  const distance = inside ? 0 : distanceToNearestPolygonMeters(latitude, longitude);
  const acc = accuracy && accuracy > 0 ? accuracy : 0;
  const withinGeofence = inside || distance <= WALL_BUFFER_METERS;
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
    `INSERT INTO clock_records (id, user_id, type, latitude, longitude, within_geofence, idempotency_key, prompt_value, reauth_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    session.userId,
    type,
    latitude,
    longitude,
    withinGeofence ? 1 : 0,
    idempotency_key ?? null,
    promptValue,
    reauthMethod,
  ).run();

  // Consume the prompt — single-use enforced by KV.delete after a successful insert.
  if (promptId) {
    await c.env.KV.delete(promptKey(promptId));
  }

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
