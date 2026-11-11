import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';

import { enterLockLevel } from './lock-order';

export const warehouseSelect = {
  id: true,
  code: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  pincode: true,
  contactName: true,
  contactPhone: true,
  priority: true,
  isActive: true,
} as const;

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  contactName: string;
  contactPhone: string;
  priority: number;
  isActive: boolean;
}

export type WarehouseFields = Omit<WarehouseRow, 'id' | 'code' | 'isActive'>;

export function listWarehouseRows(database: DatabaseClient): Promise<WarehouseRow[]> {
  return database.warehouse.findMany({
    select: warehouseSelect,
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });
}

export function findWarehouse(
  database: DatabaseClient,
  warehouseId: string,
): Promise<WarehouseRow | null> {
  return database.warehouse.findUnique({ where: { id: warehouseId }, select: warehouseSelect });
}

export function insertWarehouse(
  database: DatabaseClient,
  data: WarehouseFields & { code: string },
): Promise<WarehouseRow> {
  return database.warehouse.create({ data, select: warehouseSelect });
}

// Writes only the given fields: two people editing different fields at once both keep their change.
export function updateWarehouseRow(
  database: DatabaseClient,
  warehouseId: string,
  data: Partial<WarehouseFields & { isActive: boolean }>,
): Promise<WarehouseRow> {
  return database.warehouse.update({
    where: { id: warehouseId },
    data,
    select: warehouseSelect,
  });
}

const warehouseIdRowsSchema = z.array(z.object({ id: z.string() }));

// L4, for an edit or a status change. FOR NO KEY UPDATE (not FOR UPDATE) so it never conflicts with the
// key-share locks that inserting stock rows and movements take on their warehouse.
export async function lockWarehouseForWrite(
  transaction: DatabaseClient,
  warehouseId: string,
): Promise<WarehouseRow | null> {
  const [id] = enterLockLevel(transaction, 'WAREHOUSES', [warehouseId]);
  if (id === undefined) return null;
  const locked = warehouseIdRowsSchema.parse(
    await transaction.$queryRaw`SELECT id::text AS id FROM warehouses WHERE id = ${id}::uuid FOR NO KEY UPDATE`,
  );
  return locked.length === 0 ? null : findWarehouse(transaction, id);
}

const sharedWarehouseRowsSchema = z.array(z.object({ id: z.string(), is_active: z.boolean() }));
export interface SharedWarehouse {
  id: string;
  isActive: boolean;
}

// L4, for a reservation: the warehouse cannot be deactivated (or edited) until the transaction ends.
export async function lockWarehousesForShare(
  transaction: DatabaseClient,
  warehouseIds: readonly string[],
): Promise<SharedWarehouse[]> {
  const ids = enterLockLevel(transaction, 'WAREHOUSES', warehouseIds);
  if (ids.length === 0) return [];
  const rows = sharedWarehouseRowsSchema.parse(
    await transaction.$queryRaw`
      SELECT id::text AS id, is_active FROM warehouses WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`,
  );
  return rows.map((row) => ({ id: row.id, isActive: row.is_active }));
}

const reservedRowsSchema = z.tuple([z.object({ reserved: z.number() })]);

// Unlocked read for the status-change audit row: deactivation never changes these units.
export async function reservedUnitsInWarehouse(
  database: DatabaseClient,
  warehouseId: string,
): Promise<number> {
  const [row] = reservedRowsSchema.parse(
    await database.$queryRaw`
      SELECT coalesce(sum(reserved_quantity), 0)::int AS reserved
      FROM inventory_levels WHERE warehouse_id = ${warehouseId}::uuid`,
  );
  return row.reserved;
}
