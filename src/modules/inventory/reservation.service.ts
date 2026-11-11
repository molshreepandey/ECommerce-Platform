import type { DatabaseClient } from '@/lib/db';
import { enqueueProductsOfVariants } from '@/modules/search/search-outbox.repository';

import { actorColumns, type InventoryActor } from './inventory-actor';
import { recordInventoryEvents } from './inventory-audit';
import { inventoryErrors } from './inventory.errors';
import {
  reservationChangesSchema,
  type ReservationChangesInput,
  type ReservationLine,
} from './inventory.schema';
import {
  lockProductsForShare,
  lockShipments,
  lockVariantsForShare,
  productIdsOfVariants,
} from './inventory-locks';
import {
  insertMovements,
  type NewMovement,
  remainingReservedForShipment,
  shipmentReferenceType,
} from './inventory-movement.repository';
import {
  lockStockLevels,
  releaseQuantity,
  reserveQuantity,
  stockKey,
  type StockLevelRow,
} from './stock-level.repository';
import { movementResults, type MovementResult } from './stock-request-result';
import { isReservable } from './stock-rules';
import { lockWarehousesForShare } from './warehouse.repository';

// Internal only (no HTTP route): checkout (Wave 8) and order/shipment code (Wave 9) call these inside
// their own transaction, so a failure here rolls back the caller's whole transaction.
//
// Caller contract (TD-019):
// - The caller may already hold order (L0a) and shipment (L0b) locks; it must hold no other inventory
//   lock (L1–L5) when it calls, and must take no new L0–L5 lock afterwards.
// - The shipment rows must already exist (checkout inserts the order and its shipments first).
// - Anything that both releases and reserves (re-allocation) uses one applyReservationChanges call.
// - These functions check no staff permission: the caller authorises the order or shipment action.
//
// Lock sequence (each level sorted, never back up the hierarchy):
//   L0b every referenced shipment FOR NO KEY UPDATE, taken here even if the caller holds it already
//   L2  products of the reserve lines FOR SHARE
//   L3  variants of the reserve lines FOR SHARE
//   L4  warehouses of the reserve lines FOR SHARE
//   L5  every stock row of every line FOR UPDATE
//   then RESERVE / RELEASE movements, one audit row each, and search updates.

export interface ReservationResult {
  movements: MovementResult[];
}

interface NormalisedLine {
  kind: 'RESERVE' | 'RELEASE';
  shipmentId: string;
  variantId: string;
  warehouseId: string;
  quantity: number;
}

function normalise(kind: NormalisedLine['kind'], line: ReservationLine): NormalisedLine {
  return {
    kind,
    shipmentId: line.shipmentId.toLowerCase(),
    variantId: line.variantId.toLowerCase(),
    warehouseId: line.warehouseId.toLowerCase(),
    quantity: line.quantity,
  };
}

async function checkShipmentReferences(
  transaction: DatabaseClient,
  lines: readonly NormalisedLine[],
): Promise<void> {
  const shipments = new Map(
    (
      await lockShipments(
        transaction,
        lines.map(({ shipmentId }) => shipmentId),
      )
    ).map((shipment) => [shipment.id, shipment]),
  );
  for (const line of lines) {
    const shipment = shipments.get(line.shipmentId);
    if (shipment === undefined) {
      throw inventoryErrors.reservationReferenceInvalid({
        shipmentId: line.shipmentId,
        reason: 'SHIPMENT_NOT_FOUND',
      });
    }
    if (shipment.warehouseId !== line.warehouseId) {
      throw inventoryErrors.reservationReferenceInvalid({
        shipmentId: line.shipmentId,
        reason: 'OTHER_WAREHOUSE',
      });
    }
  }
}

// L2, L3 and L4 for the reserve lines only: a release is allowed whatever the product, variant or
// warehouse status, so stock can always be freed.
async function checkReservable(
  transaction: DatabaseClient,
  reserveLines: readonly NormalisedLine[],
): Promise<void> {
  if (reserveLines.length === 0) return;
  const variantIds = [...new Set(reserveLines.map(({ variantId }) => variantId))];
  const productIdByVariant = await productIdsOfVariants(transaction, variantIds);
  if (variantIds.some((variantId) => !productIdByVariant.has(variantId))) {
    throw inventoryErrors.variantNotFound();
  }
  const products = new Map(
    (await lockProductsForShare(transaction, [...productIdByVariant.values()])).map((product) => [
      product.id,
      product,
    ]),
  );
  const variants = await lockVariantsForShare(transaction, variantIds);
  const warehouses = await lockWarehousesForShare(
    transaction,
    reserveLines.map(({ warehouseId }) => warehouseId),
  );
  for (const variant of variants) {
    const product = products.get(variant.productId);
    if (
      product === undefined ||
      !isReservable({ productStatus: product.status, variantStatus: variant.status })
    ) {
      throw inventoryErrors.variantNotReservable({
        variantId: variant.id,
        productStatus: product?.status ?? 'MISSING',
        variantStatus: variant.status,
      });
    }
  }
  const inactive = warehouses.find(({ isActive }) => !isActive);
  if (inactive !== undefined) throw inventoryErrors.warehouseInactive({ warehouseId: inactive.id });
}

// What each release line may still free, read with every stock row locked, before anything changes.
async function remainingByReleaseLine(
  transaction: DatabaseClient,
  releaseLines: readonly NormalisedLine[],
): Promise<Map<NormalisedLine, number>> {
  const remaining = new Map<NormalisedLine, number>();
  for (const line of releaseLines) {
    remaining.set(line, await remainingReservedForShipment(transaction, line));
  }
  return remaining;
}

// Order in which lines are applied (the lock helpers sort their own keys, so this never changes the
// lock order). On one stock row every RELEASE runs before any RESERVE, whatever the shipment IDs, so a
// re-allocation can reserve the units it frees; within each kind, lines are sorted by shipment.
const kindRank: Record<NormalisedLine['kind'], number> = { RELEASE: 0, RESERVE: 1 };

function lineOrder(left: NormalisedLine, right: NormalisedLine): number {
  return (
    stockKey(left).localeCompare(stockKey(right)) ||
    kindRank[left.kind] - kindRank[right.kind] ||
    left.shipmentId.localeCompare(right.shipmentId)
  );
}

export async function applyReservationChanges(
  transaction: DatabaseClient,
  actor: InventoryActor,
  changes: ReservationChangesInput,
): Promise<ReservationResult> {
  const parsed = reservationChangesSchema.parse(changes);
  const lines = [
    ...parsed.reserve.map((line) => normalise('RESERVE', line)),
    ...parsed.release.map((line) => normalise('RELEASE', line)),
  ].sort(lineOrder);
  const reserveLines = lines.filter(({ kind }) => kind === 'RESERVE');
  const releaseLines = lines.filter(({ kind }) => kind === 'RELEASE');

  await checkShipmentReferences(transaction, lines);
  await checkReservable(transaction, reserveLines);
  const levels = new Map<string, StockLevelRow>(
    (await lockStockLevels(transaction, lines)).map((level) => [stockKey(level), level]),
  );
  const remaining = await remainingByReleaseLine(transaction, releaseLines);

  const movements: NewMovement[] = [];
  const audits: { line: NormalisedLine; before: StockLevelRow; after: StockLevelRow }[] = [];
  for (const line of lines) {
    const key = stockKey(line);
    const before = levels.get(key);
    const after = await applyLine(transaction, line, before, remaining.get(line));
    if (before === undefined) throw new Error('A changed stock row was not locked');
    levels.set(key, after);
    audits.push({ line, before, after });
    movements.push({
      variantId: line.variantId,
      warehouseId: line.warehouseId,
      movementType: line.kind,
      quantityDelta: line.kind === 'RESERVE' ? line.quantity : -line.quantity,
      onHandAfter: after.onHandQuantity,
      reservedAfter: after.reservedQuantity,
      referenceType: shipmentReferenceType,
      referenceId: line.shipmentId,
      ...actorColumns(actor),
      reason: null,
    });
  }

  const recorded = await insertMovements(transaction, movements);
  // Each (kind, shipment, variant, warehouse) appears once (the schema refuses repeats), so every audit
  // row finds its own movement; a miss is a programming error, never an audit row without an entity.
  const movementIdByLine = new Map(
    recorded.map((movement) => [
      `${movement.movementType}/${movement.referenceId ?? ''}/${stockKey(movement)}`,
      movement.id,
    ]),
  );
  const movementIdFor = (line: NormalisedLine): string => {
    const movementId = movementIdByLine.get(`${line.kind}/${line.shipmentId}/${stockKey(line)}`);
    if (movementId === undefined) throw new Error('A reservation line has no recorded movement');
    return movementId;
  };
  await recordInventoryEvents(
    transaction,
    actor,
    audits.map(({ line, before, after }) => ({
      action:
        line.kind === 'RESERVE' ? 'inventory.stock_reserved' : 'inventory.reservation_released',
      entityType: 'inventory_movement',
      entityId: movementIdFor(line),
      before: { onHandQuantity: before.onHandQuantity, reservedQuantity: before.reservedQuantity },
      after: {
        onHandQuantity: after.onHandQuantity,
        reservedQuantity: after.reservedQuantity,
        quantityDelta: line.kind === 'RESERVE' ? line.quantity : -line.quantity,
        movementType: line.kind,
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        shipmentId: line.shipmentId,
      },
    })),
  );
  await enqueueProductsOfVariants(transaction, [
    ...new Set(lines.map(({ variantId }) => variantId)),
  ]);
  return { movements: movementResults(recorded) };
}

// One guarded update per line on its already-locked stock row.
async function applyLine(
  transaction: DatabaseClient,
  line: NormalisedLine,
  current: StockLevelRow | undefined,
  remainingReserved: number | undefined,
): Promise<StockLevelRow> {
  if (line.kind === 'RESERVE') {
    const reserved =
      current === undefined ? null : await reserveQuantity(transaction, line, line.quantity);
    if (reserved === null) {
      throw inventoryErrors.outOfStock({
        variantId: line.variantId,
        warehouseId: line.warehouseId,
        availableQuantity: current?.availableQuantity ?? 0,
        requestedQuantity: line.quantity,
      });
    }
    return reserved;
  }
  const stillReserved = remainingReserved ?? 0;
  const exceeded = inventoryErrors.reservationExceeded({
    shipmentId: line.shipmentId,
    variantId: line.variantId,
    warehouseId: line.warehouseId,
    remainingReservedQuantity: stillReserved,
    requestedQuantity: line.quantity,
  });
  if (current === undefined || line.quantity > stillReserved) throw exceeded;
  const released = await releaseQuantity(transaction, line, line.quantity);
  if (released === null) throw exceeded;
  return released;
}

export function reserveStock(
  transaction: DatabaseClient,
  actor: InventoryActor,
  lines: readonly ReservationLine[],
): Promise<ReservationResult> {
  return applyReservationChanges(transaction, actor, { reserve: [...lines], release: [] });
}

export function releaseReservation(
  transaction: DatabaseClient,
  actor: InventoryActor,
  lines: readonly ReservationLine[],
): Promise<ReservationResult> {
  return applyReservationChanges(transaction, actor, { reserve: [], release: [...lines] });
}
