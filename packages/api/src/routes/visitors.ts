import { Hono } from 'hono';
import type { Env, SessionData } from '../types';

export const visitorRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

visitorRoutes.get('/', (c) => c.json({ data: [], error: null }));
