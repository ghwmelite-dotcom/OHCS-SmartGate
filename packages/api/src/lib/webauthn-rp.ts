import type { Env } from '../types';

// Origins allowed to initiate WebAuthn flows. The PWA's origin determines the RP ID.
const PROD_RP_ORIGINS = new Set([
  'https://staff-attendance.pages.dev',
  'https://ohcs-smartgate.pages.dev',
  'https://smartgate.ohcsghana.org',
  'https://www.smartgate.ohcsghana.org',
  'https://staff-attendance.ohcsghana.org',
  'https://www.staff-attendance.ohcsghana.org',
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
    const isVms =
      url.hostname === 'ohcs-smartgate.pages.dev' ||
      url.hostname === 'smartgate.ohcsghana.org' ||
      url.hostname === 'www.smartgate.ohcsghana.org';
    const isStaff =
      url.hostname === 'staff-attendance.pages.dev' ||
      url.hostname === 'staff-attendance.ohcsghana.org' ||
      url.hostname === 'www.staff-attendance.ohcsghana.org';
    const rpName = isVms ? 'OHCS VMS' : isStaff ? 'OHCS Staff Attendance' : 'OHCS SmartGate';
    return {
      rpID: url.hostname,
      rpName,
      origin,
    };
  } catch {
    return null;
  }
}
