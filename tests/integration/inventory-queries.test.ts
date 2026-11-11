import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { ProductStatus, ProductVariantStatus } from '@/generated/prisma/enums';
import { getDatabase } from '@/lib/db';
import { variantIdSchema, warehouseIdSchema } from '@/lib/ids';
import {
  listLowStockSchema,
  listMovementsSchema,
  listStockLevelsSchema,
} from '@/modules/inventory/inventory.schema';
import {
  countLowStock,
  findAvailabilityForVariants,
  listLowStock,
  listMovements,
  listStockLevels,
} from '@/modules/inventory/inventory-query.service';
import { reserveStock } from '@/modules/inventory/reservation.service';
import { addStock } from '@/modules/inventory/stock-adjustment.service';

import {
  createCustomerRow,
  createShipmentRow,
  createStaffMember,
  createStockLevelRow,
  createWarehouseRow,
  customerInventoryActor,
  inventoryState,
  reservationLine,
  staffInventoryActor,
} from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function catalogueBasics() {
  const productType = await database.productType.create({
    data: { code: 'apparel', name: 'Apparel' },
    select: { id: true },
  });
  const brand = await database.brand.create({
    data: { name: 'Test Brand', slug: 'test-brand' },
    select: { id: true },
  });
  return { productTypeId: productType.id, brandId: brand.id };
}

async function productWith(
  basics: { productTypeId: string; brandId: string },
  input: {
    name: string;
    status?: ProductStatus;
    variants: readonly (readonly [sku: string, status?: ProductVariantStatus])[];
  },
) {
  const status = input.status ?? 'ACTIVE';
  const product = await database.product.create({
    data: {
      ...basics,
      name: input.name,
      slug: `${input.name.toLowerCase().replaceAll(' ', '-')}-${randomUUID().slice(0, 8)}`,
      taxRateBasisPoints: 500,
      status,
      archivedAt: status === 'ARCHIVED' ? new Date() : null,
    },
    select: { id: true },
  });
  const variantIds: string[] = [];
  for (const [sku, variantStatus] of input.variants) {
    const variant = await database.productVariant.create({
      data: {
        productId: product.id,
        sku,
        optionSignature: `sku=${sku}`,
        mrpPaise: 99_900,
        pricePaise: 79_900,
        weightGrams: 300,
        lengthMm: 300,
        breadthMm: 250,
        heightMm: 30,
        status: variantStatus ?? 'ACTIVE',
      },
      select: { id: true },
    });
    variantIds.push(variant.id);
  }
  return { productId: product.id, variantIds };
}

async function reader() {
  return createStaffMember(['inventory.read']);
}

function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1)
    throw new Error(`expected exactly one item, got ${String(items.length)}`);
  return item;
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('stock matrix', () => {
  async function matrixSetup() {
    const basics = await catalogueBasics();
    const first = await createWarehouseRow({ code: 'WH-A', priority: 1 });
    const second = await createWarehouseRow({ code: 'WH-B', priority: 2 });
    const inactive = await createWarehouseRow({ code: 'WH-C', priority: 3, isActive: false });
    const kurta = await productWith(basics, {
      name: 'Alpha Kurta',
      variants: [['AK-M'], ['AK-L']],
    });
    const archived = await productWith(basics, {
      name: 'Archived Saree',
      status: 'ARCHIVED',
      variants: [['AS-M', 'ARCHIVED']],
    });
    const unstocked = await productWith(basics, { name: 'Gamma Shirt', variants: [['GS-M']] });
    const [kurtaM, kurtaL] = kurta.variantIds;
    const [saree] = archived.variantIds;
    if (kurtaM === undefined || kurtaL === undefined || saree === undefined)
      throw new Error('variants expected');
    await createStockLevelRow({
      variantId: kurtaM,
      warehouseId: second.id,
      onHandQuantity: 9,
      reservedQuantity: 4,
      lowStockThreshold: 5,
    });
    await createStockLevelRow({
      variantId: kurtaM,
      warehouseId: first.id,
      onHandQuantity: 20,
      reservedQuantity: 2,
      lowStockThreshold: 5,
    });
    await createStockLevelRow({
      variantId: kurtaM,
      warehouseId: inactive.id,
      onHandQuantity: 1,
      lowStockThreshold: 5,
    });
    await createStockLevelRow({
      variantId: kurtaL,
      warehouseId: first.id,
      onHandQuantity: 3,
      lowStockThreshold: 0,
    });
    await createStockLevelRow({
      variantId: saree,
      warehouseId: first.id,
      onHandQuantity: 2,
      lowStockThreshold: 5,
    });
    return { basics, first, second, inactive, kurta, archived, unstocked, kurtaM, kurtaL, saree };
  }

  it('shows variant × warehouse with available = on hand − reserved, statuses and a rule-following low-stock flag', async () => {
    const at = await matrixSetup();
    const { items, nextCursor } = await listStockLevels(
      await reader(),
      listStockLevelsSchema.parse({}),
    );
    expect(nextCursor).toBeNull();
    expect(items.map(({ productName }) => productName)).toEqual([
      'Alpha Kurta',
      'Archived Saree',
      'Gamma Shirt',
    ]);

    const kurta = items[0];
    expect(kurta?.variants.map(({ sku }) => sku)).toEqual(['AK-L', 'AK-M']);
    const medium = kurta?.variants.find(({ sku }) => sku === 'AK-M');
    expect(medium?.levels).toEqual([
      {
        warehouseId: at.first.id,
        warehouseCode: 'WH-A',
        warehouseActive: true,
        onHandQuantity: 20,
        reservedQuantity: 2,
        availableQuantity: 18,
        lowStockThreshold: 5,
        isLowStock: false,
      },
      {
        warehouseId: at.second.id,
        warehouseCode: 'WH-B',
        warehouseActive: true,
        onHandQuantity: 9,
        reservedQuantity: 4,
        availableQuantity: 5,
        lowStockThreshold: 5,
        isLowStock: true,
      },
      // Low by the numbers, but an inactive warehouse is not flagged.
      {
        warehouseId: at.inactive.id,
        warehouseCode: 'WH-C',
        warehouseActive: false,
        onHandQuantity: 1,
        reservedQuantity: 0,
        availableQuantity: 1,
        lowStockThreshold: 5,
        isLowStock: false,
      },
    ]);
    // Archived stock stays visible, never flagged as low.
    expect(items[1]).toMatchObject({
      productStatus: 'ARCHIVED',
      variants: [
        { variantStatus: 'ARCHIVED', levels: [{ availableQuantity: 2, isLowStock: false }] },
      ],
    });
    // A product with no stock rows yet is listed with empty levels.
    expect(items[2]).toMatchObject({
      productName: 'Gamma Shirt',
      variants: [{ sku: 'GS-M', levels: [] }],
    });
  });

  it('searches product names and SKUs case-insensitively, treating % and _ as ordinary characters', async () => {
    await matrixSetup();
    const staff = await reader();
    const names = async (search: string) =>
      (await listStockLevels(staff, listStockLevelsSchema.parse({ search }))).items.map(
        ({ productName }) => productName,
      );
    expect(await names('kurta')).toEqual(['Alpha Kurta']);
    expect(await names('gs-m')).toEqual(['Gamma Shirt']);
    expect(await names('%')).toEqual([]);
    expect(await names('_')).toEqual([]);
  });

  it('shows only the chosen warehouse’s stock rows, still listing every product', async () => {
    const at = await matrixSetup();
    const { items } = await listStockLevels(
      await reader(),
      listStockLevelsSchema.parse({ warehouseId: at.second.id }),
    );
    expect(items.map(({ productName }) => productName)).toEqual([
      'Alpha Kurta',
      'Archived Saree',
      'Gamma Shirt',
    ]);
    const levels = items.flatMap(({ variants }) => variants.flatMap((variant) => variant.levels));
    expect(levels.map(({ warehouseCode }) => warehouseCode)).toEqual(['WH-B']);
  });

  it('limits to products with an eligible low-stock row when asked', async () => {
    const at = await matrixSetup();
    const staff = await reader();
    const low = await listStockLevels(staff, listStockLevelsSchema.parse({ lowStockOnly: 'true' }));
    expect(low.items.map(({ productName }) => productName)).toEqual(['Alpha Kurta']);
    const lowInFirst = await listStockLevels(
      staff,
      listStockLevelsSchema.parse({ lowStockOnly: 'true', warehouseId: at.first.id }),
    );
    expect(lowInFirst.items).toEqual([]);
  });

  it('pages by (name, id) with no product skipped or repeated, even with identical names', async () => {
    const basics = await catalogueBasics();
    const created = [];
    for (const [index, name] of [
      'Same Name',
      'Same Name',
      'Same Name',
      'Another',
      'Zeta',
    ].entries()) {
      created.push(await productWith(basics, { name, variants: [[`P${String(index)}-M`]] }));
    }
    const staff = await reader();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listStockLevels(
        staff,
        listStockLevelsSchema.parse({ limit: '2', ...(cursor === undefined ? {} : { cursor }) }),
      );
      seen.push(...result.items.map(({ productId }) => productId));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    const sameNameIds = created
      .slice(0, 3)
      .map(({ productId }) => productId)
      .sort();
    expect(seen).toEqual([created[3]?.productId, ...sameNameIds, created[4]?.productId]);
  });
});

describe('low-stock list', () => {
  async function lowStockSetup() {
    const basics = await catalogueBasics();
    const active = await createWarehouseRow({ code: 'WH-A' });
    const inactive = await createWarehouseRow({ code: 'WH-Z', isActive: false });
    const cases = [
      { name: 'At threshold', available: 5, threshold: 5, low: true },
      { name: 'Below threshold', available: 1, threshold: 5, low: true },
      { name: 'Above threshold', available: 6, threshold: 5, low: false },
      { name: 'No threshold', available: 0, threshold: 0, low: false },
      { name: 'Draft product', available: 0, threshold: 2, low: true, status: 'DRAFT' as const },
      {
        name: 'Inactive variant',
        available: 0,
        threshold: 2,
        low: true,
        variantStatus: 'INACTIVE' as const,
      },
      {
        name: 'Archived product',
        available: 0,
        threshold: 2,
        low: false,
        status: 'ARCHIVED' as const,
      },
      {
        name: 'Archived variant',
        available: 0,
        threshold: 2,
        low: false,
        variantStatus: 'ARCHIVED' as const,
      },
    ];
    const lowVariantIds: string[] = [];
    for (const [index, item] of cases.entries()) {
      const { variantIds } = await productWith(basics, {
        name: item.name,
        ...(item.status === undefined ? {} : { status: item.status }),
        variants: [[`LS-${String(index)}`, item.variantStatus ?? 'ACTIVE']],
      });
      const [variantId] = variantIds;
      if (variantId === undefined) throw new Error('variant expected');
      // Available = on hand − reserved: reserve 1 of (available + 1).
      await createStockLevelRow({
        variantId,
        warehouseId: active.id,
        onHandQuantity: item.available + 1,
        reservedQuantity: 1,
        lowStockThreshold: item.threshold,
      });
      if (item.low) lowVariantIds.push(variantId);
    }
    const {
      variantIds: [strandedId = ''],
    } = await productWith(basics, { name: 'Stranded', variants: [['LS-ST']] });
    await createStockLevelRow({
      variantId: strandedId,
      warehouseId: inactive.id,
      onHandQuantity: 0,
      lowStockThreshold: 3,
    });
    return { active, inactive, lowVariantIds, strandedId };
  }

  it('lists exactly the eligible rows: threshold above 0, available at or below it, not archived, active warehouse', async () => {
    const at = await lowStockSetup();
    const staff = await reader();
    const { items } = await listLowStock(staff, listLowStockSchema.parse({}));
    expect(items.map(({ variantId }) => variantId).sort()).toEqual([...at.lowVariantIds].sort());
    for (const item of items) {
      expect(item.availableQuantity).toBe(item.onHandQuantity - item.reservedQuantity);
      expect(item.availableQuantity).toBeLessThanOrEqual(item.lowStockThreshold);
    }
    expect(await countLowStock(staff)).toBe(at.lowVariantIds.length);
  });

  it('includes inactive warehouses only when asked, and filters by warehouse', async () => {
    const at = await lowStockSetup();
    const staff = await reader();
    const withInactive = await listLowStock(
      staff,
      listLowStockSchema.parse({ includeInactiveWarehouses: 'true' }),
    );
    expect(withInactive.items.map(({ variantId }) => variantId)).toContain(at.strandedId);
    expect(await countLowStock(staff, { includeInactiveWarehouses: true })).toBe(
      at.lowVariantIds.length + 1,
    );
    const onlyInactive = await listLowStock(
      staff,
      listLowStockSchema.parse({ includeInactiveWarehouses: 'true', warehouseId: at.inactive.id }),
    );
    expect(only(onlyInactive.items)).toMatchObject({
      variantId: at.strandedId,
      warehouseActive: false,
    });
    expect(await countLowStock(staff, { warehouseId: at.inactive.id })).toBe(0);
  });

  it('pages in (warehouse, variant) order with no row skipped or repeated', async () => {
    await lowStockSetup();
    const staff = await reader();
    const full = await listLowStock(
      staff,
      listLowStockSchema.parse({ includeInactiveWarehouses: 'true', limit: '100' }),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await listLowStock(
        staff,
        listLowStockSchema.parse({
          includeInactiveWarehouses: 'true',
          limit: '2',
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      seen.push(...result.items.map(({ warehouseId, variantId }) => `${warehouseId}/${variantId}`));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    const expected = full.items.map(({ warehouseId, variantId }) => `${warehouseId}/${variantId}`);
    expect(seen).toEqual(expected);
    expect([...expected].sort()).toEqual(expected);
  });
});

describe('movement ledger', () => {
  it('lists real movements newest first with before-values, SKU, warehouse code, actor and reference', async () => {
    const basics = await catalogueBasics();
    const warehouse = await createWarehouseRow({ code: 'WH-LEDGER' });
    const {
      variantIds: [variantId = ''],
    } = await productWith(basics, { name: 'Ledger Kurta', variants: [['LK-M']] });
    const staff = await createStaffMember(['inventory.read', 'inventory.write']);
    const key = { variantId, warehouseId: warehouse.id };
    const added = await addStock(staffInventoryActor(staff), randomUUID(), {
      variantId: variantIdSchema.parse(variantId),
      warehouseId: warehouseIdSchema.parse(warehouse.id),
      quantity: 10,
      reason: 'Opening count',
    });
    const customerId = await createCustomerRow();
    const shipment = await createShipmentRow({ customerId, warehouseId: warehouse.id });
    await database.$transaction((transaction) =>
      reserveStock(transaction, customerInventoryActor(customerId), [
        reservationLine(shipment.id, key, 3),
      ]),
    );

    const { movements, nextCursor } = await listMovements(staff, listMovementsSchema.parse({}));
    expect(nextCursor).toBeNull();
    expect(movements.map(({ movementType }) => movementType)).toEqual(['RESERVE', 'ADJUSTMENT']);
    expect(movements[0]).toMatchObject({
      sku: 'LK-M',
      productName: 'Ledger Kurta',
      warehouseCode: 'WH-LEDGER',
      onHandBefore: 10,
      reservedBefore: 0,
      reservedAfter: 3,
      referenceType: 'shipment',
      referenceId: shipment.id,
      actorType: 'CUSTOMER',
      actorId: customerId,
    });
    expect(movements[1]).toMatchObject({
      onHandBefore: 0,
      onHandAfter: 10,
      referenceId: added.changeRequestId,
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      reason: 'Opening count',
    });

    const reservesOnly = await listMovements(
      staff,
      listMovementsSchema.parse({ movementType: 'RESERVE', warehouseId: warehouse.id, variantId }),
    );
    expect(reservesOnly.movements).toHaveLength(1);
    const otherWarehouse = await createWarehouseRow();
    expect(
      (await listMovements(staff, listMovementsSchema.parse({ warehouseId: otherWarehouse.id })))
        .movements,
    ).toEqual([]);
  });

  it('pages through rows sharing one microsecond without skipping or repeating any', async () => {
    const basics = await catalogueBasics();
    const warehouse = await createWarehouseRow();
    const {
      variantIds: [variantId = ''],
    } = await productWith(basics, { name: 'Same Moment', variants: [['SM-M']] });
    for (let index = 0; index < 9; index += 1) {
      await database.$executeRaw`
        INSERT INTO inventory_movements (variant_id, warehouse_id, movement_type, quantity_delta, on_hand_after, reserved_after, reason, actor_type, created_at)
        VALUES (${variantId}::uuid, ${warehouse.id}::uuid, 'RECEIPT', 1, ${index + 1}::int, 0, 'INV-1', 'SYSTEM', '2026-10-01 10:00:00.123456+00')`;
    }
    const staff = await reader();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listMovements(
        staff,
        listMovementsSchema.parse({ limit: '4', ...(cursor === undefined ? {} : { cursor }) }),
      );
      seen.push(...result.movements.map(({ movementId }) => movementId));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);
    expect([...seen].sort().reverse()).toEqual(seen);
  });
});

describe('availability for the storefront', () => {
  it('sums available stock over active warehouses only, and reports 0 for variants without stock', async () => {
    const basics = await catalogueBasics();
    const first = await createWarehouseRow();
    const second = await createWarehouseRow();
    const inactive = await createWarehouseRow({ isActive: false });
    const {
      variantIds: [stocked = '', empty = ''],
    } = await productWith(basics, { name: 'Available', variants: [['AV-M'], ['AV-L']] });
    await createStockLevelRow({
      variantId: stocked,
      warehouseId: first.id,
      onHandQuantity: 10,
      reservedQuantity: 4,
    });
    await createStockLevelRow({ variantId: stocked, warehouseId: second.id, onHandQuantity: 3 });
    await createStockLevelRow({ variantId: stocked, warehouseId: inactive.id, onHandQuantity: 50 });
    const availability = await findAvailabilityForVariants(database, [
      stocked,
      empty,
      stocked.toUpperCase(),
    ]);
    expect(availability).toEqual(
      new Map([
        [stocked, 9],
        [empty, 0],
      ]),
    );
  });
});

describe('read-only and permissions', () => {
  it('changes nothing: no stock, movement, request, audit, outbox or timestamp change', async () => {
    const basics = await catalogueBasics();
    const warehouse = await createWarehouseRow();
    const {
      variantIds: [variantId = ''],
    } = await productWith(basics, { name: 'Read Only', variants: [['RO-M']] });
    await createStockLevelRow({
      variantId,
      warehouseId: warehouse.id,
      onHandQuantity: 2,
      lowStockThreshold: 3,
    });
    const before = await inventoryState();
    const timestamps = await database.inventoryLevel.findMany({ select: { updatedAt: true } });
    const staff = await reader();
    await listStockLevels(staff, listStockLevelsSchema.parse({ lowStockOnly: 'true' }));
    await listLowStock(staff, listLowStockSchema.parse({}));
    await countLowStock(staff);
    await listMovements(staff, listMovementsSchema.parse({}));
    await findAvailabilityForVariants(database, [variantId]);
    expect(await inventoryState()).toEqual(before);
    expect(await database.inventoryLevel.findMany({ select: { updatedAt: true } })).toEqual(
      timestamps,
    );
    expect(await database.auditLog.count()).toBe(0);
  });

  it('refuses every staff read without inventory.read', async () => {
    const outsider = await createStaffMember(['catalogue.read', 'orders.read']);
    for (const attempt of [
      () => listStockLevels(outsider, listStockLevelsSchema.parse({})),
      () => listLowStock(outsider, listLowStockSchema.parse({})),
      () => countLowStock(outsider),
      () => listMovements(outsider, listMovementsSchema.parse({})),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
    }
  });
});
