import type { Env } from '../types';
import { sendTelegramMessage, formatVisitorArrivalMessage } from './telegram';

interface VisitNotifyData {
  visit_id: string;
  host_officer_id: string;
  first_name: string;
  last_name: string;
  organisation: string | null;
  purpose_raw: string | null;
  badge_code: string | null;
  check_in_at: string;
  directorate_abbr: string | null;
}

export async function notifyHostOfficer(data: VisitNotifyData, env: Env): Promise<void> {
  const officer = await env.DB.prepare(
    'SELECT id, name, email, telegram_chat_id FROM officers WHERE id = ?'
  ).bind(data.host_officer_id).first<{
    id: string; name: string; email: string | null; telegram_chat_id: string | null;
  }>();

  if (!officer) return;

  // 1. Send Telegram notification
  if (officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    const message = formatVisitorArrivalMessage(data);
    await sendTelegramMessage({
      chatId: officer.telegram_chat_id,
      text: message,
      token: env.TELEGRAM_BOT_TOKEN,
    });
  }

  // 2. Create in-app notification (if officer has a user account)
  if (officer.email) {
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(officer.email).first<{ id: string }>();

    if (user) {
      const notifId = crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, visit_id)
         VALUES (?, ?, 'visitor_arrival', ?, ?, ?)`
      ).bind(
        notifId,
        user.id,
        `Visitor: ${data.first_name} ${data.last_name}`,
        `${data.organisation ? `From ${data.organisation} \u2014 ` : ''}${data.purpose_raw || 'No purpose stated'}`,
        data.visit_id
      ).run();
    }
  }
}
