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

  // 2. Create in-app notification — find user by email OR name
  let user: { id: string } | null = null;
  if (officer.email) {
    user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(officer.email).first<{ id: string }>();
  }
  if (!user) {
    user = await env.DB.prepare('SELECT id FROM users WHERE name = ?')
      .bind(officer.name).first<{ id: string }>();
  }

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

  // 3. Also notify all superadmins/admins (they should see all visitor arrivals)
  const admins = await env.DB.prepare(
    "SELECT id FROM users WHERE role IN ('superadmin', 'admin') AND is_active = 1"
  ).all();

  for (const admin of (admins.results ?? []) as Array<{ id: string }>) {
    if (admin.id === user?.id) continue; // Don't double-notify
    const notifId = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, visit_id)
       VALUES (?, ?, 'visitor_arrival', ?, ?, ?)`
    ).bind(
      notifId,
      admin.id,
      `Visitor: ${data.first_name} ${data.last_name}`,
      `Host: ${officer.name}${data.directorate_abbr ? ` (${data.directorate_abbr})` : ''} \u2014 ${data.purpose_raw || 'No purpose'}`,
      data.visit_id
    ).run();
  }
}
