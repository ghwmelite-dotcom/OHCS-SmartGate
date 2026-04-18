import appliedMigrations from './migration-applied-migrations.sql?raw';
import attendance from './migration-attendance.sql?raw';
import grade from './migration-grade.sql?raw';
import hostManual from './migration-host-manual.sql?raw';
import phase2 from './migration-phase2.sql?raw';
import photos from './migration-photos.sql?raw';
import pinAuth from './migration-pin-auth.sql?raw';
import pinAcknowledged from './migration-pin-acknowledged.sql?raw';
import pushSubscriptions from './migration-push-subscriptions.sql?raw';
import clockIdempotency from './migration-clock-idempotency.sql?raw';
import visitsIdempotency from './migration-visits-idempotency.sql?raw';
import absenceNotices from './migration-absence-notices.sql?raw';
import notificationsIndex from './migration-notifications-index.sql?raw';

export const MIGRATIONS: Array<{ filename: string; sql: string }> = [
  { filename: 'migration-applied-migrations.sql', sql: appliedMigrations },
  { filename: 'migration-attendance.sql', sql: attendance },
  { filename: 'migration-grade.sql', sql: grade },
  { filename: 'migration-host-manual.sql', sql: hostManual },
  { filename: 'migration-phase2.sql', sql: phase2 },
  { filename: 'migration-photos.sql', sql: photos },
  { filename: 'migration-pin-auth.sql', sql: pinAuth },
  { filename: 'migration-pin-acknowledged.sql', sql: pinAcknowledged },
  { filename: 'migration-push-subscriptions.sql', sql: pushSubscriptions },
  { filename: 'migration-clock-idempotency.sql', sql: clockIdempotency },
  { filename: 'migration-visits-idempotency.sql', sql: visitsIdempotency },
  { filename: 'migration-absence-notices.sql', sql: absenceNotices },
  { filename: 'migration-notifications-index.sql', sql: notificationsIndex },
];

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
