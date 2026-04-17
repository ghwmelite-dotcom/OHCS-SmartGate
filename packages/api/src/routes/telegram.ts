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
    await sendTelegramMessage({
      chatId: String(chatId),
      text: [
        `\u{1F1EC}\u{1F1ED} <b>OHCS SmartGate Bot</b>`,
        '',
        `Link your account to receive visitor notifications and daily attendance summaries.`,
        '',
        `<b>Commands:</b>`,
        `/link 1334685 \u2014 Link your Staff ID`,
        `/admin \u2014 Get daily attendance reports`,
        `/stop \u2014 Unsubscribe`,
        '',
        `Just send /link followed by your Staff ID to get started.`,
      ].join('\n'),
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
  }

  // /link <staff_id> — one-step linking
  if (text?.startsWith('/link')) {
    const staffId = text.replace('/link', '').trim().toUpperCase();
    if (!staffId) {
      await sendTelegramMessage({
        chatId: String(chatId),
        text: `Please include your Staff ID.\n\nExample: <code>/link 1334685</code>`,
        token: c.env.TELEGRAM_BOT_TOKEN,
      });
      return c.json({ ok: true });
    }

    // Find officer or user by staff_id
    const user = await c.env.DB.prepare('SELECT id, name, email FROM users WHERE staff_id = ?')
      .bind(staffId).first<{ id: string; name: string; email: string }>();

    if (!user) {
      await sendTelegramMessage({
        chatId: String(chatId),
        text: `\u274C Staff ID <code>${staffId}</code> not found. Check your ID and try again.`,
        token: c.env.TELEGRAM_BOT_TOKEN,
      });
      return c.json({ ok: true });
    }

    // Link: update officer record if exists, or store in KV as user-telegram mapping
    const officer = await c.env.DB.prepare('SELECT id FROM officers WHERE email = ? OR name = ?')
      .bind(user.email, user.name).first<{ id: string }>();

    if (officer) {
      await c.env.DB.prepare('UPDATE officers SET telegram_chat_id = ? WHERE id = ?')
        .bind(String(chatId), officer.id).run();
    }

    // Also store user-level telegram link in KV for direct notifications
    await c.env.KV.put(`telegram-user:${user.id}`, String(chatId));

    await sendTelegramMessage({
      chatId: String(chatId),
      text: [
        `\u2705 <b>Linked successfully!</b>`,
        '',
        `\u{1F464} ${user.name}`,
        `\u{1F4CB} Staff ID: ${staffId}`,
        '',
        `You will now receive:`,
        `\u2022 Visitor arrival notifications`,
        `\u2022 Check-in/out confirmations`,
        '',
        `Send /admin for daily attendance summaries.`,
      ].join('\n'),
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
  }

  if (text === '/admin') {
    await c.env.KV.put('telegram-admin-chat-id', String(chatId));
    await sendTelegramMessage({
      chatId: String(chatId),
      text: `\u2705 <b>Daily summaries enabled!</b>\n\nYou\u2019ll receive attendance reports at 9:00 AM (Mon\u2013Fri).\n\nSend /stop to unsubscribe.`,
      token: c.env.TELEGRAM_BOT_TOKEN,
    });
  }

  if (text === '/stop') {
    await c.env.KV.delete('telegram-admin-chat-id');
    await sendTelegramMessage({
      chatId: String(chatId),
      text: `Notifications disabled. Send /start to re-enable.`,
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
