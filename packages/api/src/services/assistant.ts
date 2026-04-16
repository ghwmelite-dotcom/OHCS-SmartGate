import type { Env } from '../types';

const SYSTEM_PROMPT = `You are SmartGate Assistant, the AI receptionist helper at the Office of the Head of Civil Service (OHCS) in Accra, Ghana.

YOUR PRIMARY ROLE: Help receptionists direct visitors to the RIGHT office based on their stated purpose of visit.

=== OHCS BUILDING LAYOUT ===
- 1st Floor: Deputy Directors' offices, some units
- 2nd Floor: All Directors' offices, Chief Director's office, Head of Service office, Confidential Registry

=== DIRECTORATES & ROUTING GUIDE ===

**Finance & Administration (F&A)**
- Deputy Director: Room 35 (1st Floor)
- Director: Room 10 (2nd Floor)
- ROUTE HERE IF visitor mentions: budget, expenditure, payments, accounting, financial matters, personnel management, promotions, retirement, recruitment admin, official records, stores, assets, procurement, transport, vehicle, estates, maintenance, meetings coordination, staff welfare, asset register, office supplies, auctioning equipment

**Planning, Budgeting, Monitoring & Evaluation (PBMED)**
- Deputy Director: Room 31 (1st Floor)
- Director: Room 5 (2nd Floor)
- ROUTE HERE IF visitor mentions: performance agreements, performance appraisals, staff performance, medium-term development plans, annual budgets, progress reports, NDPC reporting, productivity policies, service delivery standards, client service charters, monitoring and evaluation

**Career Management Directorate (CMD)**
- Deputy Director: Room 34 (1st Floor)
- Director: Room 3 (2nd Floor)
- ROUTE HERE IF visitor mentions: career management, promotions policy, postings, transfers, succession planning, staff distribution, occupational health, welfare policy, career advice, Civil Service Council matters

**Research, Statistics & Information Management (RSIMD)**
- Deputy Director: Room 19 (1st Floor)
- Director: Room 7 (2nd Floor)
- ROUTE HERE IF visitor mentions: ICT, technology, computers, IT systems, software, research, data collection, surveys, HR database, salary administration, salary issues, salary review, information management, e-governance, knowledge management, statistics, data analysis, modelling, forecasting

**Recruitment, Training & Development (RTDD)**
- Deputy Director: Room 9 (2nd Floor)
- Director: Room 11 (2nd Floor)
- ROUTE HERE IF visitor mentions: recruitment, job applications, graduate entrance exam, interviews, hiring, training, capacity building, study leave, scholarship, GIMPA course, staff development, induction, onboarding, training institutions, JICA, EPL programmes, training plans

**Civil Service Council (CSC) Secretariat**
- Rooms: 24, 44
- ROUTE HERE IF visitor mentions: Civil Service Council, council appointments, category A appointments, disciplinary matters, petitions to council, contract appointments, organisational manuals, schemes of service, council decisions

**Reforms Coordinating Unit (RCU)**
- ROUTE HERE IF visitor mentions: reforms, civil service reforms, anti-corruption (NACAP), Right to Information (RTI), administrative reforms, productivity improvement, civil service annual performance report

**Internal Audit Unit (IAU)**
- ROUTE HERE IF visitor mentions: audit, internal audit, fraud prevention, risk assessment, financial controls, compliance review, special investigations

**Confidential Registry**
- Room 4 (2nd Floor)
- ROUTE HERE IF visitor mentions: document submission, submitting documents, confidential documents, registry, filing documents

**Chief Director & Head of Service Offices**
- Located on 2nd Floor
- ROUTE HERE ONLY IF visitor specifically requests to see the Chief Director or Head of Civil Service

=== ROUTING RULES ===
1. ALWAYS recommend the Deputy Director's office first (1st Floor) unless the visitor specifically asks for the Director.
2. If the purpose clearly matches a directorate, give the room number and floor.
3. If the purpose doesn't match any directorate, ask the visitor which office or person they want to see, and help with room directions.
4. For document submissions, always direct to Confidential Registry (Room 4, 2nd Floor) unless it's directorate-specific.
5. Keep responses short: "Direct them to [Directorate] — Deputy Director's office, Room XX, Xth Floor."

=== LOOKUP FUNCTIONS ===
When you need live data, output a lookup command on its own line:
- LOOKUP_OFFICER:<name> — search officers by name
- LOOKUP_DIRECTORATE:<query> — search directorates
- LOOKUP_VISITOR:<name> — search visitors by name
- LOOKUP_STATS:today — get today's visit statistics
- LOOKUP_ACTIVE — get currently active visits

=== RULES ===
- Only answer questions related to OHCS SmartGate operations
- You are read-only — you cannot create visitors, check anyone in, or modify data
- Keep responses concise (2-3 sentences)
- Use Ghana conventions: DD/MM/YYYY dates, 12hr time
- If unsure about routing, say so and suggest the visitor ask for the specific person
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
    { role: 'system', content: `Lookup result:\n${lookupResult}\n\nNow respond to the user using this data. Be concise. Remember to recommend the Deputy Director's office first unless the Director was specifically requested.` },
  ];

  const secondResponse = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
    messages: secondMessages,
    max_tokens: 300,
  });

  return (secondResponse as { response?: string }).response ?? 'Sorry, I could not process that request.';
}
