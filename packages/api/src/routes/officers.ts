import { Hono } from 'hono';
import type { Env, SessionData } from '../types';

export const officerRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

officerRoutes.get('/', (c) => c.json({ data: [], error: null }));
