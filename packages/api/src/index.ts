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
import { userRoutes } from './routes/users';
import { analyticsRoutes } from './routes/analytics';
import { reportRoutes } from './routes/reports';
import { adminDirectorateRoutes } from './routes/admin-directorates';
import { photoRoutes } from './routes/photos';
import { bulkImportRoutes } from './routes/bulk-import';
import { clockRoutes } from './routes/clock';
import { notificationsPushRoutes } from './routes/notifications-push';
import { attendanceRoutes } from './routes/attendance';
import { sendDailySummary as sendDailySummaryFn } from './services/daily-summary';
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
    if (origin === 'https://staff-attendance.pages.dev' || origin.endsWith('.staff-attendance.pages.dev')) return origin;
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
app.get('/api/photos/visitors/:id', async (c) => {
  const visitorId = c.req.param('id');
  const object = await c.env.STORAGE.get(`photos/visitors/${visitorId}.jpg`);
  if (!object) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Photo not found' } }, 404);
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});
app.get('/api/photos/clock/:id', async (c) => {
  const clockId = c.req.param('id');
  const object = await c.env.STORAGE.get(`photos/clock/${clockId}.jpg`);
  if (!object) return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Photo not found' } }, 404);
  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(object.body, { headers });
});

// Protected routes
app.use('/api/*', authMiddleware);
app.route('/api/visitors', visitorRoutes);
app.route('/api/visits', visitRoutes);
app.route('/api/officers', officerRoutes);
app.route('/api/directorates', directorateRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/notifications/push', notificationsPushRoutes);
app.route('/api/assistant', assistantRoutes);
app.route('/api/users', userRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/admin/directorates', adminDirectorateRoutes);
app.route('/api/admin/import', bulkImportRoutes);
app.route('/api/clock', clockRoutes);
app.route('/api/attendance', attendanceRoutes);
app.route('/api/photos', photoRoutes);
app.post('/api/telegram/link', telegramLinkRoute);

// Manual trigger for daily summary (superadmin only)
app.post('/api/admin/send-daily-summary', async (c) => {
  const session = c.get('session');
  if (session.role !== 'superadmin') return c.json({ error: 'Forbidden' }, 403);
  await sendDailySummaryFn(c.env);
  return c.json({ data: { message: 'Daily summary sent' }, error: null });
});

// Cron trigger handler for daily attendance summary

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await sendDailySummaryFn(env);
  },
};
