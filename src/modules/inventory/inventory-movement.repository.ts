import { z } from 'zod';

import type { ActorType, InventoryMovementType } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import type { DatabaseClient } from '@/lib/db';

export const changeRequestReferenceType = 'inventory_change_request';
export const shipmentReferenceType = 'shipment';
export const returnRequestReferenceType = 'return_request';

export interface NewMovement {
  variantId: string;
  warehouseId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
}

export interface MovementRow extends NewMovement {
  id: string;
  createdAt: Date;
}

const movementSelect = {
  id: true,
  variantId: true,
  warehouseId: true,
  movementType: true,
  quantityDelta: true,
  onHandAfter: true,
  reservedAfter: true,
  referenceType: true,
  referenceId: true,
  actorType: true,
  actorId: true,
  reason: true,
  createdAt: true,
} as const;

// Inserts happen after every lock level (L6). Rows come back in (variant, warehouse) order.
export async function insertMovements(
  transaction: DatabaseClient,
  movements: readonly NewMovement[],
): Promise<MovementRow[]> {
  if (movements.length === 0) return [];
  // Columns are copied one by one: an object with extra properties still satisfies NewMovement.
  const rows = await transaction.inventoryMovement.createManyAndReturn({
    data: movements.map((movement) => ({
      variantId: movement.variantId,
      warehouseId: movement.warehouseId,
      movementType: movement.movementType,
      quantityDelta: movement.quantityDelta,
      onHandAfter: movement.onHandAfter,
      reservedAfter: movement.reservedAfter,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      actorType: movement.actorType,
      actorId: movement.actorId,
      reason: movement.reason,
    })),
    select: movementSelect,
  });
  return rows.sort(
    (left, right) =>
      left.variantId.localeCompare(right.variantId) ||
      left.warehouseId.localeCompare(right.warehouseId) ||
      left.id.localeCompare(right.id),
  );
}

export interface ShipmentStockKey {
  shipmentId: string;
  variantId: string;
  warehouseId: string;
}

// Lower-case, so it matches the ids PostgreSQL returns as text.
export function shipmentStockKey(key: ShipmentStockKey): string {
  return `${key.shipmentId}/${key.variantId}/${key.warehouseId}`.toLowerCase();
}

export interface ReturnStockKey {
  returnRequestId: string;
  variantId: string;
}

export function returnStockKey(key: ReturnStockKey): string {
  return `${key.returnRequestId}/${key.variantId}`.toLowerCase();
}

const keyedQuantityRowsSchema = z.array(z.object({ key: z.string(), quantity: z.number() }));

function keyedQuantities(rows: unknown): Map<string, number> {
  return new Map(keyedQuantityRowsSchema.parse(rows).map(({ key, quantity }) => [key, quantity]));
}

// One statement for every key: the sum of the given movement types' deltas per exact shipment, variant
// and warehouse (0 when there is none). Call it with the stock rows already locked.
async function sumShipmentMovements(
  transaction: DatabaseClient,
  keys: readonly ShipmentStockKey[],
  movementTypes: readonly InventoryMovementType[],
): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  return keyedQuantities(
    await transaction.$queryRaw`
      SELECT key.shipment_id::text || '/' || key.variant_id::text || '/' || key.warehouse_id::text AS key,
             coalesce(sum(movement.quantity_delta), 0)::int AS quantity
      FROM unnest(${keys.map(({ shipmentId }) => shipmentId)}::uuid[],
                  ${keys.map(({ variantId }) => variantId)}::uuid[],
                  ${keys.map(({ warehouseId }) => warehouseId)}::uuid[])
           AS key(shipment_id, variant_id, warehouse_id)
      LEFT JOIN inventory_movements AS movement
        ON movement.reference_type = ${shipmentReferenceType}
       AND movement.reference_id = key.shipment_id
       AND movement.variant_id = key.variant_id AND movement.warehouse_id = key.warehouse_id
       AND movement.movement_type::text = ANY(${[...movementTypes]}::text[])
      GROUP BY key.shipment_id, key.variant_id, key.warehouse_id`,
  );
}

// What is still reserved for each exact shipment, variant and warehouse: reservations add, releases and
// dispatches subtract. Keyed by shipmentStockKey().
export function remainingReservedForShipments(
  transaction: DatabaseClient,
  keys: readonly ShipmentStockKey[],
): Promise<Map<string, number>> {
  return sumShipmentMovements(transaction, keys, ['RESERVE', 'RELEASE', 'DISPATCH']);
}

// What a shipment returned to origin may still put back: units dispatched minus units already restocked,
// per exact shipment, variant and warehouse. Keyed by shipmentStockKey().
export async function restockableForShipments(
  transaction: DatabaseClient,
  keys: readonly ShipmentStockKey[],
): Promise<Map<string, number>> {
  const sums = await sumShipmentMovements(transaction, keys, ['DISPATCH', 'RTO_RESTOCK']);
  return new Map([...sums].map(([key, sum]) => [key, 0 - sum]));
}

// What a customer return may still put back per variant: the quantity its items list minus what was
// already restocked for it, in any warehouse. Keyed by returnStockKey().
export async function restockableForReturnRequests(
  transaction: DatabaseClient,
  keys: readonly ReturnStockKey[],
): Promise<Map<string, number>> {
  if (keys.length === 0) return new Map();
  return keyedQuantities(
    await transaction.$queryRaw`
      SELECT key.return_request_id::text || '/' || key.variant_id::text AS key,
             ((SELECT coalesce(sum(item.quantity), 0)
               FROM return_request_items AS item
               JOIN order_items AS ordered ON ordered.id = item.order_item_id
               WHERE item.return_request_id = key.return_request_id
                 AND ordered.variant_id = key.variant_id)
            - (SELECT coalesce(sum(movement.quantity_delta), 0)
               FROM inventory_movements AS movement
               WHERE movement.reference_type = ${returnRequestReferenceType}
                 AND movement.reference_id = key.return_request_id
                 AND movement.variant_id = key.variant_id
                 AND movement.movement_type = 'RETURN_RESTOCK'))::int AS quantity
      FROM unnest(${keys.map(({ returnRequestId }) => returnRequestId)}::uuid[],
                  ${keys.map(({ variantId }) => variantId)}::uuid[]) AS key(return_request_id, variant_id)`,
  );
}

// The movements one staff stock request wrote, for an exact replay of its original result.
export function movementsForChangeRequest(
  database: DatabaseClient,
  changeRequestId: string,
): Promise<MovementRow[]> {
  return database.inventoryMovement.findMany({
    where: { referenceType: changeRequestReferenceType, referenceId: changeRequestId },
    select: movementSelect,
    orderBy: [{ variantId: 'asc' }, { warehouseId: 'asc' }, { id: 'asc' }],
  });
}

export interface MovementFilters {
  warehouseId?: string | undefined;
  variantId?: string | undefined;
  movementType?: InventoryMovementType | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}

const movementPageRowsSchema = z.array(
  z.object({
    id: z.string(),
    variant_id: z.string(),
    warehouse_id: z.string(),
    movement_type: z.enum([
      'RESERVE',
      'RELEASE',
      'DISPATCH',
      'RETURN_RESTOCK',
      'RTO_RESTOCK',
      'ADJUSTMENT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'RECEIPT',
    ]),
    quantity_delta: z.number(),
    on_hand_after: z.number(),
    reserved_after: z.number(),
    reference_type: z.string().nullable(),
    reference_id: z.string().nullable(),
    actor_type: z.enum(['CUSTOMER', 'STAFF', 'COURIER', 'SYSTEM']),
    actor_id: z.string().nullable(),
    reason: z.string().nullable(),
    created_at: z.date(),
  }),
);

// Newest first. The cursor is a movement id; its exact (created_at, id) is looked up in SQL, so the
// microsecond timestamp never passes through JavaScript (which keeps only milliseconds).
export async function listMovementPage(
  database: DatabaseClient,
  input: { filters: MovementFilters; cursor: string | undefined; limit: number },
): Promise<{ movements: MovementRow[]; nextCursor: string | null }> {
  const { filters } = input;
  const conditions = [
    filters.warehouseId === undefined
      ? null
      : Prisma.sql`warehouse_id = ${filters.warehouseId}::uuid`,
    filters.variantId === undefined ? null : Prisma.sql`variant_id = ${filters.variantId}::uuid`,
    filters.movementType === undefined
      ? null
      : Prisma.sql`movement_type = ${filters.movementType}::"InventoryMovementType"`,
    filters.createdFrom === undefined ? null : Prisma.sql`created_at >= ${filters.createdFrom}`,
    filters.createdTo === undefined ? null : Prisma.sql`created_at < ${filters.createdTo}`,
    input.cursor === undefined
      ? null
      : Prisma.sql`(created_at, id) < (SELECT created_at, id FROM inventory_movements WHERE id = ${input.cursor}::uuid)`,
  ].filter((condition) => condition !== null);
  const where =
    conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  const rows = movementPageRowsSchema.parse(
    await database.$queryRaw`
      SELECT id::text AS id, variant_id::text AS variant_id, warehouse_id::text AS warehouse_id,
             movement_type::text AS movement_type, quantity_delta, on_hand_after, reserved_after,
             reference_type, reference_id::text AS reference_id, actor_type::text AS actor_type,
             actor_id::text AS actor_id, reason, created_at
      FROM inventory_movements ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ${input.limit + 1}`,
  );
  const page = rows.slice(0, input.limit).map((row) => ({
    id: row.id,
    variantId: row.variant_id,
    warehouseId: row.warehouse_id,
    movementType: row.movement_type,
    quantityDelta: row.quantity_delta,
    onHandAfter: row.on_hand_after,
    reservedAfter: row.reserved_after,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    reason: row.reason,
    createdAt: row.created_at,
  }));
  return {
    movements: page,
    nextCursor: rows.length > input.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
