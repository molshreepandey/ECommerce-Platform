import { getDatabase } from '@/lib/db';
import { assertStaffPermission } from '@/modules/identity/access-control';
import { enqueueProductsOfVariants } from '@/modules/search/search-outbox.repository';

import { idempotentStockChange } from './idempotent-stock-request';
import { actorColumns, type StaffInventoryActor } from './inventory-actor';
import { recordInventoryEvents } from './inventory-audit';
import { idempotencyKeySchema, type ReceiveStockInput } from './inventory.schema';
import { changeRequestReferenceType, insertMovements } from './inventory-movement.repository';
import {
  changeOnHand,
  insertMissingStockLevels,
  lockStockLevels,
  type StockLevelRow,
} from './stock-level.repository';
import { assertStockLocationsExist } from './stock-locations';
import type { StockRequestResult } from './stock-request-result';

// Physical stock received from a supplier: always RECEIPT movements (never ADJUSTMENT), one per line,
// each carrying the supplier reference as its reason. Allowed for archived variants and inactive
// warehouses (owner decision), because the goods are physically there.
export async function receiveStock(
  actor: StaffInventoryActor,
  idempotencyKey: string,
  input: ReceiveStockInput,
): Promise<StockRequestResult> {
  assertStaffPermission(actor.staff, 'inventory.write');
  const key = idempotencyKeySchema.parse(idempotencyKey);
  const variantIds = input.lines.map(({ variantId }) => variantId);
  await assertStockLocationsExist(getDatabase(), { warehouseId: input.warehouseId, variantIds });
  const keys = variantIds.map((variantId) => ({ variantId, warehouseId: input.warehouseId }));
  return await idempotentStockChange(
    { staff: actor.staff, idempotencyKey: key, operation: 'RECEIPT', input },
    async (transaction, changeRequestId) => {
      await insertMissingStockLevels(transaction, keys);
      const before = new Map(
        (await lockStockLevels(transaction, keys)).map((level) => [level.variantId, level]),
      );
      const changed: { before: StockLevelRow; after: StockLevelRow }[] = [];
      for (const line of input.lines) {
        const previous = before.get(line.variantId);
        const after = await changeOnHand(
          transaction,
          { variantId: line.variantId, warehouseId: input.warehouseId },
          line.quantity,
        );
        if (previous === undefined || after === null) {
          throw new Error('A locked stock row could not receive stock');
        }
        changed.push({ before: previous, after });
      }
      const movements = await insertMovements(
        transaction,
        changed.map(({ before: previous, after }) => ({
          variantId: after.variantId,
          warehouseId: after.warehouseId,
          movementType: 'RECEIPT',
          quantityDelta: after.onHandQuantity - previous.onHandQuantity,
          onHandAfter: after.onHandQuantity,
          reservedAfter: after.reservedQuantity,
          referenceType: changeRequestReferenceType,
          referenceId: changeRequestId,
          ...actorColumns(actor),
          reason: input.supplierReference,
        })),
      );
      await recordInventoryEvents(
        transaction,
        actor,
        movements.map((movement) => {
          const previous = before.get(movement.variantId);
          return {
            action: 'inventory.stock_received' as const,
            entityType: 'inventory_movement' as const,
            entityId: movement.id,
            before: {
              onHandQuantity: previous?.onHandQuantity ?? null,
              reservedQuantity: previous?.reservedQuantity ?? null,
            },
            after: {
              onHandQuantity: movement.onHandAfter,
              reservedQuantity: movement.reservedAfter,
              quantityDelta: movement.quantityDelta,
              movementType: movement.movementType,
              supplierReference: input.supplierReference,
              variantId: movement.variantId,
              warehouseId: movement.warehouseId,
              changeRequestId,
            },
          };
        }),
      );
      await enqueueProductsOfVariants(transaction, variantIds);
      return movements;
    },
  );
}
