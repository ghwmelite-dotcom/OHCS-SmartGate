import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { visitorRoutes } from './routes/visitors';
import { visitRoutes } from './routes/visits';
import { officerRoutes } from './routes/officers';
import { directorateRoutes } from './routes/directorates';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';

const app = new Hono<{ Bindings: Env; Variables: { session: import('./types').SessionData } }>();

app.use('*', cors({
  origin: ['http://localhost:5173', 'http://localhost:8788'],
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.onError(errorHandler);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.route('/api/auth', authRoutes);

app.use('/api/*', authMiddleware);
app.route('/api/visitors', visitorRoutes);
app.route('/api/visits', visitRoutes);
app.route('/api/officers', officerRoutes);
app.route('/api/directorates', directorateRoutes);

export default app;
