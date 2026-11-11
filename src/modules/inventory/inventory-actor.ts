import type { ActorType } from '@/generated/prisma/enums';
import type { CustomerId } from '@/lib/ids';
import type { RequestMetadata, StaffContext } from '@/modules/identity/access-control';

// Who caused a stock movement. Customer and system actions never carry a staff id: the movement row and
// its audit row both take their actor columns from actorColumns(), so they always agree.
export type InventoryActor =
  | { kind: 'STAFF'; staff: StaffContext; metadata: RequestMetadata }
  | { kind: 'CUSTOMER'; customerId: CustomerId; metadata: RequestMetadata }
  | { kind: 'SYSTEM'; process: string; metadata: { requestId: string } };

// Staff-only operations (warehouses, manual stock changes) take this narrower actor.
export type StaffInventoryActor = Extract<InventoryActor, { kind: 'STAFF' }>;

export interface ActorColumns {
  actorType: ActorType;
  actorId: string | null;
}

export interface ActorRequestColumns {
  ipAddress: string | null;
  requestId: string;
}

export function actorColumns(actor: InventoryActor): ActorColumns {
  switch (actor.kind) {
    case 'STAFF':
      return { actorType: 'STAFF', actorId: actor.staff.staffUserId };
    case 'CUSTOMER':
      return { actorType: 'CUSTOMER', actorId: actor.customerId };
    case 'SYSTEM':
      return { actorType: 'SYSTEM', actorId: null };
    default: {
      const unknownActor: never = actor;
      throw new Error(`Unknown inventory actor: ${JSON.stringify(unknownActor)}`);
    }
  }
}

export function actorRequestColumns(actor: InventoryActor): ActorRequestColumns {
  return actor.kind === 'SYSTEM'
    ? { ipAddress: null, requestId: actor.metadata.requestId }
    : { ipAddress: actor.metadata.clientIp, requestId: actor.metadata.requestId };
}

// Extra audit detail: the name of the system process, which has no id of its own.
export function actorAuditDetails(actor: InventoryActor): { systemProcess?: string } {
  return actor.kind === 'SYSTEM' ? { systemProcess: actor.process } : {};
}
