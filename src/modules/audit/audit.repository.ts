import type { DatabaseClient } from '@/lib/db';

import type { AuditEvent } from './audit.types';

export async function insertAuditLogs(
  database: DatabaseClient,
  events: readonly AuditEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await database.auditLog.createMany({
    data: events.map((event) => ({
      actorType: event.actorType,
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      ...(event.before === undefined ? {} : { before: event.before }),
      ...(event.after === undefined ? {} : { after: event.after }),
      ipAddress: event.ipAddress,
      requestId: event.requestId,
    })),
  });
}

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

export interface AuditListFilters {
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  actionPrefix: string | null;
  createdFrom: Date | null;
  createdTo: Date | null;
  beforeId: string | null;
  limit: number;
}

// Keyset pages on id DESC: ids are uuidv7 (time-ordered), so the primary key gives newest-first pages;
// entity and actor filters use audit_logs(entity_type, entity_id, …) and audit_logs(actor_id, …).
export function listAuditRows(database: DatabaseClient, filters: AuditListFilters) {
  return database.auditLog.findMany({
    where: {
      ...(filters.entityType === null ? {} : { entityType: filters.entityType }),
      ...(filters.entityId === null ? {} : { entityId: filters.entityId }),
      ...(filters.actorId === null ? {} : { actorId: filters.actorId }),
      ...(filters.actionPrefix === null ? {} : { action: { startsWith: filters.actionPrefix } }),
      ...(filters.createdFrom === null && filters.createdTo === null
        ? {}
        : {
            createdAt: {
              ...(filters.createdFrom === null ? {} : { gte: filters.createdFrom }),
              ...(filters.createdTo === null ? {} : { lt: filters.createdTo }),
            },
          }),
      ...(filters.beforeId === null ? {} : { id: { lt: filters.beforeId } }),
    },
    select: {
      id: true,
      actorType: true,
      actorId: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      ipAddress: true,
      requestId: true,
      createdAt: true,
    },
    orderBy: [{ id: 'desc' }],
    take: filters.limit + 1,
  });
}
