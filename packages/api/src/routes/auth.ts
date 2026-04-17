import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { Env, SessionData } from '../types';
import { LoginSchema, VerifyOtpSchema } from '../lib/validation';
import { createOtp, verifyOtp, verifyPin, hashPin, createSession, deleteSession, getSession } from '../services/auth';
import { success, error } from '../lib/response';
import { z } from 'zod';

export const authRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Email OTP login (request code)
authRoutes.post('/login', zValidator('json', LoginSchema), async (c) => {
  const { email } = c.req.valid('json');

  const user = await c.env.DB.prepare('SELECT id, name, email, role, is_active FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user || !user.is_active) {
    return error(c, 'USER_NOT_FOUND', 'No active account found with this email', 404);
  }

  await createOtp(email, c.env);

  return success(c, { message: 'OTP sent to your email' });
});

// Email OTP verify
const verifySchema = VerifyOtpSchema.extend({
  remember: z.boolean().optional(),
});

authRoutes.post('/verify', zValidator('json', verifySchema), async (c) => {
  const { email, code, remember } = c.req.valid('json');

  const valid = await verifyOtp(email, code, c.env);
  if (!valid) {
    return error(c, 'INVALID_OTP', 'Invalid or expired OTP', 401);
  }

  const user = await c.env.DB.prepare('SELECT id, name, email, role FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; name: string; email: string; role: string }>();

  if (!user) {
    return error(c, 'USER_NOT_FOUND', 'User not found', 404);
  }

  const { sessionId, ttl } = await createSession(user.id, user.email, user.role, user.name, c.env, remember);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  setCookie(c, 'session_id', sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: c.env.ENVIRONMENT === 'production' ? 'None' : 'Lax',
    path: '/',
    maxAge: ttl,
  });

  return success(c, { user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// PIN-based login
const pinLoginSchema = z.object({
  staff_id: z.string().min(1).max(20).trim(),
  pin: z.string().length(4).regex(/^\d{4}$/, 'PIN must be 4 digits'),
  remember: z.boolean().optional(),
});

authRoutes.post('/pin-login', zValidator('json', pinLoginSchema), async (c) => {
  const { staff_id, pin, remember } = c.req.valid('json');

  const user = await c.env.DB.prepare(
    'SELECT id, name, email, role, pin_hash, is_active, pin_acknowledged FROM users WHERE staff_id = ?'
  ).bind(staff_id.toUpperCase()).first<{
    id: string; name: string; email: string; role: string;
    pin_hash: string | null; is_active: number; pin_acknowledged: number;
  }>();

  if (!user || !user.is_active) {
    return error(c, 'INVALID_CREDENTIALS', 'Invalid staff ID or PIN', 401);
  }

  if (!user.pin_hash) {
    return error(c, 'PIN_NOT_SET', 'PIN not configured for this account. Contact your administrator.', 401);
  }

  const valid = await verifyPin(pin, user.pin_hash);
  if (!valid) {
    return error(c, 'INVALID_CREDENTIALS', 'Invalid staff ID or PIN', 401);
  }

  const { sessionId, ttl } = await createSession(user.id, user.email, user.role, user.name, c.env, remember);

  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), user.id)
    .run();

  setCookie(c, 'session_id', sessionId, {
    httpOnly: true,
    secure: c.env.ENVIRONMENT === 'production',
    sameSite: c.env.ENVIRONMENT === 'production' ? 'None' : 'Lax',
    path: '/',
    maxAge: ttl,
  });

  return success(c, {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      pin_acknowledged: user.pin_acknowledged === 1,
    },
  });
});

authRoutes.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (sessionId) {
    await deleteSession(sessionId, c.env);
  }
  deleteCookie(c, 'session_id', { path: '/' });
  return success(c, { message: 'Logged out' });
});

// Change PIN
const changePinSchema = z.object({
  current_pin: z.string().length(4).regex(/^\d{4}$/),
  new_pin: z.string().length(4).regex(/^\d{4}$/),
});

authRoutes.post('/change-pin', zValidator('json', changePinSchema), async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  const session = await getSession(sessionId, c.env);
  if (!session) return error(c, 'UNAUTHORIZED', 'Session expired', 401);

  const { current_pin, new_pin } = c.req.valid('json');

  const user = await c.env.DB.prepare('SELECT pin_hash FROM users WHERE id = ?')
    .bind(session.userId).first<{ pin_hash: string | null }>();

  if (!user?.pin_hash) return error(c, 'NO_PIN', 'No PIN set for this account', 400);

  const valid = await verifyPin(current_pin, user.pin_hash);
  if (!valid) return error(c, 'WRONG_PIN', 'Current PIN is incorrect', 401);

  const newHash = await hashPin(new_pin);
  await c.env.DB.prepare('UPDATE users SET pin_hash = ? WHERE id = ?')
    .bind(newHash, session.userId).run();

  return success(c, { message: 'PIN changed successfully' });
});

authRoutes.get('/me', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (!sessionId) {
    return error(c, 'UNAUTHORIZED', 'Not authenticated', 401);
  }
  const session = await getSession(sessionId, c.env);
  if (!session) {
    return error(c, 'UNAUTHORIZED', 'Session expired', 401);
  }

  const row = await c.env.DB.prepare('SELECT pin_acknowledged FROM users WHERE id = ?')
    .bind(session.userId)
    .first<{ pin_acknowledged: number }>();

  return success(c, {
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      role: session.role,
      pin_acknowledged: (row?.pin_acknowledged ?? 0) === 1,
    },
  });
});
