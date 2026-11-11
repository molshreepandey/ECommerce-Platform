import { z } from 'zod';

import type { ActorType, InventoryMovementType } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import type { DatabaseClient } from '@/lib/db';

export const changeRequestReferenceType = 'inventory_change_request';
export const shipmentReferenceType = 'shipment';

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

const remainingRowsSchema = z.tuple([z.object({ remaining: z.number() })]);

// What is still reserved for one exact shipment, variant and warehouse: reservations add, releases and
// dispatches subtract. Call it with the stock row already locked, so no other change can interleave.
export async function remainingReservedForShipment(
  transaction: DatabaseClient,
  key: { shipmentId: string; variantId: string; warehouseId: string },
): Promise<number> {
  const [row] = remainingRowsSchema.parse(
    await transaction.$queryRaw`
      SELECT coalesce(sum(quantity_delta), 0)::int AS remaining
      FROM inventory_movements
      WHERE reference_type = ${shipmentReferenceType} AND reference_id = ${key.shipmentId}::uuid
        AND variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid
        AND movement_type IN ('RESERVE', 'RELEASE', 'DISPATCH')`,
  );
  return row.remaining;
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
