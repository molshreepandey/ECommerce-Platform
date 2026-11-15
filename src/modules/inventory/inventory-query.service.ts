import type {
  ActorType,
  InventoryMovementType,
  ProductStatus,
  ProductVariantStatus,
} from '@/generated/prisma/enums';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';

import { inventoryErrors } from './inventory.errors';
import type {
  ListLowStockInput,
  ListMovementsInput,
  ListStockLevelsInput,
} from './inventory.schema';
import type { AllocatableStock } from './allocation';
import {
  availableQuantitiesByVariant,
  countLowStockRows,
  findAllocatableStockRows,
  lowStockPage,
  movementCursorExists,
  movementLabels,
  productCursorExists,
  stockMatrixProductPage,
  stockMatrixProducts,
} from './inventory-query.repository';
import { listMovementPage } from './inventory-movement.repository';
import { isLowStock, lowStockEligible, quantitiesBefore } from './stock-rules';

// Read-only: these functions never lock or write. Staff reads need inventory.read; available stock is
// always the generated column available_quantity = on_hand_quantity − reserved_quantity.

export interface StockMatrixLevel {
  warehouseId: string;
  warehouseCode: string;
  warehouseActive: boolean;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
  isLowStock: boolean;
}

export interface StockMatrixVariant {
  variantId: string;
  sku: string;
  variantStatus: ProductVariantStatus;
  levels: StockMatrixLevel[];
}

export interface StockMatrixProduct {
  productId: string;
  productName: string;
  productStatus: ProductStatus;
  variants: StockMatrixVariant[];
}

// Variant × warehouse, paged by product. Archived products and variants and inactive warehouses are
// shown (with their status), so physical stock is always visible; the low-stock flag follows the
// low-stock list's rules (never archived, never an inactive warehouse).
export async function listStockLevels(
  staff: StaffContext,
  input: ListStockLevelsInput,
): Promise<{ items: StockMatrixProduct[]; nextCursor: string | null }> {
  assertStaffPermission(staff, 'inventory.read');
  const database = getDatabase();
  if (input.cursor !== undefined && !(await productCursorExists(database, input.cursor))) {
    throw inventoryErrors.invalidCursor();
  }
  const page = await stockMatrixProductPage(database, {
    search: input.search,
    warehouseId: input.warehouseId,
    lowStockOnly: input.lowStockOnly,
    cursor: input.cursor,
    limit: input.limit,
  });
  if (page.productIds.length === 0) return { items: [], nextCursor: null };
  const products = await stockMatrixProducts(database, {
    productIds: page.productIds,
    warehouseId: input.warehouseId,
  });
  const items = products.map((product) => ({
    productId: product.id,
    productName: product.name,
    productStatus: product.status,
    variants: product.variants.map((variant) => ({
      variantId: variant.id,
      sku: variant.sku,
      variantStatus: variant.status,
      levels: variant.inventoryLevels.map((level) => ({
        warehouseId: level.warehouseId,
        warehouseCode: level.warehouse.code,
        warehouseActive: level.warehouse.isActive,
        onHandQuantity: level.onHandQuantity,
        reservedQuantity: level.reservedQuantity,
        availableQuantity: level.availableQuantity,
        lowStockThreshold: level.lowStockThreshold,
        isLowStock:
          isLowStock(level) &&
          lowStockEligible({
            productStatus: product.status,
            variantStatus: variant.status,
            warehouseActive: level.warehouse.isActive,
            includeInactiveWarehouses: false,
          }),
      })),
    })),
  }));
  return { items, nextCursor: page.nextCursor };
}

export interface LowStockItem {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseActive: boolean;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
}

// Stock rows with threshold > 0 and available ≤ threshold, never for an archived product or variant,
// and in active warehouses unless includeInactiveWarehouses. Ordered by (warehouse, variant).
export async function listLowStock(
  staff: StaffContext,
  input: ListLowStockInput,
): Promise<{ items: LowStockItem[]; nextCursor: string | null }> {
  assertStaffPermission(staff, 'inventory.read');
  const page = await lowStockPage(getDatabase(), {
    warehouseId: input.warehouseId,
    includeInactiveWarehouses: input.includeInactiveWarehouses,
    cursor: input.cursor,
    limit: input.limit,
  });
  return {
    items: page.rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      variantId: row.variant_id,
      sku: row.sku,
      warehouseId: row.warehouse_id,
      warehouseCode: row.warehouse_code,
      warehouseActive: row.warehouse_is_active,
      onHandQuantity: row.on_hand_quantity,
      reservedQuantity: row.reserved_quantity,
      availableQuantity: row.available_quantity,
      lowStockThreshold: row.low_stock_threshold,
    })),
    nextCursor: page.nextCursor,
  };
}

export async function countLowStock(
  staff: StaffContext,
  input: { warehouseId?: string | undefined; includeInactiveWarehouses?: boolean | undefined } = {},
): Promise<number> {
  assertStaffPermission(staff, 'inventory.read');
  return await countLowStockRows(getDatabase(), {
    warehouseId: input.warehouseId,
    includeInactiveWarehouses: input.includeInactiveWarehouses ?? false,
  });
}

export interface LedgerMovement {
  movementId: string;
  variantId: string;
  sku: string | null;
  productId: string | null;
  productName: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  movementType: InventoryMovementType;
  quantityDelta: number;
  onHandBefore: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  recordedAt: Date;
}

// Newest first, (created_at, id) keyset: rows with the same timestamp are never skipped or repeated.
export async function listMovements(
  staff: StaffContext,
  input: ListMovementsInput,
): Promise<{ movements: LedgerMovement[]; nextCursor: string | null }> {
  assertStaffPermission(staff, 'inventory.read');
  const database = getDatabase();
  if (input.cursor !== undefined && !(await movementCursorExists(database, input.cursor))) {
    throw inventoryErrors.invalidCursor();
  }
  const page = await listMovementPage(database, {
    filters: {
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      movementType: input.movementType,
      createdFrom: input.createdFrom,
      createdTo: input.createdTo,
    },
    cursor: input.cursor,
    limit: input.limit,
  });
  const labels = await movementLabels(database, {
    variantIds: page.movements.map(({ variantId }) => variantId),
    warehouseIds: page.movements.map(({ warehouseId }) => warehouseId),
  });
  return {
    movements: page.movements.map((movement) => {
      const variant = labels.variantById.get(movement.variantId);
      const before = quantitiesBefore(movement);
      return {
        movementId: movement.id,
        variantId: movement.variantId,
        sku: variant?.sku ?? null,
        productId: variant?.product.id ?? null,
        productName: variant?.product.name ?? null,
        warehouseId: movement.warehouseId,
        warehouseCode: labels.warehouseCodeById.get(movement.warehouseId) ?? null,
        movementType: movement.movementType,
        quantityDelta: movement.quantityDelta,
        onHandBefore: before.onHandBefore,
        onHandAfter: movement.onHandAfter,
        reservedBefore: before.reservedBefore,
        reservedAfter: movement.reservedAfter,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        actorType: movement.actorType,
        actorId: movement.actorId,
        reason: movement.reason,
        recordedAt: movement.createdAt,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

// Internal read for the storefront and cart (Waves 6–7), which have no staff: available quantity per
// variant over active warehouses; a variant with no counted stock is 0. Whether a variant is sellable at
// all (product and variant status) is the caller's rule.
export async function findAvailabilityForVariants(
  database: DatabaseClient,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(variantIds.map((variantId) => variantId.toLowerCase()))];
  const available = await availableQuantitiesByVariant(database, ids);
  return new Map(ids.map((variantId) => [variantId, available.get(variantId) ?? 0]));
}

// Checkout allocation input: available stock per variant and active warehouse, with the warehouse priority.
export async function findAllocatableStock(
  database: DatabaseClient,
  variantIds: readonly string[],
): Promise<AllocatableStock[]> {
  const rows = await findAllocatableStockRows(database, [
    ...new Set(variantIds.map((variantId) => variantId.toLowerCase())),
  ]);
  return rows.map((row) => ({
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    warehousePriority: row.warehouse.priority,
    warehousePincode: row.warehouse.pincode,
    availableQuantity: row.availableQuantity,
  }));
}
