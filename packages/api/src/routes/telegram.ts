import { z } from 'zod';
import type { Context } from 'hono';
import type { Env, SessionData } from '../types';
import { generateLinkCode, consumeLinkCode, sendTelegramMessage } from '../services/telegram';
import { success, error } from '../lib/response';

// Public — receives updates from Telegram
export async function telegramWebhook(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json() as {
    message?: { chat?: { id: number }; text?: string };
  };

  const chatId = body.message?.chat?.id;
  const text = body.message?.text?.trim();

  if (!chatId || !text) return c.json({ ok: true });

  if (text === '/start') {
    const code = await generateLinkCode(String(chatId), c.env);
    const appUrl = c.env.ENVIRONMENT === 'production'
      ? 'https://smartgate.ohcs.gov.gh'
      : 'http://localhost:5173';

    await sendTelegramMessage({
      chatId: String(chatId),
      text: `Welcome to <b>OHCS SmartGate</b>!\n\nTo receive visitor notifications, link your account:\n\n<a href="${appUrl}/link-telegram?code=${code}">Click here to link your account</a>\n\nThis link expires in 10 minutes.`,
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
  }

  return c.json({ ok: true });
}

// Protected — link Telegram account to officer
const linkSchema = z.object({ code: z.string().min(1) });

export async function telegramLinkRoute(c: Context<{ Bindings: Env; Variables: { session: SessionData } }>) {
  const body = await c.req.json();
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 'VALIDATION_ERROR', 'Missing link code', 400);
  }

  const { code } = parsed.data;
  const session = c.get('session');

  const chatId = await consumeLinkCode(code, c.env);
  if (!chatId) {
    return error(c, 'INVALID_CODE', 'Link code is invalid or expired', 400);
  }

  const officer = await c.env.DB.prepare(
    'SELECT id FROM officers WHERE email = ?'
  ).bind(session.email).first<{ id: string }>();

  if (!officer) {
    return error(c, 'NOT_OFFICER', 'No officer record found for your account', 404);
  }

  await c.env.DB.prepare(
    'UPDATE officers SET telegram_chat_id = ? WHERE id = ?'
  ).bind(chatId, officer.id).run();

  await sendTelegramMessage({
    chatId,
    text: `\u2705 Account linked! You'll now receive visitor arrival notifications for <b>${session.name}</b>.`,
    token: c.env.TELEGRAM_BOT_TOKEN,
  });

  return success(c, { message: 'Telegram account linked successfully' });
}
