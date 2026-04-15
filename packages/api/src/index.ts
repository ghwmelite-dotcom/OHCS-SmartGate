import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authRoutes } from './routes/auth';
import { visitorRoutes } from './routes/visitors';
import { visitRoutes } from './routes/visits';
import { officerRoutes } from './routes/officers';
import { directorateRoutes } from './routes/directorates';
import { notificationRoutes } from './routes/notifications';
import { telegramWebhook, telegramLinkRoute } from './routes/telegram';
import { badgeRoutes, serveBadgePage } from './routes/badges';
import { assistantRoutes } from './routes/assistant';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/error-handler';

const app = new Hono<{ Bindings: Env; Variables: { session: import('./types').SessionData } }>();

app.use('*', cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:8788',
      'https://ohcs-smartgate.pages.dev',
    ];
    if (allowed.includes(origin)) return origin;
    if (origin.endsWith('.ohcs-smartgate.pages.dev')) return origin;
    return allowed[0]!;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.onError(errorHandler);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Public routes (no auth)
app.route('/api/auth', authRoutes);
app.route('/api/badges', badgeRoutes);
app.get('/badge/:code', serveBadgePage);
app.post('/api/telegram/webhook', telegramWebhook);

// Protected routes
app.use('/api/*', authMiddleware);
app.route('/api/visitors', visitorRoutes);
app.route('/api/visits', visitRoutes);
app.route('/api/officers', officerRoutes);
app.route('/api/directorates', directorateRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/assistant', assistantRoutes);
app.post('/api/telegram/link', telegramLinkRoute);

export default app;
