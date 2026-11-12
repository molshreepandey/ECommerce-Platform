import type { DatabaseClient } from '@/lib/db';
import { enqueueProductsOfVariants } from '@/modules/search/search-outbox.repository';

import type { InventoryActor } from './inventory-actor';
import { inventoryErrors } from './inventory.errors';
import {
  type CustomerReturnLineInput,
  customerReturnLinesSchema,
  type ShipmentStockLineInput,
  shipmentStockLinesSchema,
} from './inventory.schema';
import {
  restockableForReturnRequests,
  restockableForShipments,
  returnRequestReferenceType,
  returnStockKey,
  shipmentReferenceType,
  shipmentStockKey,
} from './inventory-movement.repository';
import { type LineStockChange, recordLineMovements } from './line-movements';
import { findReceivingWarehouses } from './return-request-reference.repository';
import { lockAndCheckShipments } from './shipment-references';
import {
  changeOnHand,
  insertMissingStockLevels,
  lockStockLevels,
  stockKey,
  type StockLevelRow,
} from './stock-level.repository';
import type { StockMovementsResult } from './stock-request-result';
import { assertWithinOnHandLimit } from './stock-rules';

// Internal (no HTTP route), under the reservation caller contract (TD-019, TD-022). Restocks put physical
// units back, so archived items and inactive warehouses are allowed; more than the source sent out is
// refused (409 RESTOCK_EXCEEDED), so a duplicate restock never adds stock twice.

interface LocatedLine {
  referenceId: string;
  limitKey: string;
  variantId: string;
  warehouseId: string;
  quantity: number;
}

type ReferenceType = typeof shipmentReferenceType | typeof returnRequestReferenceType;

function byStockRowThenReference(left: LocatedLine, right: LocatedLine): number {
  return (
    stockKey(left).localeCompare(stockKey(right)) ||
    left.referenceId.localeCompare(right.referenceId)
  );
}

function assertRestockable(
  lines: readonly LocatedLine[],
  restockable: ReadonlyMap<string, number>,
  referenceType: ReferenceType,
): void {
  for (const line of lines) {
    const restockableQuantity = restockable.get(line.limitKey) ?? 0;
    if (line.quantity > restockableQuantity) {
      throw inventoryErrors.restockExceeded({
        referenceType,
        referenceId: line.referenceId,
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        restockableQuantity,
        requestedQuantity: line.quantity,
      });
    }
  }
}

// Locks the stock rows (L5), reads the limits under those locks, checks every line (limit and the
// 1,000,000 ceiling, adding up lines that share a row) before the first change, then applies them.
async function restockLines(
  transaction: DatabaseClient,
  lines: readonly LocatedLine[],
  loadRestockable: () => Promise<ReadonlyMap<string, number>>,
  referenceType: ReferenceType,
): Promise<LineStockChange[]> {
  const levels = new Map<string, StockLevelRow>(
    (await lockStockLevels(transaction, lines)).map((level) => [stockKey(level), level]),
  );
  assertRestockable(lines, await loadRestockable(), referenceType);
  const projected = new Map(levels);
  for (const line of lines) {
    const level = projected.get(stockKey(line));
    if (level === undefined) {
      throw inventoryErrors.restockExceeded({
        referenceType,
        referenceId: line.referenceId,
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        restockableQuantity: 0,
        requestedQuantity: line.quantity,
      });
    }
    assertWithinOnHandLimit(level, line.quantity);
    projected.set(stockKey(line), {
      ...level,
      onHandQuantity: level.onHandQuantity + line.quantity,
    });
  }

  const changes: LineStockChange[] = [];
  for (const line of lines) {
    const key = stockKey(line);
    const before = levels.get(key);
    const after = await changeOnHand(transaction, line, line.quantity);
    if (before === undefined || after === null) {
      throw new Error('A checked stock row could not be restocked');
    }
    levels.set(key, after);
    changes.push({ referenceId: line.referenceId, quantityDelta: line.quantity, before, after });
  }
  return changes;
}

// A shipment returned to origin (RTO received, D36): back to the shipment's own warehouse, up to what it
// dispatched and has not yet restocked. Locks L0b shipments, then L5.
export async function restockReturnedShipment(
  transaction: DatabaseClient,
  actor: InventoryActor,
  lines: readonly ShipmentStockLineInput[],
): Promise<StockMovementsResult> {
  const parsed = shipmentStockLinesSchema.parse(lines);
  await lockAndCheckShipments(transaction, parsed);
  const located = parsed
    .map((line) => ({ ...line, referenceId: line.shipmentId, limitKey: shipmentStockKey(line) }))
    .sort(byStockRowThenReference);
  const changes = await restockLines(
    transaction,
    located,
    () => restockableForShipments(transaction, parsed),
    shipmentReferenceType,
  );
  const movements = await recordLineMovements(transaction, actor, 'RTO_RESTOCK', changes);
  await enqueueProductsOfVariants(transaction, [...new Set(located.map((line) => line.variantId))]);
  return { movements };
}

// A customer return received at its receiving warehouse (D43, Wave 12): up to what the return request
// lists for the variant minus what was already restocked for it. No lock above L5: the caller holds the
// return request (TD-022, L60).
export async function restockCustomerReturn(
  transaction: DatabaseClient,
  actor: InventoryActor,
  lines: readonly CustomerReturnLineInput[],
): Promise<StockMovementsResult> {
  const parsed = customerReturnLinesSchema.parse(lines);
  const receivingWarehouses = await findReceivingWarehouses(transaction, [
    ...new Set(parsed.map(({ returnRequestId }) => returnRequestId)),
  ]);
  const located = parsed
    .map((line) => {
      const warehouseId = receivingWarehouses.get(line.returnRequestId);
      if (warehouseId === undefined || warehouseId === null) {
        throw inventoryErrors.restockReferenceInvalid({
          returnRequestId: line.returnRequestId,
          reason: warehouseId === null ? 'NO_RECEIVING_WAREHOUSE' : 'RETURN_REQUEST_NOT_FOUND',
        });
      }
      return {
        referenceId: line.returnRequestId,
        limitKey: returnStockKey(line),
        variantId: line.variantId,
        warehouseId,
        quantity: line.quantity,
      };
    })
    .sort(byStockRowThenReference);
  // Refused before a missing stock row is created, so a variant the return does not list (or one that
  // does not exist) is a 409, never a foreign-key error. Checked again under the row locks below.
  assertRestockable(
    located,
    await restockableForReturnRequests(transaction, parsed),
    returnRequestReferenceType,
  );
  await insertMissingStockLevels(transaction, located);
  const changes = await restockLines(
    transaction,
    located,
    () => restockableForReturnRequests(transaction, parsed),
    returnRequestReferenceType,
  );
  const movements = await recordLineMovements(transaction, actor, 'RETURN_RESTOCK', changes);
  await enqueueProductsOfVariants(transaction, [...new Set(located.map((line) => line.variantId))]);
  return { movements };
}
