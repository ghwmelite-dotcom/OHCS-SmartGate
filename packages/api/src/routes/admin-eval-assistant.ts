import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { chat } from '../services/assistant';
import { success, error } from '../lib/response';

export const adminEvalAssistantRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

interface EvalCase {
  input: string;
  expected: string[];      // Reply should contain AT LEAST ONE of these (case-insensitive).
  category: string;
}

const CASES: EvalCase[] = [
  { input: 'I need to ask about my pension and retirement benefits', expected: ['F&A', 'Finance', 'Room 35', 'Room 10'], category: 'routing' },
  { input: 'I applied for a job last month and want to follow up', expected: ['RTDD', 'Recruitment', 'Training'], category: 'routing' },
  { input: 'My salary was not paid this month, who do I see?', expected: ['RSIMD', 'Salary', 'Room 21', 'F&A'], category: 'routing' },
  { input: 'I have documents to submit', expected: ['Confidential Registry', 'Room 4'], category: 'routing' },
  { input: 'I need help with an IT issue on my computer', expected: ['RSIMD', 'ICT'], category: 'routing' },
  { input: 'I want to apply for study leave', expected: ['RTDD', 'study leave', 'training'], category: 'routing' },
  { input: 'Who handles promotions policy?', expected: ['CMD', 'Career'], category: 'routing' },
  { input: 'I have a query about performance appraisal', expected: ['PBMED', 'performance'], category: 'routing' },
  { input: 'Where do I lodge a Right to Information request?', expected: ['RCU', 'Reforms', 'RTI'], category: 'routing' },
  { input: 'I want to see the Chief Director', expected: ['Chief Director', '2nd Floor'], category: 'routing' },
];

function matches(reply: string, expected: string[]): string | null {
  const lower = reply.toLowerCase();
  for (const e of expected) {
    if (lower.includes(e.toLowerCase())) return e;
  }
  return null;
}

adminEvalAssistantRoutes.post('/', async (c) => {
  const session = c.get('session');
  if (session.role !== 'superadmin') {
    return error(c, 'FORBIDDEN', 'Superadmin access required', 403);
  }

  const start = Date.now();
  const results: Array<{
    input: string;
    expected: string[];
    reply: string;
    matched_keyword: string | null;
    passed: boolean;
    duration_ms: number;
  }> = [];

  for (const ev of CASES) {
    const t0 = Date.now();
    try {
      const reply = await chat([{ role: 'user', content: ev.input }], c.env);
      const matched = matches(reply, ev.expected);
      results.push({
        input: ev.input,
        expected: ev.expected,
        reply,
        matched_keyword: matched,
        passed: matched !== null,
        duration_ms: Date.now() - t0,
      });
    } catch (err) {
      results.push({
        input: ev.input,
        expected: ev.expected,
        reply: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        matched_keyword: null,
        passed: false,
        duration_ms: Date.now() - t0,
      });
    }
  }

  const passed = results.filter(r => r.passed).length;
  return success(c, {
    total: results.length,
    passed,
    failed: results.length - passed,
    pass_rate: Math.round((passed / results.length) * 100),
    total_duration_ms: Date.now() - start,
    cases: results,
  });
});
