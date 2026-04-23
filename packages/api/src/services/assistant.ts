import type { Env } from '../types';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0];
const MAX_LOOKUP_ROUNDS = 3;

const BASE_PROMPT = `You are SmartGate Assistant, the AI receptionist helper at the Office of the Head of Civil Service (OHCS) in Accra, Ghana.

YOUR PRIMARY ROLE: Help receptionists direct visitors to the RIGHT office based on their stated purpose of visit.

=== OHCS BUILDING LAYOUT ===
- 1st Floor: Deputy Directors' offices, some units
- 2nd Floor: All Directors' offices, Chief Director's office, Head of Service office, Confidential Registry

=== ROUTING KEYWORD MAP ===
Use these keywords to match a visitor's stated purpose to the correct directorate (by abbreviation). Then look up the current room in the LIVE DIRECTORY below.

- **F&A** (Finance & Administration): budget, expenditure, payments, accounting, pension, personnel management, promotions admin, retirement, recruitment admin, official records, stores, assets, procurement, transport, vehicle, estates, maintenance, staff welfare, asset register, office supplies
- **PBMED** (Planning, Budgeting, Monitoring & Evaluation): performance agreements, performance appraisals, medium-term development plans, annual budgets, progress reports, NDPC reporting, productivity policies, client service charters, monitoring and evaluation
- **CMD** (Career Management Directorate): career management, promotions policy, postings, transfers, succession planning, staff distribution, occupational health, welfare policy, Civil Service Council matters
- **RSIMD** (Research, Statistics & Information Management): ICT, technology, computers, IT systems, software, research, data, surveys, HR database, salary administration, salary issues, salary review, E-SPAR, ESPAR, information management, e-governance, statistics
- **RTDD** (Recruitment, Training & Development): recruitment, job applications, graduate entrance exam, interviews, hiring, training, capacity building, study leave, scholarship, GIMPA, staff development, induction, onboarding, JICA, training plans
- **CSC** (Civil Service Council Secretariat): Civil Service Council, council appointments, category A appointments, disciplinary matters, petitions to council, contract appointments, schemes of service
- **RCU** (Reforms Coordinating Unit): reforms, anti-corruption, NACAP, Right to Information, RTI, administrative reforms, productivity improvement
- **IAU** (Internal Audit Unit): audit, internal audit, fraud prevention, risk assessment, financial controls, compliance review, special investigations
- **Confidential Registry**: document submission, submitting documents, confidential documents, registry, filing documents
- **Chief Director / Head of Service**: only if the visitor specifically requests them

=== ROUTING RULES ===
1. ALWAYS recommend the Deputy Director's office first (1st Floor) unless the visitor specifically asks for the Director.
2. Match purpose to directorate abbreviation, then consult the LIVE DIRECTORY for the exact room number.
3. If the purpose doesn't match any keyword, ask the visitor which specific office or person they want to see.
4. For document submissions: direct to Confidential Registry (unless directorate-specific).
5. Keep responses SHORT: "Direct them to [Directorate] — Deputy Director's office, Room XX, 1st Floor."

=== LOOKUP COMMANDS ===
When you need live data, output lookup commands on their own lines. Multiple lookups per turn are supported:
- LOOKUP_OFFICER:<name> — search officers by name
- LOOKUP_DIRECTORATE:<query> — search directorates
- LOOKUP_VISITOR:<name> — search visitors by name
- LOOKUP_STATS:today — get today's visit statistics
- LOOKUP_ACTIVE — get currently active visits

=== RULES ===
- Only answer questions related to OHCS SmartGate operations
- You are read-only — cannot create visitors, check anyone in, or modify data
- Keep responses concise (2-3 sentences)
- Ghana conventions: DD/MM/YYYY dates, 12hr time
- If unsure about routing, say so and suggest the visitor ask for the specific person
- Politely decline off-topic requests`;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const LOOKUP_PATTERN = /LOOKUP_(OFFICER|DIRECTORATE|VISITOR|STATS|ACTIVE):?([^\n]*)/g;

let directoryCache: { value: string; ts: number } | null = null;
const DIRECTORY_TTL_MS = 60_000;

async function buildLiveDirectory(env: Env): Promise<string> {
  const now = Date.now();
  if (directoryCache && now - directoryCache.ts < DIRECTORY_TTL_MS) return directoryCache.value;

  const [dirs, officers] = await Promise.all([
    env.DB.prepare(
      `SELECT abbreviation, name, type, rooms, floor, wing
       FROM directorates WHERE is_active = 1 ORDER BY abbreviation`
    ).all<{ abbreviation: string; name: string; type: string; rooms: string | null; floor: string | null; wing: string | null }>(),
    env.DB.prepare(
      `SELECT o.name, o.title, o.office_number, d.abbreviation as dir_abbr
       FROM officers o JOIN directorates d ON o.directorate_id = d.id
       WHERE d.is_active = 1
       ORDER BY d.abbreviation, o.name`
    ).all<{ name: string; title: string | null; office_number: string | null; dir_abbr: string }>(),
  ]);

  const dirLines = (dirs.results ?? []).map(d => {
    const rooms = d.rooms ? `Rooms ${d.rooms}` : 'Rooms TBD';
    const floor = d.floor ? `, ${d.floor}` : '';
    const wing = d.wing ? `, ${d.wing} Wing` : '';
    return `- ${d.abbreviation} (${d.name}, ${d.type}): ${rooms}${floor}${wing}`;
  }).join('\n');

  const officerLines = (officers.results ?? []).map(o =>
    `- ${o.name}${o.title ? ` (${o.title})` : ''} — ${o.dir_abbr}${o.office_number ? `, Office ${o.office_number}` : ''}`
  ).join('\n');

  const text = `=== LIVE DIRECTORY ===\n\nDirectorates:\n${dirLines || '(none)'}\n\nOfficers:\n${officerLines || '(none)'}`;
  directoryCache = { value: text, ts: now };
  return text;
}

async function executeLookup(type: string, query: string, env: Env): Promise<string> {
  const q = query.trim();

  switch (type) {
    case 'OFFICER': {
      const results = await env.DB.prepare(
        `SELECT o.name, o.title, o.office_number, o.is_available, o.phone, o.email,
                d.abbreviation as directorate_abbr, d.rooms
         FROM officers o JOIN directorates d ON o.directorate_id = d.id
         WHERE o.name LIKE ? LIMIT 5`
      ).bind(`%${q}%`).all();
      if (!results.results?.length) return `No officers found matching "${q}".`;
      return results.results.map((o: Record<string, unknown>) =>
        `${o.name} \u2014 ${o.title || 'Officer'} (${o.directorate_abbr}), Office: ${o.office_number || 'N/A'}, ${o.is_available ? 'Available' : 'Unavailable'}`
      ).join('\n');
    }

    case 'DIRECTORATE': {
      const results = await env.DB.prepare(
        `SELECT name, abbreviation, type, rooms FROM directorates
         WHERE is_active = 1 AND (name LIKE ? OR abbreviation LIKE ?) LIMIT 5`
      ).bind(`%${q}%`, `%${q}%`).all();
      if (!results.results?.length) return `No directorates found matching "${q}".`;
      return results.results.map((d: Record<string, unknown>) =>
        `${d.abbreviation} \u2014 ${d.name} (${d.type}), Rooms: ${d.rooms || 'N/A'}`
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
        `SELECT vis.first_name, vis.last_name, COALESCE(o.name, v.host_name_manual) as host_name, d.abbreviation as dir, v.check_in_at
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

function stripLookups(text: string): string {
  return text.replace(LOOKUP_PATTERN, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function buildSystemPrompt(env: Env): Promise<string> {
  const directory = await buildLiveDirectory(env);
  return `${BASE_PROMPT}\n\n${directory}`;
}

/**
 * Run the multi-lookup loop and return the final text (non-streaming).
 * Used by /chat (backward compat) and the eval harness.
 */
export async function chat(userMessages: ChatMessage[], env: Env): Promise<string> {
  const systemPrompt = await buildSystemPrompt(env);
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...userMessages.slice(-10),
  ];

  for (let round = 0; round < MAX_LOOKUP_ROUNDS; round++) {
    const response = await env.AI.run(MODEL, { messages, max_tokens: 400 });
    const reply = ((response as { response?: string }).response ?? '').trim();

    const matches = [...reply.matchAll(LOOKUP_PATTERN)];
    if (matches.length === 0) return reply;

    const results = await Promise.all(
      matches.map(m => executeLookup(m[1]!, (m[2] ?? '').trim(), env)),
    );
    const lookupText = matches.map((m, i) => `${m[0]}\n${results[i]}`).join('\n\n');

    messages = [
      ...messages,
      { role: 'assistant', content: reply },
      { role: 'system', content: `Lookup results:\n${lookupText}\n\nNow respond to the user using this data. Be concise. Do NOT emit more LOOKUP commands unless absolutely necessary.` },
    ];
  }

  // Hit round cap — return last response minus lookup commands
  const last = messages[messages.length - 2];
  if (last && last.role === 'assistant') return stripLookups(last.content);
  return 'Sorry, I could not complete that request.';
}

/**
 * Stream the final response as SSE. First run the lookup loop non-streaming,
 * then stream the final AI call to the client.
 * Returns a ReadableStream suitable for a text/event-stream Response.
 */
export async function chatStream(userMessages: ChatMessage[], env: Env): Promise<ReadableStream<Uint8Array>> {
  const systemPrompt = await buildSystemPrompt(env);
  let messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...userMessages.slice(-10),
  ];

  // Run lookup loop non-streaming until we have a final-answer message to stream
  let finalMessages: ChatMessage[] | null = null;
  let cachedReply: string | null = null;

  for (let round = 0; round < MAX_LOOKUP_ROUNDS; round++) {
    const response = await env.AI.run(MODEL, { messages, max_tokens: 400 });
    const reply = ((response as { response?: string }).response ?? '').trim();

    const matches = [...reply.matchAll(LOOKUP_PATTERN)];
    if (matches.length === 0) {
      // No lookups → this reply IS the final answer. Emit as a single SSE message.
      cachedReply = reply;
      break;
    }

    const results = await Promise.all(
      matches.map(m => executeLookup(m[1]!, (m[2] ?? '').trim(), env)),
    );
    const lookupText = matches.map((m, i) => `${m[0]}\n${results[i]}`).join('\n\n');

    messages = [
      ...messages,
      { role: 'assistant', content: reply },
      { role: 'system', content: `Lookup results:\n${lookupText}\n\nNow respond to the user using this data. Be concise. Do NOT emit more LOOKUP commands.` },
    ];
    // Next iteration with lookup results in context; model should produce final answer
    if (round === MAX_LOOKUP_ROUNDS - 1) {
      finalMessages = messages;
    } else {
      // Peek: if the NEXT reply has no lookups, it'll be the final — set up to stream it
      finalMessages = messages;
    }
  }

  const encoder = new TextEncoder();

  // Case 1: we have a cached final text — emit as a single event
  if (cachedReply !== null) {
    const replyText = cachedReply;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: replyText })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
  }

  // Case 2: lookups were done — stream the final AI call
  if (!finalMessages) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: 'Sorry, I could not complete that request.' })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
  }

  const aiResponse = await env.AI.run(MODEL, {
    messages: finalMessages,
    max_tokens: 400,
    stream: true,
  }) as unknown as ReadableStream<Uint8Array>;

  // Transform Workers-AI SSE (`data: {"response":"..."}`) into our `data: {"text":"..."}` format.
  return new ReadableStream({
    async start(controller) {
      const reader = aiResponse.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data) as { response?: string };
              if (json.response) {
                // Drop any leaked LOOKUP commands from the stream
                const safe = json.response.replace(LOOKUP_PATTERN, '');
                if (safe) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: safe })}\n\n`));
                }
              }
            } catch { /* skip malformed chunk */ }
          }
        }
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });
}
