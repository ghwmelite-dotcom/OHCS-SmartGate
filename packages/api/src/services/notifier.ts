import type { Env } from '../types';
import { sendTelegramMessage } from './telegram';

const PERSONAL_CATEGORIES = ['personal_visit'];

interface VisitNotifyData {
  visit_id: string;
  host_officer_id: string;
  first_name: string;
  last_name: string;
  organisation: string | null;
  purpose_raw: string | null;
  purpose_category: string | null;
  badge_code: string | null;
  check_in_at: string;
  directorate_id: string | null;
  directorate_abbr: string | null;
}

function formatVisitorMessage(data: VisitNotifyData, recipientType: 'host' | 'director'): string {
  const time = new Date(data.check_in_at).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  if (recipientType === 'host') {
    return [
      `\u{1F464} <b>You have a visitor</b>`,
      '',
      `<b>${data.first_name} ${data.last_name}</b>${data.organisation ? ` (${data.organisation})` : ''}`,
      data.purpose_raw ? `Purpose: ${data.purpose_raw}` : '',
      data.badge_code ? `Badge: <code>${data.badge_code}</code>` : '',
      '',
      `At Reception \u2022 ${time}`,
      '',
      `\u2014 OHCS SmartGate`,
    ].filter(Boolean).join('\n');
  }

  // Director notification — directorate business
  return [
    `\u{1F4CB} <b>Directorate Visitor</b>`,
    '',
    `<b>${data.first_name} ${data.last_name}</b>${data.organisation ? ` (${data.organisation})` : ''}`,
    data.purpose_raw ? `Purpose: ${data.purpose_raw}` : '',
    data.directorate_abbr ? `Directorate: ${data.directorate_abbr}` : '',
    '',
    `Checked in at ${time}`,
    '',
    `\u2014 OHCS SmartGate`,
  ].filter(Boolean).join('\n');
}

export async function notifyOnCheckIn(data: VisitNotifyData, env: Env): Promise<void> {
  const isPersonal = data.purpose_category ? PERSONAL_CATEGORIES.includes(data.purpose_category) : false;

  // --- 1. ALWAYS notify the host staff member ---
  await notifyHostStaff(data, env);

  // --- 2. If directorate business (NOT personal), notify Director/Deputy ---
  if (!isPersonal && data.directorate_id) {
    await notifyDirectorateLeadership(data, env);
  }
}

// Notify the specific staff member being visited
async function notifyHostStaff(data: VisitNotifyData, env: Env): Promise<void> {
  const officer = await env.DB.prepare(
    'SELECT id, name, email, telegram_chat_id FROM officers WHERE id = ?'
  ).bind(data.host_officer_id).first<{
    id: string; name: string; email: string | null; telegram_chat_id: string | null;
  }>();

  if (!officer) return;

  // Telegram to officer directly
  if (officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
    await sendTelegramMessage({
      chatId: officer.telegram_chat_id,
      text: formatVisitorMessage(data, 'host'),
      token: env.TELEGRAM_BOT_TOKEN,
    });
  }

  // Also check if this officer has a user account with Telegram linked via KV
  const user = await findUserByOfficer(officer, env);
  if (user) {
    const kvChatId = await env.KV.get(`telegram-user:${user.id}`);
    if (kvChatId && kvChatId !== officer.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramMessage({
        chatId: kvChatId,
        text: formatVisitorMessage(data, 'host'),
        token: env.TELEGRAM_BOT_TOKEN,
      });
    }

    // In-app notification
    await createInAppNotification(user.id, data, env);
  }
}

// Notify Director and Deputy Director of the directorate
async function notifyDirectorateLeadership(data: VisitNotifyData, env: Env): Promise<void> {
  // Find directors/deputies in this directorate
  const leaders = await env.DB.prepare(
    `SELECT o.id, o.name, o.email, o.telegram_chat_id, o.title
     FROM officers o
     WHERE o.directorate_id = ? AND (
       o.title LIKE '%Director%' OR o.title LIKE '%Deputy%' OR
       o.title LIKE '%Head%' OR o.title LIKE '%Chief%'
     )`
  ).bind(data.directorate_id).all();

  const hostOfficer = await env.DB.prepare('SELECT name FROM officers WHERE id = ?')
    .bind(data.host_officer_id).first<{ name: string }>();

  for (const leader of (leaders.results ?? []) as Array<{
    id: string; name: string; email: string | null; telegram_chat_id: string | null; title: string;
  }>) {
    // Don't notify the leader if they ARE the host
    if (leader.id === data.host_officer_id) continue;

    // Telegram notification
    if (leader.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramMessage({
        chatId: leader.telegram_chat_id,
        text: formatVisitorMessage(data, 'director'),
        token: env.TELEGRAM_BOT_TOKEN,
      });
    }

    // Check KV for user-linked Telegram
    const user = await findUserByOfficer(leader, env);
    if (user) {
      const kvChatId = await env.KV.get(`telegram-user:${user.id}`);
      if (kvChatId && kvChatId !== leader.telegram_chat_id && env.TELEGRAM_BOT_TOKEN) {
        await sendTelegramMessage({
          chatId: kvChatId,
          text: formatVisitorMessage(data, 'director'),
          token: env.TELEGRAM_BOT_TOKEN,
        });
      }

      // In-app notification
      await createInAppNotification(user.id, data, env, `Directorate visitor for ${hostOfficer?.name ?? 'staff'}`);
    }
  }
}

// Helper: find user account linked to an officer
async function findUserByOfficer(
  officer: { email: string | null; name: string },
  env: Env
): Promise<{ id: string } | null> {
  if (officer.email) {
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(officer.email).first<{ id: string }>();
    if (user) return user;
  }
  return env.DB.prepare('SELECT id FROM users WHERE name = ?')
    .bind(officer.name).first<{ id: string }>();
}

// Helper: create in-app notification
async function createInAppNotification(
  userId: string,
  data: VisitNotifyData,
  env: Env,
  customBody?: string
): Promise<void> {
  const notifId = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, visit_id)
     VALUES (?, ?, 'visitor_arrival', ?, ?, ?)`
  ).bind(
    notifId,
    userId,
    `Visitor: ${data.first_name} ${data.last_name}`,
    customBody ?? `${data.organisation ? `From ${data.organisation} \u2014 ` : ''}${data.purpose_raw || 'No purpose stated'}`,
    data.visit_id
  ).run();
}
