import { getDatabase } from '@/lib/db';
import { assertStaffPermission } from '@/modules/identity/access-control';
import { enqueueProductsOfVariants } from '@/modules/search/search-outbox.repository';

import { idempotentStockChange } from './idempotent-stock-request';
import { actorColumns, type StaffInventoryActor } from './inventory-actor';
import { recordInventoryEvents } from './inventory-audit';
import { inventoryErrors } from './inventory.errors';
import {
  idempotencyKeySchema,
  type TransferStockInput,
  transferStockSchema,
} from './inventory.schema';
import { changeRequestReferenceType, insertMovements } from './inventory-movement.repository';
import {
  changeOnHand,
  insertMissingStockLevels,
  lockStockLevels,
  type StockKey,
  stockKey,
  type StockLevelRow,
} from './stock-level.repository';
import { assertStockLocationsExist } from './stock-locations';
import type { StockRequestResult } from './stock-request-result';
import { assertWithinOnHandLimit } from './stock-rules';

interface TransferStep {
  key: StockKey;
  quantityDelta: number;
}

async function applyStep(
  transaction: Parameters<typeof changeOnHand>[0],
  locked: ReadonlyMap<string, StockLevelRow>,
  step: TransferStep,
): Promise<{ before: StockLevelRow; after: StockLevelRow }> {
  const before = locked.get(stockKey(step.key));
  if (before === undefined) throw new Error('A transfer stock row was not locked');
  assertWithinOnHandLimit(before, step.quantityDelta);
  const after = await changeOnHand(transaction, step.key, step.quantityDelta);
  if (after === null) {
    throw inventoryErrors.outOfStock({
      variantId: step.key.variantId,
      warehouseId: step.key.warehouseId,
      availableQuantity: before.availableQuantity,
      requestedQuantity: -step.quantityDelta,
    });
  }
  return { before, after };
}

// D27: available units (never reserved ones: the guarded update keeps on hand >= reserved) move from one
// warehouse to another in one transaction, with a TRANSFER_OUT and a TRANSFER_IN ledger row per line, so
// the variant's total on hand never changes. Idempotent per staff member and key, like receipts. Inactive
// warehouses and archived variants are allowed, because the goods physically move (draining a warehouse
// that is being closed).
export async function transferStock(
  actor: StaffInventoryActor,
  idempotencyKey: string,
  transfer: TransferStockInput,
): Promise<StockRequestResult> {
  assertStaffPermission(actor.staff, 'inventory.write');
  const key = idempotencyKeySchema.parse(idempotencyKey);
  const input = transferStockSchema.parse(transfer);
  const variantIds = input.lines.map(({ variantId }) => variantId);
  const database = getDatabase();
  await assertStockLocationsExist(database, { warehouseId: input.fromWarehouseId, variantIds });
  await assertStockLocationsExist(database, { warehouseId: input.toWarehouseId, variantIds });
  const steps: TransferStep[] = input.lines.flatMap((line) => [
    {
      key: { variantId: line.variantId, warehouseId: input.fromWarehouseId },
      quantityDelta: -line.quantity,
    },
    {
      key: { variantId: line.variantId, warehouseId: input.toWarehouseId },
      quantityDelta: line.quantity,
    },
  ]);
  const keys = steps.map((step) => step.key);
  return await idempotentStockChange(
    { staff: actor.staff, idempotencyKey: key, operation: 'TRANSFER', input },
    async (transaction, changeRequestId) => {
      // Missing rows (0 on hand) are created for every key so the whole set is locked in one ordered pass;
      // a source row created here has nothing available, so its line fails and everything rolls back.
      await insertMissingStockLevels(transaction, keys);
      const locked = new Map(
        (await lockStockLevels(transaction, keys)).map((level) => [stockKey(level), level]),
      );
      const changed: { before: StockLevelRow; after: StockLevelRow }[] = [];
      for (const step of steps) changed.push(await applyStep(transaction, locked, step));
      const movements = await insertMovements(
        transaction,
        changed.map(({ before, after }) => ({
          variantId: after.variantId,
          warehouseId: after.warehouseId,
          movementType:
            after.onHandQuantity < before.onHandQuantity ? 'TRANSFER_OUT' : 'TRANSFER_IN',
          quantityDelta: after.onHandQuantity - before.onHandQuantity,
          onHandAfter: after.onHandQuantity,
          reservedAfter: after.reservedQuantity,
          referenceType: changeRequestReferenceType,
          referenceId: changeRequestId,
          ...actorColumns(actor),
          reason: input.reason,
        })),
      );
      await recordInventoryEvents(
        transaction,
        actor,
        movements.map((movement) => {
          const before = locked.get(stockKey(movement));
          return {
            action: 'inventory.stock_transferred' as const,
            entityType: 'inventory_movement' as const,
            entityId: movement.id,
            before: {
              onHandQuantity: before?.onHandQuantity ?? null,
              reservedQuantity: before?.reservedQuantity ?? null,
            },
            after: {
              onHandQuantity: movement.onHandAfter,
              reservedQuantity: movement.reservedAfter,
              quantityDelta: movement.quantityDelta,
              movementType: movement.movementType,
              variantId: movement.variantId,
              warehouseId: movement.warehouseId,
              fromWarehouseId: input.fromWarehouseId,
              toWarehouseId: input.toWarehouseId,
              reason: input.reason,
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
