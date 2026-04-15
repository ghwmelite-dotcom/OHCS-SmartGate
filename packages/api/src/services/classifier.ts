import type { Env } from '../types';

const CATEGORY_SLUGS = [
  'official_meeting', 'document_submission', 'job_inquiry', 'complaint',
  'personal_visit', 'delivery', 'scheduled_appointment', 'consultation',
  'inspection', 'training', 'interview', 'other',
] as const;

const SYSTEM_PROMPT = `You are a visit classifier for OHCS (Office of the Head of Civil Service, Ghana).
Classify the visitor's stated purpose into exactly one category.
Return ONLY the slug, nothing else.

Categories:
- official_meeting: Official meetings with officers
- document_submission: Submitting or collecting documents
- job_inquiry: Job applications, recruitment inquiries
- complaint: Complaints, petitions, grievances
- personal_visit: Personal visits to staff
- delivery: Deliveries or collections
- scheduled_appointment: Pre-arranged appointments
- consultation: Advisory or consultation meetings
- inspection: Inspections, audits
- training: Training sessions, workshops
- interview: Job interviews
- other: Does not fit any category`;

export async function classifyPurpose(purposeRaw: string, env: Env): Promise<string | null> {
  try {
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast' as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: purposeRaw },
      ],
      max_tokens: 20,
    });

    const slug = (response as { response?: string }).response?.trim().toLowerCase();
    if (slug && (CATEGORY_SLUGS as readonly string[]).includes(slug)) {
      return slug;
    }
    return null;
  } catch (err) {
    console.error('[Classifier] Failed:', err);
    return null;
  }
}

export async function classifyAndUpdate(
  visitId: string,
  purposeRaw: string,
  directorate_id: string | null,
  env: Env
): Promise<void> {
  const slug = await classifyPurpose(purposeRaw, env);
  if (!slug) return;

  const updates: string[] = ['purpose_category = ?'];
  const params: unknown[] = [slug];

  if (!directorate_id) {
    const hint = await env.DB.prepare(
      'SELECT directorate_hint_id FROM visit_categories WHERE slug = ? AND directorate_hint_id IS NOT NULL'
    ).bind(slug).first<{ directorate_hint_id: string }>();

    if (hint?.directorate_hint_id) {
      updates.push('directorate_id = ?');
      params.push(hint.directorate_hint_id);
    }
  }

  params.push(visitId);
  await env.DB.prepare(`UPDATE visits SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();
}
