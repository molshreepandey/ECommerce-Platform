import type { DatabaseClient } from '@/lib/db';
import { recordAuditEvents } from '@/modules/audit/audit.service';
import type { AuditAction, AuditData } from '@/modules/audit/audit.types';

import {
  actorAuditDetails,
  actorColumns,
  actorRequestColumns,
  type InventoryActor,
} from './inventory-actor';

export type InventoryEntityType = 'warehouse' | 'inventory_movement' | 'inventory_level';

export interface InventoryAuditEvent {
  action: AuditAction;
  entityType: InventoryEntityType;
  entityId: string;
  before?: AuditData;
  after?: AuditData;
}

// Written in the caller's transaction. The actor columns come from actorColumns(), the same source as the
// movement rows, so a customer or system action is never attributed to a staff member.
export function recordInventoryEvents(
  transaction: DatabaseClient,
  actor: InventoryActor,
  events: readonly InventoryAuditEvent[],
): Promise<void> {
  const { actorType, actorId } = actorColumns(actor);
  const { ipAddress, requestId } = actorRequestColumns(actor);
  const details = actorAuditDetails(actor);
  return recordAuditEvents(
    transaction,
    events.map((event) => {
      const after = { ...event.after, ...details };
      return {
        actorType,
        actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        ...(event.before === undefined ? {} : { before: event.before }),
        ...(Object.keys(after).length === 0 ? {} : { after }),
        ipAddress,
        requestId,
      };
    }),
  );
}
