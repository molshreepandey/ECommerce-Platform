import { isIP } from 'node:net';

import type { DatabaseClient } from '@/lib/db';

import { insertAuditLog } from './audit.repository';
import type { AuditData, AuditEvent } from './audit.types';

const sensitiveKeyPattern = /pass(word)?|hash|token|secret|otp|cookie|session|credential/i;

export function removeSensitiveFields(data: AuditData | undefined): AuditData | undefined {
  if (data === undefined) return undefined;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !sensitiveKeyPattern.test(key)));
}

// Pass the transaction client so the audit row commits or rolls back with the change it describes.
export async function recordAuditEvent(database: DatabaseClient, event: AuditEvent): Promise<void> {
  const before = removeSensitiveFields(event.before);
  const after = removeSensitiveFields(event.after);
  await insertAuditLog(database, {
    ...event,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ipAddress: event.ipAddress !== null && isIP(event.ipAddress) !== 0 ? event.ipAddress : null,
  });
}
