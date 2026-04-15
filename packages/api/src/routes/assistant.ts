import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { chat } from '../services/assistant';
import { success, error } from '../lib/response';

export const assistantRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(1000),
  })).min(1).max(20),
});

assistantRoutes.post('/chat', zValidator('json', chatSchema), async (c) => {
  const { messages } = c.req.valid('json');

  try {
    const reply = await chat(messages, c.env);
    return success(c, { reply });
  } catch (err) {
    console.error('[Assistant] Error:', err);
    return error(c, 'AI_ERROR', 'The assistant is temporarily unavailable', 503);
  }
});
