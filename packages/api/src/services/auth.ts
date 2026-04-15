import type { Env, SessionData } from '../types';

const OTP_TTL = 600;
const SESSION_TTL = 86400;

export function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0]! % 1000000).padStart(6, '0');
}

export async function createOtp(email: string, env: Env): Promise<string> {
  const code = generateOtp();
  await env.KV.put(`otp:${email}`, JSON.stringify({ code, attempts: 0 }), { expirationTtl: OTP_TTL });
  console.log(`[DEV OTP] ${email}: ${code}`);
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

export async function createSession(userId: string, email: string, role: string, name: string, env: Env): Promise<string> {
  const sessionId = crypto.randomUUID();
  const session: SessionData = { userId, email, role, name };
  await env.KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return sessionId;
}

export async function getSession(sessionId: string, env: Env): Promise<SessionData | null> {
  const raw = await env.KV.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(sessionId: string, env: Env): Promise<void> {
  await env.KV.delete(`session:${sessionId}`);
}
