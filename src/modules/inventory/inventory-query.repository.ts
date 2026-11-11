import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import type { DatabaseClient } from '@/lib/db';

import { countedStockWhere } from './stock-availability';

// Read-only queries: no row locks, no writes.

const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
const variantStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);

const idRowsSchema = z.array(z.object({ id: z.string() }));

// Contains-match without LIKE wildcards: "%" or "_" in a search are ordinary characters.
function containsText(column: Prisma.Sql, search: string): Prisma.Sql {
  return Prisma.sql`strpos(lower(${column}), lower(${search})) > 0`;
}

// One page of product ids for the stock matrix, ordered by (name, id). The cursor is the last product id;
// its name is looked up in SQL, so products with the same name are never skipped or repeated.
export async function stockMatrixProductPage(
  database: DatabaseClient,
  input: {
    search: string | undefined;
    warehouseId: string | undefined;
    lowStockOnly: boolean;
    cursor: string | undefined;
    limit: number;
  },
): Promise<{ productIds: string[]; nextCursor: string | null }> {
  const conditions = [
    Prisma.sql`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id)`,
    input.search === undefined
      ? null
      : Prisma.sql`(${containsText(Prisma.sql`p.name`, input.search)} OR EXISTS (
          SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND ${containsText(Prisma.sql`v.sku`, input.search)}))`,
    input.lowStockOnly
      ? Prisma.sql`EXISTS (
          SELECT 1 FROM inventory_levels l
          JOIN product_variants v ON v.id = l.variant_id
          JOIN warehouses w ON w.id = l.warehouse_id
          WHERE v.product_id = p.id AND p.status <> 'ARCHIVED' AND v.status <> 'ARCHIVED' AND w.is_active
            AND l.available_quantity <= l.low_stock_threshold AND l.low_stock_threshold > 0
            ${input.warehouseId === undefined ? Prisma.empty : Prisma.sql`AND l.warehouse_id = ${input.warehouseId}::uuid`})`
      : null,
    input.cursor === undefined
      ? null
      : Prisma.sql`(p.name, p.id) > (SELECT name, id FROM products WHERE id = ${input.cursor}::uuid)`,
  ].filter((condition) => condition !== null);
  const rows = idRowsSchema.parse(
    await database.$queryRaw`
      SELECT p.id::text AS id FROM products p
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY p.name, p.id
      LIMIT ${input.limit + 1}`,
  );
  const page = rows.slice(0, input.limit).map(({ id }) => id);
  return { productIds: page, nextCursor: rows.length > input.limit ? (page.at(-1) ?? null) : null };
}

// The matrix rows for a page of products, in one query: variants by (sku, id), stock rows by warehouse
// (priority, code, id). Only existing stock rows are returned; a missing row means nothing recorded yet.
export function stockMatrixProducts(
  database: DatabaseClient,
  input: { productIds: readonly string[]; warehouseId: string | undefined },
) {
  return database.product.findMany({
    where: { id: { in: [...input.productIds] } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      status: true,
      variants: {
        orderBy: [{ sku: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          sku: true,
          status: true,
          inventoryLevels: {
            where: input.warehouseId === undefined ? {} : { warehouseId: input.warehouseId },
            orderBy: [
              { warehouse: { priority: 'asc' } },
              { warehouse: { code: 'asc' } },
              { warehouseId: 'asc' },
            ],
            select: {
              warehouseId: true,
              onHandQuantity: true,
              reservedQuantity: true,
              availableQuantity: true,
              lowStockThreshold: true,
              warehouse: { select: { code: true, isActive: true } },
            },
          },
        },
      },
    },
  });
}

const lowStockRowsSchema = z.array(
  z.object({
    warehouse_id: z.string(),
    variant_id: z.string(),
    on_hand_quantity: z.number(),
    reserved_quantity: z.number(),
    available_quantity: z.number(),
    low_stock_threshold: z.number(),
    warehouse_code: z.string(),
    warehouse_is_active: z.boolean(),
    sku: z.string(),
    variant_status: variantStatusSchema,
    product_id: z.string(),
    product_name: z.string(),
    product_status: productStatusSchema,
  }),
);
export type LowStockRow = z.infer<typeof lowStockRowsSchema>[number];

function lowStockConditions(input: {
  warehouseId: string | undefined;
  includeInactiveWarehouses: boolean;
}): Prisma.Sql {
  // The first two conditions are exactly the predicate of inventory_levels_low_stock_idx.
  return Prisma.sql`
    l.available_quantity <= l.low_stock_threshold AND l.low_stock_threshold > 0
    AND p.status <> 'ARCHIVED' AND v.status <> 'ARCHIVED'
    ${input.includeInactiveWarehouses ? Prisma.empty : Prisma.sql`AND w.is_active`}
    ${input.warehouseId === undefined ? Prisma.empty : Prisma.sql`AND l.warehouse_id = ${input.warehouseId}::uuid`}`;
}

export async function lowStockPage(
  database: DatabaseClient,
  input: {
    warehouseId: string | undefined;
    includeInactiveWarehouses: boolean;
    cursor: { warehouseId: string; variantId: string } | undefined;
    limit: number;
  },
): Promise<{ rows: LowStockRow[]; nextCursor: string | null }> {
  const after =
    input.cursor === undefined
      ? Prisma.empty
      : Prisma.sql`AND (l.warehouse_id, l.variant_id) > (${input.cursor.warehouseId}::uuid, ${input.cursor.variantId}::uuid)`;
  const rows = lowStockRowsSchema.parse(
    await database.$queryRaw`
      SELECT l.warehouse_id::text AS warehouse_id, l.variant_id::text AS variant_id, l.on_hand_quantity,
             l.reserved_quantity, l.available_quantity, l.low_stock_threshold, w.code AS warehouse_code,
             w.is_active AS warehouse_is_active, v.sku, v.status::text AS variant_status,
             p.id::text AS product_id, p.name AS product_name, p.status::text AS product_status
      FROM inventory_levels l
      JOIN warehouses w ON w.id = l.warehouse_id
      JOIN product_variants v ON v.id = l.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE ${lowStockConditions(input)} ${after}
      ORDER BY l.warehouse_id, l.variant_id
      LIMIT ${input.limit + 1}`,
  );
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? `${last.warehouse_id}/${last.variant_id}`
        : null,
  };
}

const countRowsSchema = z.tuple([z.object({ count: z.number() })]);

export async function countLowStockRows(
  database: DatabaseClient,
  input: { warehouseId: string | undefined; includeInactiveWarehouses: boolean },
): Promise<number> {
  const [row] = countRowsSchema.parse(
    await database.$queryRaw`
      SELECT count(*)::int AS count
      FROM inventory_levels l
      JOIN warehouses w ON w.id = l.warehouse_id
      JOIN product_variants v ON v.id = l.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE ${lowStockConditions(input)}`,
  );
  return row.count;
}

// SKU, product and warehouse code for the movements on one ledger page, in two queries.
export async function movementLabels(
  database: DatabaseClient,
  input: { variantIds: readonly string[]; warehouseIds: readonly string[] },
) {
  const [variants, warehouses] = await Promise.all([
    database.productVariant.findMany({
      where: { id: { in: [...new Set(input.variantIds)] } },
      select: { id: true, sku: true, product: { select: { id: true, name: true } } },
    }),
    database.warehouse.findMany({
      where: { id: { in: [...new Set(input.warehouseIds)] } },
      select: { id: true, code: true },
    }),
  ]);
  return {
    variantById: new Map(variants.map((variant) => [variant.id, variant])),
    warehouseCodeById: new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.code])),
  };
}

// Available quantity per variant, summed over active warehouses only (countedStockWhere).
export async function availableQuantitiesByVariant(
  database: DatabaseClient,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const sums = await database.inventoryLevel.groupBy({
    by: ['variantId'],
    where: { variantId: { in: [...variantIds] }, ...countedStockWhere },
    _sum: { availableQuantity: true },
  });
  return new Map(sums.map((sum) => [sum.variantId, sum._sum.availableQuantity ?? 0]));
}
