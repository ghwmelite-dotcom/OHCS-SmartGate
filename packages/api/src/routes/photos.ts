import { Hono } from 'hono';
import type { Env, SessionData } from '../types';
import { success, error, notFound } from '../lib/response';

export const photoRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Upload visitor photo — accepts raw JPEG body
photoRoutes.post('/visitors/:id/photo', async (c) => {
  const visitorId = c.req.param('id');

  const visitor = await c.env.DB.prepare('SELECT id FROM visitors WHERE id = ?').bind(visitorId).first();
  if (!visitor) return notFound(c, 'Visitor');

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return error(c, 'EMPTY_BODY', 'No photo data', 400);
  if (body.byteLength > 500_000) return error(c, 'TOO_LARGE', 'Photo must be under 500KB', 400);

  const key = `photos/visitors/${visitorId}.jpg`;

  await c.env.STORAGE.put(key, body, {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  const photoUrl = `/api/photos/visitors/${visitorId}`;

  await c.env.DB.prepare(
    "UPDATE visitors SET photo_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
  ).bind(photoUrl, visitorId).run();

  return success(c, { photo_url: photoUrl });
});

// Serve visitor photo from R2
photoRoutes.get('/visitors/:id', async (c) => {
  const visitorId = c.req.param('id');
  const key = `photos/visitors/${visitorId}.jpg`;

  const object = await c.env.STORAGE.get(key);
  if (!object) return notFound(c, 'Photo');

  const headers = new Headers();
  headers.set('Content-Type', 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(object.body, { headers });
});
