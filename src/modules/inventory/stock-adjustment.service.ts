import { type DatabaseClient, getDatabase } from '@/lib/db';
import type { AuditAction } from '@/modules/audit/audit.types';
import { assertStaffPermission } from '@/modules/identity/access-control';
import { enqueueProductsOfVariants } from '@/modules/search/search-outbox.repository';

import { idempotentStockChange } from './idempotent-stock-request';
import { actorColumns, type StaffInventoryActor } from './inventory-actor';
import { recordInventoryEvents } from './inventory-audit';
import { inventoryErrors } from './inventory.errors';
import {
  type AddStockInput,
  addStockSchema,
  idempotencyKeySchema,
  type RemoveStockInput,
  removeStockSchema,
  type SetStockInput,
  setStockSchema,
} from './inventory.schema';
import { changeRequestReferenceType, insertMovements } from './inventory-movement.repository';
import type { StockRequestOperation } from './request-fingerprint';
import {
  changeOnHand,
  insertMissingStockLevels,
  lockStockLevels,
  setOnHandIfUnchanged,
  type StockKey,
  type StockLevelRow,
} from './stock-level.repository';
import { assertStockLocationsExist } from './stock-locations';
import type { StockRequestResult } from './stock-request-result';
import { type AdjustmentPlan, adjustmentDelta, assertWithinOnHandLimit } from './stock-rules';

type AdjustmentRequest =
  | { operation: 'ADJUST_ADD'; input: AddStockInput }
  | { operation: 'ADJUST_REMOVE'; input: RemoveStockInput }
  | { operation: 'ADJUST_SET'; input: SetStockInput };

const auditActionByOperation = {
  ADJUST_ADD: 'inventory.stock_added',
  ADJUST_REMOVE: 'inventory.stock_removed',
  ADJUST_SET: 'inventory.stock_set',
} as const satisfies Record<AdjustmentRequest['operation'], AuditAction>;

function adjustmentPlan(request: AdjustmentRequest): AdjustmentPlan {
  switch (request.operation) {
    case 'ADJUST_ADD':
      return { operation: 'ADD', quantity: request.input.quantity };
    case 'ADJUST_REMOVE':
      return { operation: 'REMOVE', quantity: request.input.quantity };
    case 'ADJUST_SET':
      return {
        operation: 'SET',
        expectedOnHandQuantity: request.input.expectedOnHandQuantity,
        newOnHandQuantity: request.input.newOnHandQuantity,
      };
    default: {
      const unknownRequest: never = request;
      throw new Error(`Unknown adjustment: ${JSON.stringify(unknownRequest)}`);
    }
  }
}

// Runtime validation at the service boundary (L53): strict schema, trimmed reason, branded ids, so the
// idempotency fingerprint is the same whoever calls and however the input was built.
function validatedRequest(request: AdjustmentRequest): AdjustmentRequest {
  switch (request.operation) {
    case 'ADJUST_ADD':
      return { operation: 'ADJUST_ADD', input: addStockSchema.parse(request.input) };
    case 'ADJUST_REMOVE':
      return { operation: 'ADJUST_REMOVE', input: removeStockSchema.parse(request.input) };
    case 'ADJUST_SET':
      return { operation: 'ADJUST_SET', input: setStockSchema.parse(request.input) };
    default: {
      const unknownRequest: never = request;
      throw new Error(`Unknown adjustment: ${JSON.stringify(unknownRequest)}`);
    }
  }
}

// L5 only (the request row, L1, is already taken). Add and set may create the row; remove never does.
async function changeStockRow(
  transaction: DatabaseClient,
  key: StockKey,
  request: AdjustmentRequest,
  quantityDelta: number,
): Promise<{ before: StockLevelRow; after: StockLevelRow }> {
  if (request.operation !== 'ADJUST_REMOVE') await insertMissingStockLevels(transaction, [key]);
  const [before] = await lockStockLevels(transaction, [key]);
  if (before === undefined) {
    throw inventoryErrors.stockBelowReserved({
      onHandQuantity: 0,
      reservedQuantity: 0,
      requestedOnHandQuantity: quantityDelta,
    });
  }
  if (request.operation === 'ADJUST_SET') {
    const after = await setOnHandIfUnchanged(transaction, key, request.input);
    if (after !== null) return { before, after };
    if (before.onHandQuantity !== request.input.expectedOnHandQuantity) {
      throw inventoryErrors.staleStock({
        expectedOnHandQuantity: request.input.expectedOnHandQuantity,
        currentOnHandQuantity: before.onHandQuantity,
      });
    }
    throw inventoryErrors.stockBelowReserved({
      onHandQuantity: before.onHandQuantity,
      reservedQuantity: before.reservedQuantity,
      requestedOnHandQuantity: request.input.newOnHandQuantity,
    });
  }
  assertWithinOnHandLimit(before, quantityDelta);
  const after = await changeOnHand(transaction, key, quantityDelta);
  if (after === null) {
    throw inventoryErrors.stockBelowReserved({
      onHandQuantity: before.onHandQuantity,
      reservedQuantity: before.reservedQuantity,
      requestedOnHandQuantity: before.onHandQuantity + quantityDelta,
    });
  }
  return { before, after };
}

async function adjustStock(
  actor: StaffInventoryActor,
  idempotencyKey: string,
  submitted: AdjustmentRequest,
): Promise<StockRequestResult> {
  assertStaffPermission(actor.staff, 'inventory.write');
  const key = idempotencyKeySchema.parse(idempotencyKey);
  // A change of zero is refused here, before any transaction and before the input is validated, so it
  // keeps its documented 422 NO_STOCK_CHANGE and leaves no request row.
  const quantityDelta = adjustmentDelta(adjustmentPlan(submitted));
  const request = validatedRequest(submitted);
  const location = { variantId: request.input.variantId, warehouseId: request.input.warehouseId };
  await assertStockLocationsExist(getDatabase(), {
    warehouseId: location.warehouseId,
    variantIds: [location.variantId],
  });
  const operation: StockRequestOperation = request.operation;
  return await idempotentStockChange(
    { staff: actor.staff, idempotencyKey: key, operation, input: request.input },
    async (transaction, changeRequestId) => {
      const { before, after } = await changeStockRow(transaction, location, request, quantityDelta);
      const movements = await insertMovements(transaction, [
        {
          ...location,
          movementType: 'ADJUSTMENT',
          quantityDelta: after.onHandQuantity - before.onHandQuantity,
          onHandAfter: after.onHandQuantity,
          reservedAfter: after.reservedQuantity,
          referenceType: changeRequestReferenceType,
          referenceId: changeRequestId,
          ...actorColumns(actor),
          reason: request.input.reason,
        },
      ]);
      await recordInventoryEvents(
        transaction,
        actor,
        movements.map((movement) => ({
          action: auditActionByOperation[request.operation],
          entityType: 'inventory_movement',
          entityId: movement.id,
          before: {
            onHandQuantity: before.onHandQuantity,
            reservedQuantity: before.reservedQuantity,
          },
          after: {
            onHandQuantity: movement.onHandAfter,
            reservedQuantity: movement.reservedAfter,
            quantityDelta: movement.quantityDelta,
            movementType: movement.movementType,
            reason: movement.reason,
            variantId: movement.variantId,
            warehouseId: movement.warehouseId,
            changeRequestId,
          },
        })),
      );
      await enqueueProductsOfVariants(transaction, [location.variantId]);
      return movements;
    },
  );
}

export function addStock(
  actor: StaffInventoryActor,
  idempotencyKey: string,
  input: AddStockInput,
): Promise<StockRequestResult> {
  return adjustStock(actor, idempotencyKey, { operation: 'ADJUST_ADD', input });
}

export function removeStock(
  actor: StaffInventoryActor,
  idempotencyKey: string,
  input: RemoveStockInput,
): Promise<StockRequestResult> {
  return adjustStock(actor, idempotencyKey, { operation: 'ADJUST_REMOVE', input });
}

// The caller states the on-hand quantity it saw; if it has changed since, nothing is changed (409).
export function setStock(
  actor: StaffInventoryActor,
  idempotencyKey: string,
  input: SetStockInput,
): Promise<StockRequestResult> {
  return adjustStock(actor, idempotencyKey, { operation: 'ADJUST_SET', input });
}
