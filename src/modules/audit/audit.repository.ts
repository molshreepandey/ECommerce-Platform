import type { DatabaseClient } from '@/lib/db';

import type { AuditEvent } from './audit.types';

export async function insertAuditLog(database: DatabaseClient, event: AuditEvent): Promise<void> {
  await database.auditLog.create({
    data: {
      actorType: event.actorType,
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      ...(event.before === undefined ? {} : { before: event.before }),
      ...(event.after === undefined ? {} : { after: event.after }),
      ipAddress: event.ipAddress,
      requestId: event.requestId,
    },
    select: { id: true },
  });
}
