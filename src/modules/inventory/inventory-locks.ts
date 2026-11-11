import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';

import { enterLockLevel } from './lock-order';

const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
const variantStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);

const lockedShipmentRowsSchema = z.array(
  z.object({ id: z.string(), warehouse_id: z.string(), status: z.string() }),
);
export interface LockedShipment {
  id: string;
  warehouseId: string;
  status: string;
}

// L0b. FOR NO KEY UPDATE serialises every reservation change and (Wave 9) status change on a shipment,
// without blocking the key-share locks that inserting shipment_items takes. Missing ids are simply absent.
export async function lockShipments(
  transaction: DatabaseClient,
  shipmentIds: readonly string[],
): Promise<LockedShipment[]> {
  const ids = enterLockLevel(transaction, 'SHIPMENTS', shipmentIds);
  if (ids.length === 0) return [];
  const rows = lockedShipmentRowsSchema.parse(
    await transaction.$queryRaw`
      SELECT id::text AS id, warehouse_id::text AS warehouse_id, status::text AS status
      FROM shipments WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`,
  );
  return rows.map((row) => ({ id: row.id, warehouseId: row.warehouse_id, status: row.status }));
}

const lockedProductRowsSchema = z.array(z.object({ id: z.string(), status: productStatusSchema }));
export type LockedProduct = z.infer<typeof lockedProductRowsSchema>[number];

// L2. FOR SHARE waits for (and blocks) catalogue writes, which lock products FOR UPDATE, so a product's
// status cannot change while a reservation or threshold change depends on it.
export async function lockProductsForShare(
  transaction: DatabaseClient,
  productIds: readonly string[],
): Promise<LockedProduct[]> {
  const ids = enterLockLevel(transaction, 'PRODUCTS', productIds);
  if (ids.length === 0) return [];
  return lockedProductRowsSchema.parse(
    await transaction.$queryRaw`
      SELECT id::text AS id, status::text AS status
      FROM products WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`,
  );
}

const lockedVariantRowsSchema = z.array(
  z.object({ id: z.string(), product_id: z.string(), status: variantStatusSchema }),
);
export interface LockedVariant {
  id: string;
  productId: string;
  status: z.infer<typeof variantStatusSchema>;
}

// L3. Catalogue code changes a variant only while holding its product FOR UPDATE, so after L2 this never
// waits behind a catalogue write; it still blocks a variant status change until commit.
export async function lockVariantsForShare(
  transaction: DatabaseClient,
  variantIds: readonly string[],
): Promise<LockedVariant[]> {
  const ids = enterLockLevel(transaction, 'VARIANTS', variantIds);
  if (ids.length === 0) return [];
  const rows = lockedVariantRowsSchema.parse(
    await transaction.$queryRaw`
      SELECT id::text AS id, product_id::text AS product_id, status::text AS status
      FROM product_variants WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR SHARE`,
  );
  return rows.map((row) => ({ id: row.id, productId: row.product_id, status: row.status }));
}

const variantProductRowsSchema = z.array(z.object({ id: z.string(), product_id: z.string() }));

// Unlocked read used to find which products to lock (L2) before the variants themselves (L3).
export async function productIdsOfVariants(
  database: DatabaseClient,
  variantIds: readonly string[],
): Promise<Map<string, string>> {
  if (variantIds.length === 0) return new Map();
  const rows = variantProductRowsSchema.parse(
    await database.$queryRaw`
      SELECT id::text AS id, product_id::text AS product_id
      FROM product_variants WHERE id = ANY(${[...variantIds]}::uuid[])`,
  );
  return new Map(rows.map((row) => [row.id, row.product_id]));
}
