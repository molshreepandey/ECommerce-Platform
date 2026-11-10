import { isIP } from 'node:net';

import type { DatabaseClient } from '@/lib/db';

import { insertAuditLog, insertAuditLogs } from './audit.repository';
import type { AuditData, AuditEvent } from './audit.types';

const sensitiveKeyPattern = /pass(word)?|hash|token|secret|otp|cookie|session|credential/i;

export function removeSensitiveFields(data: AuditData | undefined): AuditData | undefined {
  if (data === undefined) return undefined;
  return Object.fromEntries(Object.entries(data).filter(([key]) => !sensitiveKeyPattern.test(key)));
}

function sanitisedEvent(event: AuditEvent): AuditEvent {
  const before = removeSensitiveFields(event.before);
  const after = removeSensitiveFields(event.after);
  return {
    actorType: event.actorType,
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ipAddress: event.ipAddress !== null && isIP(event.ipAddress) !== 0 ? event.ipAddress : null,
    requestId: event.requestId,
  };
}

// Pass the transaction client so the audit row commits or rolls back with the change it describes.
export async function recordAuditEvent(database: DatabaseClient, event: AuditEvent): Promise<void> {
  await insertAuditLog(database, sanitisedEvent(event));
}

// One insert for a bulk change (for example tagging many products); each row is sanitised the same way.
export async function recordAuditEvents(
  database: DatabaseClient,
  events: readonly AuditEvent[],
): Promise<void> {
  await insertAuditLogs(database, events.map(sanitisedEvent));
}
