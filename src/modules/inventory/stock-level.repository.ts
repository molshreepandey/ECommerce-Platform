import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';

import { assertLocked, enterLockLevel } from './lock-order';

export interface StockKey {
  variantId: string;
  warehouseId: string;
}

export interface StockLevelRow extends StockKey {
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
}

// Lower-case UUIDs have a fixed length, so this string sorts exactly like (variant_id, warehouse_id).
export function stockKey(key: StockKey): string {
  return `${key.variantId}/${key.warehouseId}`.toLowerCase();
}

function splitStockKeys(keys: readonly string[]): { variantIds: string[]; warehouseIds: string[] } {
  const pairs = keys.map((key) => key.split('/'));
  return {
    variantIds: pairs.map(([variantId]) => variantId ?? ''),
    warehouseIds: pairs.map(([, warehouseId]) => warehouseId ?? ''),
  };
}

const stockLevelRowsSchema = z.array(
  z.object({
    variant_id: z.string(),
    warehouse_id: z.string(),
    on_hand_quantity: z.number(),
    reserved_quantity: z.number(),
    available_quantity: z.number(),
    low_stock_threshold: z.number(),
  }),
);

function toStockLevel(row: z.infer<typeof stockLevelRowsSchema>[number]): StockLevelRow {
  return {
    variantId: row.variant_id,
    warehouseId: row.warehouse_id,
    onHandQuantity: row.on_hand_quantity,
    reservedQuantity: row.reserved_quantity,
    availableQuantity: row.available_quantity,
    lowStockThreshold: row.low_stock_threshold,
  };
}

function parseStockLevels(rows: unknown): StockLevelRow[] {
  return stockLevelRowsSchema.parse(rows).map(toStockLevel);
}

function parseOptionalStockLevel(rows: unknown): StockLevelRow | null {
  const [row] = z.array(stockLevelRowsSchema.element).max(1).parse(rows);
  return row === undefined ? null : toStockLevel(row);
}

// L5. Creates the missing rows (0 on hand, 0 reserved) in key order; existing rows are left untouched.
export async function insertMissingStockLevels(
  transaction: DatabaseClient,
  keys: readonly StockKey[],
): Promise<void> {
  const sortedKeys = enterLockLevel(transaction, 'STOCK_LEVELS', keys.map(stockKey));
  if (sortedKeys.length === 0) return;
  const { variantIds, warehouseIds } = splitStockKeys(sortedKeys);
  await transaction.$executeRaw`
    INSERT INTO inventory_levels (variant_id, warehouse_id)
    SELECT key.variant_id, key.warehouse_id
    FROM unnest(${variantIds}::uuid[], ${warehouseIds}::uuid[]) AS key(variant_id, warehouse_id)
    ORDER BY key.variant_id, key.warehouse_id
    ON CONFLICT (variant_id, warehouse_id) DO NOTHING`;
}

// L5. Locks the existing rows in (variant_id, warehouse_id) order; missing rows are simply absent.
export async function lockStockLevels(
  transaction: DatabaseClient,
  keys: readonly StockKey[],
): Promise<StockLevelRow[]> {
  const sortedKeys = enterLockLevel(transaction, 'STOCK_LEVELS', keys.map(stockKey));
  if (sortedKeys.length === 0) return [];
  const { variantIds, warehouseIds } = splitStockKeys(sortedKeys);
  return parseStockLevels(
    await transaction.$queryRaw`
      SELECT level.variant_id::text AS variant_id, level.warehouse_id::text AS warehouse_id,
             level.on_hand_quantity, level.reserved_quantity, level.available_quantity,
             level.low_stock_threshold
      FROM inventory_levels AS level
      JOIN unnest(${variantIds}::uuid[], ${warehouseIds}::uuid[]) AS key(variant_id, warehouse_id)
        ON key.variant_id = level.variant_id AND key.warehouse_id = level.warehouse_id
      ORDER BY level.variant_id, level.warehouse_id
      FOR UPDATE OF level`,
  );
}

// Unlocked read (error details, queries).
export async function findStockLevels(
  database: DatabaseClient,
  keys: readonly StockKey[],
): Promise<StockLevelRow[]> {
  if (keys.length === 0) return [];
  const { variantIds, warehouseIds } = splitStockKeys(keys.map(stockKey));
  return parseStockLevels(
    await database.$queryRaw`
      SELECT level.variant_id::text AS variant_id, level.warehouse_id::text AS warehouse_id,
             level.on_hand_quantity, level.reserved_quantity, level.available_quantity,
             level.low_stock_threshold
      FROM inventory_levels AS level
      JOIN unnest(${variantIds}::uuid[], ${warehouseIds}::uuid[]) AS key(variant_id, warehouse_id)
        ON key.variant_id = level.variant_id AND key.warehouse_id = level.warehouse_id
      ORDER BY level.variant_id, level.warehouse_id`,
  );
}

// The guarded updates below change nothing and return null when their guard does not hold; the CHECK
// (0 <= reserved <= on hand) is the last line of defence behind each guard.

export async function changeOnHand(
  transaction: DatabaseClient,
  key: StockKey,
  quantityDelta: number,
): Promise<StockLevelRow | null> {
  assertLocked(transaction, 'STOCK_LEVELS', stockKey(key));
  return parseOptionalStockLevel(
    await transaction.$queryRaw`
      UPDATE inventory_levels SET on_hand_quantity = on_hand_quantity + ${quantityDelta}::int,
                                  updated_at = now()
      WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid
        AND on_hand_quantity + ${quantityDelta}::int >= reserved_quantity
      RETURNING variant_id::text AS variant_id, warehouse_id::text AS warehouse_id, on_hand_quantity,
                reserved_quantity, available_quantity, low_stock_threshold`,
  );
}

export async function setOnHandIfUnchanged(
  transaction: DatabaseClient,
  key: StockKey,
  input: { expectedOnHandQuantity: number; newOnHandQuantity: number },
): Promise<StockLevelRow | null> {
  assertLocked(transaction, 'STOCK_LEVELS', stockKey(key));
  return parseOptionalStockLevel(
    await transaction.$queryRaw`
      UPDATE inventory_levels SET on_hand_quantity = ${input.newOnHandQuantity}::int, updated_at = now()
      WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid
        AND on_hand_quantity = ${input.expectedOnHandQuantity}::int
        AND ${input.newOnHandQuantity}::int >= reserved_quantity
      RETURNING variant_id::text AS variant_id, warehouse_id::text AS warehouse_id, on_hand_quantity,
                reserved_quantity, available_quantity, low_stock_threshold`,
  );
}

export async function reserveQuantity(
  transaction: DatabaseClient,
  key: StockKey,
  quantity: number,
): Promise<StockLevelRow | null> {
  assertLocked(transaction, 'STOCK_LEVELS', stockKey(key));
  return parseOptionalStockLevel(
    await transaction.$queryRaw`
      UPDATE inventory_levels SET reserved_quantity = reserved_quantity + ${quantity}::int,
                                  updated_at = now()
      WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid
        AND on_hand_quantity - reserved_quantity >= ${quantity}::int
      RETURNING variant_id::text AS variant_id, warehouse_id::text AS warehouse_id, on_hand_quantity,
                reserved_quantity, available_quantity, low_stock_threshold`,
  );
}

export async function releaseQuantity(
  transaction: DatabaseClient,
  key: StockKey,
  quantity: number,
): Promise<StockLevelRow | null> {
  assertLocked(transaction, 'STOCK_LEVELS', stockKey(key));
  return parseOptionalStockLevel(
    await transaction.$queryRaw`
      UPDATE inventory_levels SET reserved_quantity = reserved_quantity - ${quantity}::int,
                                  updated_at = now()
      WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid
        AND reserved_quantity >= ${quantity}::int
      RETURNING variant_id::text AS variant_id, warehouse_id::text AS warehouse_id, on_hand_quantity,
                reserved_quantity, available_quantity, low_stock_threshold`,
  );
}

// Changes only the threshold: on hand and reserved are never touched.
export async function setLowStockThresholdValue(
  transaction: DatabaseClient,
  key: StockKey,
  lowStockThreshold: number,
): Promise<StockLevelRow | null> {
  assertLocked(transaction, 'STOCK_LEVELS', stockKey(key));
  return parseOptionalStockLevel(
    await transaction.$queryRaw`
      UPDATE inventory_levels SET low_stock_threshold = ${lowStockThreshold}::int, updated_at = now()
      WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid
      RETURNING variant_id::text AS variant_id, warehouse_id::text AS warehouse_id, on_hand_quantity,
                reserved_quantity, available_quantity, low_stock_threshold`,
  );
}

const existingVariantRowsSchema = z.array(z.object({ id: z.string() }));
const warehouseExistsRowsSchema = z.tuple([z.object({ exists: z.boolean() })]);

// Unlocked: variants and warehouses are never deleted, so a row that exists now still exists at commit.
export async function existingStockLocations(
  database: DatabaseClient,
  input: { warehouseId: string; variantIds: readonly string[] },
): Promise<{ warehouseExists: boolean; existingVariantIds: Set<string> }> {
  const [warehouse] = warehouseExistsRowsSchema.parse(
    await database.$queryRaw`SELECT EXISTS (SELECT 1 FROM warehouses WHERE id = ${input.warehouseId}::uuid) AS exists`,
  );
  const variants = existingVariantRowsSchema.parse(
    await database.$queryRaw`
      SELECT id::text AS id FROM product_variants WHERE id = ANY(${[...input.variantIds]}::uuid[])`,
  );
  return {
    warehouseExists: warehouse.exists,
    existingVariantIds: new Set(variants.map(({ id }) => id)),
  };
}
