import type { Env } from '../types';
import { sendTelegramMessage } from './telegram';

export async function sendDailySummary(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // Get attendance stats
  const [totalStaff, clockedIn, lateCount] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as c FROM users WHERE is_active = 1').first<{ c: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as c FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) = ?`
    ).bind(today).first<{ c: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) as c FROM clock_records WHERE type = 'clock_in' AND DATE(timestamp) = ? AND TIME(timestamp) > '08:30:00'`
    ).bind(today).first<{ c: number }>(),
  ]);

  const total = totalStaff?.c ?? 0;
  const present = clockedIn?.c ?? 0;
  const late = lateCount?.c ?? 0;
  const absent = total - present;
  const rate = total > 0 ? Math.round((present / total) * 100) : 0;

  // Get directorate breakdown
  const dirResults = await env.DB.prepare(
    `SELECT d.abbreviation,
            COUNT(DISTINCT u.id) as total,
            COUNT(DISTINCT ci.user_id) as present
     FROM directorates d
     LEFT JOIN users u ON u.directorate_id = d.id AND u.is_active = 1
     LEFT JOIN clock_records ci ON ci.user_id = u.id AND ci.type = 'clock_in' AND DATE(ci.timestamp) = ?
     WHERE d.is_active = 1
     GROUP BY d.id HAVING total > 0
     ORDER BY d.abbreviation`
  ).bind(today).all();

  const dirLines = (dirResults.results ?? []).map((d: Record<string, unknown>) =>
    `  ${d.abbreviation}: ${d.present}/${d.total}`
  ).join('\n');

  // Build message
  const dateFormatted = new Date(today + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const message = [
    `\u{1F4CA} <b>Daily Attendance Summary</b>`,
    `${dateFormatted} \u2014 ${time}`,
    '',
    `\u2705 Present: <b>${present}</b>/${total} (${rate}%)`,
    `\u{1F534} Absent: <b>${absent}</b>`,
    late > 0 ? `\u26A0\uFE0F Late arrivals: <b>${late}</b>` : '',
    '',
    `<b>By Directorate:</b>`,
    dirLines,
    '',
    `\u2014 OHCS SmartGate`,
  ].filter(Boolean).join('\n');

  // Send to all superadmins/admins who have Telegram linked
  // First check if any admin users are also officers with telegram_chat_id
  const adminUsers = await env.DB.prepare(
    "SELECT u.email, u.name FROM users u WHERE u.role IN ('superadmin', 'admin') AND u.is_active = 1"
  ).all();

  for (const admin of (adminUsers.results ?? []) as Array<{ email: string; name: string }>) {
    // Find officer with matching email or name that has telegram linked
    const officer = await env.DB.prepare(
      'SELECT telegram_chat_id FROM officers WHERE (email = ? OR name = ?) AND telegram_chat_id IS NOT NULL'
    ).bind(admin.email, admin.name).first<{ telegram_chat_id: string }>();

    if (officer?.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramMessage({
        chatId: officer.telegram_chat_id,
        text: message,
        token: env.TELEGRAM_BOT_TOKEN,
      });
    }
  }

  // Also check KV for any directly stored admin chat IDs
  const adminChatId = await env.KV.get('telegram-admin-chat-id');
  if (adminChatId && env.TELEGRAM_BOT_TOKEN) {
    await sendTelegramMessage({
      chatId: adminChatId,
      text: message,
      token: env.TELEGRAM_BOT_TOKEN,
    });
  }

  console.log(`[DAILY SUMMARY] Sent: ${present}/${total} present, ${late} late`);
}
