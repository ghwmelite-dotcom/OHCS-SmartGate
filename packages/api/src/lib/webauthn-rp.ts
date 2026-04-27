import type { Env } from '../types';

// Origins allowed to initiate WebAuthn flows. The PWA's origin determines the RP ID.
const PROD_RP_ORIGINS = new Set([
  'https://staff-attendance.pages.dev',
  'https://ohcs-smartgate.pages.dev',
]);

const DEV_RP_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:8788',
]);

export interface RpConfig {
  rpID: string;
  rpName: string;
  origin: string;
}

interface MinContext {
  env: Env;
  req: { header: (name: string) => string | undefined };
}

/**
 * Resolves the Relying Party config from the request Origin. Enforces the
 * allowlist so a hostile caller can't spoof an RP ID to harvest credentials.
 */
export function resolveRp(c: MinContext): RpConfig | null {
  const origin = c.req.header('origin') ?? '';
  const allowed = c.env.ENVIRONMENT === 'production'
    ? PROD_RP_ORIGINS
    : new Set([...PROD_RP_ORIGINS, ...DEV_RP_ORIGINS]);
  if (!allowed.has(origin)) return null;
  try {
    const url = new URL(origin);
    // The RP name is what shows in the OS/browser passkey prompt — match the
    // brand of the app the user is actually authenticating against.
    const rpName = url.hostname === 'ohcs-smartgate.pages.dev'
      ? 'OHCS VMS'
      : url.hostname === 'staff-attendance.pages.dev'
        ? 'OHCS Staff Attendance'
        : 'OHCS SmartGate';
    return {
      rpID: url.hostname,
      rpName,
      origin,
    };
  } catch {
    return null;
  }
}
