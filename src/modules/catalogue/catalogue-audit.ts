import type { DatabaseClient } from '@/lib/db';
import { recordAuditEvent, recordAuditEvents } from '@/modules/audit/audit.service';
import type { AuditAction, AuditData } from '@/modules/audit/audit.types';
import type { RequestMetadata, StaffContext } from '@/modules/identity/access-control';

export interface CatalogueActor {
  staff: StaffContext;
  metadata: RequestMetadata;
}

export type CatalogueEntityType =
  | 'product_type'
  | 'attribute_definition'
  | 'brand'
  | 'product'
  | 'product_variant'
  | 'product_media'
  | 'category'
  | 'product_group';

// Audit data is flat (TD-014): structured values such as attributes are stored as JSON text.
export function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

export function recordCatalogueEvent(
  database: DatabaseClient,
  actor: CatalogueActor,
  event: {
    action: AuditAction;
    entityType: CatalogueEntityType;
    entityId: string;
    before?: AuditData;
    after?: AuditData;
  },
): Promise<void> {
  return recordAuditEvent(database, {
    actorType: 'STAFF',
    actorId: actor.staff.staffUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    ...(event.before === undefined ? {} : { before: event.before }),
    ...(event.after === undefined ? {} : { after: event.after }),
    ipAddress: actor.metadata.clientIp,
    requestId: actor.metadata.requestId,
  });
}

type CatalogueEvent = Parameters<typeof recordCatalogueEvent>[2];

export function recordCatalogueEvents(
  database: DatabaseClient,
  actor: CatalogueActor,
  events: readonly CatalogueEvent[],
): Promise<void> {
  return recordAuditEvents(
    database,
    events.map((event) => ({
      actorType: 'STAFF' as const,
      actorId: actor.staff.staffUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      ...(event.before === undefined ? {} : { before: event.before }),
      ...(event.after === undefined ? {} : { after: event.after }),
      ipAddress: actor.metadata.clientIp,
      requestId: actor.metadata.requestId,
    })),
  );
}
