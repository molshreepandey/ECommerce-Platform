import type { DatabaseClient } from '@/lib/db';
import type { AuditAction } from '@/modules/audit/audit.types';

import { actorColumns, type InventoryActor } from './inventory-actor';
import { recordInventoryEvents } from './inventory-audit';
import {
  insertMovements,
  returnRequestReferenceType,
  shipmentReferenceType,
} from './inventory-movement.repository';
import { stockKey, type StockLevelRow } from './stock-level.repository';
import { type MovementResult, movementResults } from './stock-request-result';

// Each kind fixes its reference type, the audit field naming the reference, and the audit action, so a
// mismatched combination cannot be written.
const lineMovementKinds = {
  DISPATCH: {
    referenceType: shipmentReferenceType,
    referenceField: 'shipmentId',
    action: 'inventory.stock_dispatched',
  },
  RTO_RESTOCK: {
    referenceType: shipmentReferenceType,
    referenceField: 'shipmentId',
    action: 'inventory.shipment_restocked',
  },
  RETURN_RESTOCK: {
    referenceType: returnRequestReferenceType,
    referenceField: 'returnRequestId',
    action: 'inventory.return_restocked',
  },
} as const satisfies Record<
  string,
  { referenceType: string; referenceField: string; action: AuditAction }
>;

export type LineMovementType = keyof typeof lineMovementKinds;

export interface LineStockChange {
  referenceId: string;
  quantityDelta: number;
  before: StockLevelRow;
  after: StockLevelRow;
}

// One movement and one audit row per changed line. Each (reference, variant, warehouse) appears once, so
// every audit row finds its own movement.
export async function recordLineMovements(
  transaction: DatabaseClient,
  actor: InventoryActor,
  movementType: LineMovementType,
  changes: readonly LineStockChange[],
): Promise<MovementResult[]> {
  const kind = lineMovementKinds[movementType];
  const recorded = await insertMovements(
    transaction,
    changes.map(({ referenceId, quantityDelta, after }) => ({
      variantId: after.variantId,
      warehouseId: after.warehouseId,
      movementType,
      quantityDelta,
      onHandAfter: after.onHandQuantity,
      reservedAfter: after.reservedQuantity,
      referenceType: kind.referenceType,
      referenceId,
      ...actorColumns(actor),
      reason: null,
    })),
  );
  const movementIdByLine = new Map(
    recorded.map((movement) => [
      `${movement.referenceId ?? ''}/${stockKey(movement)}`,
      movement.id,
    ]),
  );
  await recordInventoryEvents(
    transaction,
    actor,
    changes.map(({ referenceId, quantityDelta, before, after }) => {
      const movementId = movementIdByLine.get(`${referenceId}/${stockKey(after)}`);
      if (movementId === undefined) throw new Error('A stock line has no recorded movement');
      return {
        action: kind.action,
        entityType: 'inventory_movement' as const,
        entityId: movementId,
        before: {
          onHandQuantity: before.onHandQuantity,
          reservedQuantity: before.reservedQuantity,
        },
        after: {
          onHandQuantity: after.onHandQuantity,
          reservedQuantity: after.reservedQuantity,
          quantityDelta,
          movementType,
          variantId: after.variantId,
          warehouseId: after.warehouseId,
          [kind.referenceField]: referenceId,
        },
      };
    }),
  );
  return movementResults(recorded);
}
