import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, SessionData } from '../types';
import { success, error, created, notFound } from '../lib/response';
import { hashPin } from '../services/auth';
import { requireRole } from '../lib/require-role';

export const adminNssRoutes = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const NSS_NUMBER_REGEX = /^NSS[A-Z]{3}\d{7}$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Generate a 6-digit numeric initial PIN using the Web Crypto RNG.
 * Range [100000, 999999] inclusive.
 */
function generateInitialPin(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = 100000 + (buf[0]! % 900000);
  return n.toString();
}

function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE_REGEX.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

interface NssUserRow {
  id: string;
  name: string;
  email: string;
  staff_id: string | null;
  role: string;
  grade: string | null;
  is_active: number;
  user_type: string;
  nss_number: string | null;
  nss_start_date: string | null;
  nss_end_date: string | null;
  directorate_id: string | null;
  directorate_abbr: string | null;
  pin_acknowledged: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

const NSS_SELECT_COLUMNS = `
  u.id, u.name, u.email, u.staff_id, u.role, u.grade, u.is_active,
  u.user_type, u.nss_number, u.nss_start_date, u.nss_end_date,
  u.directorate_id, d.abbreviation AS directorate_abbr,
  u.pin_acknowledged, u.last_login_at, u.created_at, u.updated_at
`;

/* ------------------------------------------------------------------ */
/*  Create — POST /api/admin/nss                                       */
/* ------------------------------------------------------------------ */

const createNssSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  email: z.string().email().max(255).toLowerCase().trim(),
  nss_number: z
    .string()
    .trim()
    .regex(NSS_NUMBER_REGEX, 'NSS number must match format NSSXXX0000000 (e.g. NSSGUE8364724)'),
  nss_start_date: z.string().refine(isValidIsoDate, 'nss_start_date must be ISO YYYY-MM-DD'),
  nss_end_date: z.string().refine(isValidIsoDate, 'nss_end_date must be ISO YYYY-MM-DD'),
  directorate_id: z.string().min(1, 'directorate_id is required'),
  grade: z.string().max(100).optional().or(z.literal('')),
});

adminNssRoutes.post('/', zValidator('json', createNssSchema), async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'f_and_a_admin');
  if (forbidden) return forbidden;

  const body = c.req.valid('json');

  if (body.nss_end_date <= body.nss_start_date) {
    return error(c, 'INVALID_RANGE', 'nss_end_date must be after nss_start_date', 400);
  }

  // Verify directorate exists
  const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE id = ?')
    .bind(body.directorate_id)
    .first<{ id: string }>();
  if (!dir) return error(c, 'INVALID_DIRECTORATE', 'directorate_id does not reference an existing directorate', 400);

  // Uniqueness — email
  const existingEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(body.email)
    .first();
  if (existingEmail) return error(c, 'DUPLICATE_EMAIL', 'A user with this email already exists', 409);

  // Uniqueness — nss_number
  const existingNss = await c.env.DB.prepare('SELECT id FROM users WHERE nss_number = ?')
    .bind(body.nss_number)
    .first();
  if (existingNss) return error(c, 'DUPLICATE_NSS_NUMBER', 'A user with this NSS number already exists', 409);

  const id = crypto.randomUUID().replace(/-/g, '');
  const initialPin = generateInitialPin();
  const pinHash = await hashPin(initialPin);

  await c.env.DB.prepare(
    `INSERT INTO users
       (id, name, email, pin_hash, pin_acknowledged, role, grade, directorate_id,
        user_type, nss_number, nss_start_date, nss_end_date, is_active)
     VALUES (?, ?, ?, ?, 0, 'staff', ?, ?, 'nss', ?, ?, ?, 1)`
  )
    .bind(
      id,
      body.name,
      body.email,
      pinHash,
      body.grade || null,
      body.directorate_id,
      body.nss_number,
      body.nss_start_date,
      body.nss_end_date,
    )
    .run();

  const user = await c.env.DB.prepare(
    `SELECT ${NSS_SELECT_COLUMNS}
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id
     WHERE u.id = ?`
  )
    .bind(id)
    .first<NssUserRow>();

  return created(c, { user, initial_pin: initialPin });
});

/* ------------------------------------------------------------------ */
/*  List — GET /api/admin/nss                                          */
/* ------------------------------------------------------------------ */

adminNssRoutes.get('/', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'f_and_a_admin');
  if (forbidden) return forbidden;

  const directorateId = c.req.query('directorate_id') ?? null;
  const status = (c.req.query('status') ?? 'active') as 'active' | 'expiring' | 'ended' | 'all';
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);

  const where: string[] = [`u.user_type = 'nss'`];
  const params: unknown[] = [];

  if (directorateId) { where.push('u.directorate_id = ?'); params.push(directorateId); }

  if (status === 'active') {
    where.push('u.is_active = 1');
    where.push('(u.nss_end_date IS NULL OR u.nss_end_date >= ?)');
    params.push(today);
  } else if (status === 'expiring') {
    where.push('u.is_active = 1');
    where.push('u.nss_end_date IS NOT NULL AND u.nss_end_date >= ? AND u.nss_end_date <= ?');
    params.push(today, in30);
  } else if (status === 'ended') {
    where.push('u.nss_end_date IS NOT NULL AND u.nss_end_date < ?');
    params.push(today);
  }
  // 'all' adds no further constraints.

  if (q) {
    where.push('(LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.nss_number) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const sql = `
    SELECT ${NSS_SELECT_COLUMNS}
    FROM users u
    LEFT JOIN directorates d ON u.directorate_id = d.id
    WHERE ${where.join(' AND ')}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const result = await c.env.DB.prepare(sql).bind(...params).all<NssUserRow>();
  return success(c, result.results ?? []);
});

/* ------------------------------------------------------------------ */
/*  Detail — GET /api/admin/nss/:id                                    */
/* ------------------------------------------------------------------ */

adminNssRoutes.get('/:id', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'f_and_a_admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT ${NSS_SELECT_COLUMNS}
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id
     WHERE u.id = ? AND u.user_type = 'nss'`
  )
    .bind(id)
    .first<NssUserRow>();

  if (!row) return notFound(c, 'NSS user');
  return success(c, row);
});

/* ------------------------------------------------------------------ */
/*  Update — PATCH /api/admin/nss/:id                                  */
/* ------------------------------------------------------------------ */

const updateNssSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  grade: z.string().max(100).optional().or(z.literal('')),
  directorate_id: z.string().min(1).optional(),
  nss_start_date: z.string().refine(isValidIsoDate, 'nss_start_date must be ISO YYYY-MM-DD').optional(),
  nss_end_date: z.string().refine(isValidIsoDate, 'nss_end_date must be ISO YYYY-MM-DD').optional(),
  is_active: z.number().min(0).max(1).optional(),
});

adminNssRoutes.patch('/:id', zValidator('json', updateNssSchema), async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'f_and_a_admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const body = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    `SELECT id, user_type, nss_start_date, nss_end_date FROM users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; user_type: string; nss_start_date: string | null; nss_end_date: string | null }>();

  if (!existing) return notFound(c, 'NSS user');
  if (existing.user_type !== 'nss') {
    return error(c, 'NOT_NSS', 'Target user is not an NSS personnel', 400);
  }

  // Resolved final dates (after edits) — used to validate ordering.
  const finalStart = body.nss_start_date ?? existing.nss_start_date;
  const finalEnd = body.nss_end_date ?? existing.nss_end_date;
  if (finalStart && finalEnd && finalEnd <= finalStart) {
    return error(c, 'INVALID_RANGE', 'nss_end_date must be after nss_start_date', 400);
  }

  if (body.directorate_id !== undefined) {
    const dir = await c.env.DB.prepare('SELECT id FROM directorates WHERE id = ?')
      .bind(body.directorate_id)
      .first();
    if (!dir) return error(c, 'INVALID_DIRECTORATE', 'directorate_id does not reference an existing directorate', 400);
  }

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
  if (body.grade !== undefined) { fields.push('grade = ?'); values.push(body.grade || null); }
  if (body.directorate_id !== undefined) { fields.push('directorate_id = ?'); values.push(body.directorate_id); }
  if (body.nss_start_date !== undefined) { fields.push('nss_start_date = ?'); values.push(body.nss_start_date); }
  if (body.nss_end_date !== undefined) { fields.push('nss_end_date = ?'); values.push(body.nss_end_date); }
  if (body.is_active !== undefined) { fields.push('is_active = ?'); values.push(body.is_active); }

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  if (fields.length > 1) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  const row = await c.env.DB.prepare(
    `SELECT ${NSS_SELECT_COLUMNS}
     FROM users u LEFT JOIN directorates d ON u.directorate_id = d.id
     WHERE u.id = ?`
  )
    .bind(id)
    .first<NssUserRow>();

  return success(c, row);
});

/* ------------------------------------------------------------------ */
/*  Soft delete — DELETE /api/admin/nss/:id                            */
/* ------------------------------------------------------------------ */

adminNssRoutes.delete('/:id', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'f_and_a_admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id, user_type FROM users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; user_type: string }>();

  if (!existing) return notFound(c, 'NSS user');
  if (existing.user_type !== 'nss') {
    return error(c, 'NOT_NSS', 'Target user is not an NSS personnel', 400);
  }

  await c.env.DB.prepare(
    `UPDATE users SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?`
  )
    .bind(id)
    .run();

  return success(c, { message: 'NSS user deactivated' });
});

/* ------------------------------------------------------------------ */
/*  Reset PIN — POST /api/admin/nss/:id/reset-pin                      */
/* ------------------------------------------------------------------ */

adminNssRoutes.post('/:id/reset-pin', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'f_and_a_admin');
  if (forbidden) return forbidden;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id, user_type FROM users WHERE id = ?`
  )
    .bind(id)
    .first<{ id: string; user_type: string }>();

  if (!existing) return notFound(c, 'NSS user');
  if (existing.user_type !== 'nss') {
    return error(c, 'NOT_NSS', 'Target user is not an NSS personnel', 400);
  }

  const initialPin = generateInitialPin();
  const pinHash = await hashPin(initialPin);

  await c.env.DB.prepare(
    `UPDATE users
        SET pin_hash = ?, pin_acknowledged = 0,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ?`
  )
    .bind(pinHash, id)
    .run();

  return success(c, { initial_pin: initialPin });
});

/* ------------------------------------------------------------------ */
/*  Bulk import — POST /api/admin/nss/bulk-import                       */
/*                                                                      */
/*  Accepts either:                                                     */
/*    { csv: "header,...\nrow,..." }    — CSV string                    */
/*    { rows: [ { ... } ] }              — pre-parsed rows               */
/* ------------------------------------------------------------------ */

interface BulkImportRow {
  name?: string;
  email?: string;
  nss_number?: string;
  nss_start_date?: string;
  nss_end_date?: string;
  directorate_abbreviation?: string;
}

const NSS_BULK_HEADERS = [
  'name',
  'email',
  'nss_number',
  'nss_start_date',
  'nss_end_date',
  'directorate_abbreviation',
] as const;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function parseCsv(text: string): BulkImportRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows: BulkImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
    rows.push(row as BulkImportRow);
  }
  return rows;
}

adminNssRoutes.post('/bulk-import', async (c) => {
  const forbidden = requireRole(c, 'superadmin', 'f_and_a_admin');
  if (forbidden) return forbidden;

  let payload: { csv?: string; rows?: unknown[] };
  try {
    payload = (await c.req.json()) as { csv?: string; rows?: unknown[] };
  } catch {
    return error(c, 'BAD_JSON', 'Body must be valid JSON: { csv } or { rows }', 400);
  }

  let rows: BulkImportRow[] = [];
  if (typeof payload.csv === 'string' && payload.csv.trim().length > 0) {
    rows = parseCsv(payload.csv);
  } else if (Array.isArray(payload.rows)) {
    rows = payload.rows as BulkImportRow[];
  } else {
    return error(c, 'EMPTY', 'Provide either "csv" string or "rows" array', 400);
  }

  if (rows.length === 0) return error(c, 'EMPTY', 'No rows to import', 400);
  if (rows.length > 200) return error(c, 'TOO_MANY', 'Maximum 200 rows per import', 400);

  // Pre-fetch directorate abbreviation -> id map for performance & consistency.
  const dirRes = await c.env.DB.prepare('SELECT id, abbreviation FROM directorates').all<{ id: string; abbreviation: string }>();
  const dirMap = new Map<string, string>();
  for (const d of dirRes.results ?? []) {
    dirMap.set(d.abbreviation.toUpperCase(), d.id);
  }

  const skipped: Array<{ row: number; reason: string }> = [];
  const inserted: Array<{ row: number; id: string; name: string; email: string; nss_number: string; initial_pin: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 for 1-indexed, +1 for header
    const r = rows[i] ?? {};

    const name = (r.name ?? '').toString().trim();
    const email = (r.email ?? '').toString().trim().toLowerCase();
    const nss_number = (r.nss_number ?? '').toString().trim();
    const nss_start_date = (r.nss_start_date ?? '').toString().trim();
    const nss_end_date = (r.nss_end_date ?? '').toString().trim();
    const dirAbbrRaw = (r.directorate_abbreviation ?? '').toString().trim();
    const dirAbbr = dirAbbrRaw.toUpperCase();

    if (!name) { skipped.push({ row: rowNumber, reason: 'name is required' }); continue; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ row: rowNumber, reason: 'invalid email' }); continue;
    }
    if (!NSS_NUMBER_REGEX.test(nss_number)) {
      skipped.push({ row: rowNumber, reason: 'nss_number must match NSSXXX0000000' }); continue;
    }
    if (!isValidIsoDate(nss_start_date)) {
      skipped.push({ row: rowNumber, reason: 'nss_start_date must be ISO YYYY-MM-DD' }); continue;
    }
    if (!isValidIsoDate(nss_end_date)) {
      skipped.push({ row: rowNumber, reason: 'nss_end_date must be ISO YYYY-MM-DD' }); continue;
    }
    if (nss_end_date <= nss_start_date) {
      skipped.push({ row: rowNumber, reason: 'nss_end_date must be after nss_start_date' }); continue;
    }
    const directorateId = dirMap.get(dirAbbr);
    if (!directorateId) {
      skipped.push({ row: rowNumber, reason: `unknown directorate_abbreviation: ${dirAbbrRaw}` }); continue;
    }

    // Uniqueness — email
    const dupEmail = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (dupEmail) { skipped.push({ row: rowNumber, reason: `duplicate email: ${email}` }); continue; }

    // Uniqueness — nss_number
    const dupNss = await c.env.DB.prepare('SELECT id FROM users WHERE nss_number = ?').bind(nss_number).first();
    if (dupNss) { skipped.push({ row: rowNumber, reason: `duplicate nss_number: ${nss_number}` }); continue; }

    const id = crypto.randomUUID().replace(/-/g, '');
    const initialPin = generateInitialPin();
    const pinHash = await hashPin(initialPin);

    await c.env.DB.prepare(
      `INSERT INTO users
         (id, name, email, pin_hash, pin_acknowledged, role, directorate_id,
          user_type, nss_number, nss_start_date, nss_end_date, is_active)
       VALUES (?, ?, ?, ?, 0, 'staff', ?, 'nss', ?, ?, ?, 1)`
    )
      .bind(id, name, email, pinHash, directorateId, nss_number, nss_start_date, nss_end_date)
      .run();

    inserted.push({ row: rowNumber, id, name, email, nss_number, initial_pin: initialPin });
  }

  return success(c, {
    inserted: inserted.length,
    skipped,
    pins: inserted.map(({ row, name, email, nss_number, initial_pin }) => ({ row, name, email, nss_number, initial_pin })),
  });
});

export const NSS_BULK_IMPORT_HEADERS = NSS_BULK_HEADERS;
