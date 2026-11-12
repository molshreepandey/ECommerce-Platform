import type { DatabaseClient } from '@/lib/db';

import type { InventoryActor } from './inventory-actor';
import { inventoryErrors } from './inventory.errors';
import {
  type ShipmentStockLine,
  type ShipmentStockLineInput,
  shipmentStockLinesSchema,
} from './inventory.schema';
import { remainingReservedForShipments, shipmentStockKey } from './inventory-movement.repository';
import { type LineStockChange, recordLineMovements } from './line-movements';
import { lockAndCheckShipments } from './shipment-references';
import { dispatchQuantity, lockStockLevels, stockKey } from './stock-level.repository';
import type { StockMovementsResult } from './stock-request-result';

// Internal (no HTTP route), under the reservation caller contract (TD-019, TD-022). Locks L0b shipments,
// then L5 stock rows; checks every line before changing any; works for archived items and inactive
// warehouses, because the units are already reserved and must be able to leave.
export async function dispatchReservedStock(
  transaction: DatabaseClient,
  actor: InventoryActor,
  lines: readonly ShipmentStockLineInput[],
): Promise<StockMovementsResult> {
  const parsed = [...shipmentStockLinesSchema.parse(lines)].sort(
    (left, right) =>
      stockKey(left).localeCompare(stockKey(right)) ||
      left.shipmentId.localeCompare(right.shipmentId),
  );
  await lockAndCheckShipments(transaction, parsed);
  const levels = new Map(
    (await lockStockLevels(transaction, parsed)).map((level) => [stockKey(level), level]),
  );
  const remaining = await remainingReservedForShipments(transaction, parsed);
  const exceeded = (line: ShipmentStockLine) =>
    inventoryErrors.reservationExceeded({
      shipmentId: line.shipmentId,
      variantId: line.variantId,
      warehouseId: line.warehouseId,
      remainingReservedQuantity: remaining.get(shipmentStockKey(line)) ?? 0,
      requestedQuantity: line.quantity,
    });
  const refused = parsed.find(
    (line) =>
      !levels.has(stockKey(line)) || line.quantity > (remaining.get(shipmentStockKey(line)) ?? 0),
  );
  if (refused !== undefined) throw exceeded(refused);

  const changes: LineStockChange[] = [];
  for (const line of parsed) {
    const key = stockKey(line);
    const before = levels.get(key);
    const after = await dispatchQuantity(transaction, line, line.quantity);
    if (before === undefined || after === null) throw exceeded(line);
    levels.set(key, after);
    changes.push({ referenceId: line.shipmentId, quantityDelta: -line.quantity, before, after });
  }
  const movements = await recordLineMovements(transaction, actor, 'DISPATCH', changes);
  // Available stock is unchanged (on hand and reserved fall together), so search needs no update.
  return { movements };
}
