import type { Env } from '../types';

const SYSTEM_PROMPT = `You are SmartGate Assistant, an AI helper for receptionists at the Office of the Head of Civil Service (OHCS) in Accra, Ghana.

Your role:
- Help receptionists route visitors to the correct directorate
- Look up officer availability and contact details
- Answer questions about visitor history
- Provide general guidance about OHCS procedures

You have access to lookup functions. When you need data, output a lookup command on its own line:
- LOOKUP_OFFICER:<name> — search officers by name
- LOOKUP_DIRECTORATE:<query> — search directorates by name or abbreviation
- LOOKUP_VISITOR:<name> — search visitors by name
- LOOKUP_STATS:today — get today's visit statistics
- LOOKUP_ACTIVE — get currently active visits

Rules:
- Only answer questions related to OHCS SmartGate operations
- You are read-only — you cannot create visitors, check anyone in, or modify any data
- Keep responses concise (2-3 sentences max)
- Use Ghana conventions: DD/MM/YYYY dates, 12hr time
- If unsure, say so rather than guessing
- Politely decline off-topic requests`;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const LOOKUP_PATTERN = /^LOOKUP_(OFFICER|DIRECTORATE|VISITOR|STATS|ACTIVE):?(.*)$/m;

async function executeLookup(type: string, query: string, env: Env): Promise<string> {
  const q = query.trim();

  switch (type) {
    case 'OFFICER': {
      const results = await env.DB.prepare(
        `SELECT o.name, o.title, o.office_number, o.is_available, o.phone, o.email,
                d.abbreviation as directorate_abbr, d.floor, d.wing
         FROM officers o JOIN directorates d ON o.directorate_id = d.id
         WHERE o.name LIKE ? LIMIT 5`
      ).bind(`%${q}%`).all();
      if (!results.results?.length) return `No officers found matching "${q}".`;
      return results.results.map((o: Record<string, unknown>) =>
        `${o.name} \u2014 ${o.title || 'Officer'} (${o.directorate_abbr}), Office: ${o.office_number || 'N/A'}, ${o.floor}/${o.wing}, ${o.is_available ? 'Available' : 'Unavailable'}`
      ).join('\n');
    }

    case 'DIRECTORATE': {
      const results = await env.DB.prepare(
        `SELECT name, abbreviation, floor, wing FROM directorates
         WHERE is_active = 1 AND (name LIKE ? OR abbreviation LIKE ?) LIMIT 5`
      ).bind(`%${q}%`, `%${q}%`).all();
      if (!results.results?.length) return `No directorates found matching "${q}".`;
      return results.results.map((d: Record<string, unknown>) =>
        `${d.abbreviation} \u2014 ${d.name}, ${d.floor}, ${d.wing} Wing`
      ).join('\n');
    }

    case 'VISITOR': {
      const results = await env.DB.prepare(
        `SELECT first_name, last_name, organisation, total_visits, last_visit_at FROM visitors
         WHERE first_name LIKE ? OR last_name LIKE ? ORDER BY last_visit_at DESC LIMIT 5`
      ).bind(`%${q}%`, `%${q}%`).all();
      if (!results.results?.length) return `No visitors found matching "${q}".`;
      return results.results.map((v: Record<string, unknown>) => {
        const lastVisit = v.last_visit_at
          ? new Date(v.last_visit_at as string).toLocaleDateString('en-GB')
          : 'Never';
        return `${v.first_name} ${v.last_name}${v.organisation ? ` (${v.organisation})` : ''} \u2014 ${v.total_visits} visits, last: ${lastVisit}`;
      }).join('\n');
    }

    case 'STATS': {
      const today = new Date().toISOString().slice(0, 10);
      const results = await env.DB.prepare(
        `SELECT status, COUNT(*) as count FROM visits WHERE DATE(check_in_at) = ? GROUP BY status`
      ).bind(today).all();
      if (!results.results?.length) return 'No visits recorded today.';
      const stats = results.results as Array<{ status: string; count: number }>;
      const total = stats.reduce((sum, s) => sum + s.count, 0);
      const checkedIn = stats.find(s => s.status === 'checked_in')?.count ?? 0;
      const checkedOut = stats.find(s => s.status === 'checked_out')?.count ?? 0;
      return `Today: ${total} total visits, ${checkedIn} currently in building, ${checkedOut} checked out.`;
    }

    case 'ACTIVE': {
      const results = await env.DB.prepare(
        `SELECT vis.first_name, vis.last_name, o.name as host_name, d.abbreviation as dir, v.check_in_at
         FROM visits v
         JOIN visitors vis ON v.visitor_id = vis.id
         LEFT JOIN officers o ON v.host_officer_id = o.id
         LEFT JOIN directorates d ON v.directorate_id = d.id
         WHERE v.status = 'checked_in' ORDER BY v.check_in_at DESC LIMIT 10`
      ).all();
      if (!results.results?.length) return 'No active visits right now.';
      return results.results.map((v: Record<string, unknown>) => {
        const time = new Date(v.check_in_at as string).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true,
        });
        return `${v.first_name} ${v.last_name} \u2192 ${v.host_name || 'No host'} (${v.dir || 'N/A'}) since ${time}`;
      }).join('\n');
    }

    default:
      return 'Unknown lookup type.';
  }
}

export async function chat(userMessages: ChatMessage[], env: Env): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...userMessages.slice(-10),
  ];

  const firstResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
    messages,
    max_tokens: 300,
  });

  const firstReply = (firstResponse as { response?: string }).response ?? '';

  const match = firstReply.match(LOOKUP_PATTERN);
  if (!match) return firstReply;

  const [, lookupType, lookupQuery] = match;
  const lookupResult = await executeLookup(lookupType!, lookupQuery!, env);

  const secondMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: firstReply },
    { role: 'system', content: `Lookup result:\n${lookupResult}\n\nNow respond to the user using this data. Be concise.` },
  ];

  const secondResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
    messages: secondMessages,
    max_tokens: 300,
  });

  return (secondResponse as { response?: string }).response ?? 'Sorry, I could not process that request.';
}
