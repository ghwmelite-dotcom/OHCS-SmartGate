import type { Env, SessionData } from '../types';

const OTP_TTL = 600;
const SESSION_TTL_DEFAULT = 86400;       // 24 hours
const SESSION_TTL_REMEMBER = 2592000;    // 30 days

export function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0]! % 1000000).padStart(6, '0');
}

export async function createOtp(email: string, env: Env): Promise<string> {
  const code = generateOtp();
  await env.KV.put(`otp:${email}`, JSON.stringify({ code, attempts: 0 }), { expirationTtl: OTP_TTL });
  if (env.ENVIRONMENT !== 'production') {
    console.log(`[DEV OTP] ${email}: ${code}`);
  }
  return code;
}

export async function verifyOtp(email: string, code: string, env: Env): Promise<boolean> {
  const raw = await env.KV.get(`otp:${email}`);
  if (!raw) return false;

  const data = JSON.parse(raw) as { code: string; attempts: number };

  if (data.attempts >= 5) {
    await env.KV.delete(`otp:${email}`);
    return false;
  }

  if (data.code !== code) {
    data.attempts++;
    await env.KV.put(`otp:${email}`, JSON.stringify(data), { expirationTtl: OTP_TTL });
    return false;
  }

  await env.KV.delete(`otp:${email}`);
  return true;
}

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const inputHash = await hashPin(pin);
  if (inputHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < inputHash.length; i++) {
    diff |= inputHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSession(
  userId: string,
  email: string,
  role: string,
  name: string,
  env: Env,
  remember = false
): Promise<{ sessionId: string; ttl: number }> {
  const sessionId = crypto.randomUUID();
  const ttl = remember ? SESSION_TTL_REMEMBER : SESSION_TTL_DEFAULT;
  const session: SessionData = { userId, email, role, name };
  await env.KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: ttl });
  return { sessionId, ttl };
}

export async function getSession(sessionId: string, env: Env): Promise<SessionData | null> {
  const raw = await env.KV.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(sessionId: string, env: Env): Promise<void> {
  await env.KV.delete(`session:${sessionId}`);
}
