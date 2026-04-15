import { Hono } from 'hono';
import type { Env, SessionData } from '../types';

export const directorateRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

directorateRoutes.get('/', (c) => c.json({ data: [], error: null }));
