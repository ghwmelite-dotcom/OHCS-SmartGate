import { Hono } from 'hono';
import type { Env, SessionData } from '../types';

export const visitRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

visitRoutes.get('/', (c) => c.json({ data: [], error: null }));
