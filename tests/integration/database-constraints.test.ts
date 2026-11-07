import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';

import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function createStockedVariant(onHandQuantity: number) {
  const productType = await database.productType.create({
    data: { code: 'apparel', name: 'Apparel' },
  });
  const brand = await database.brand.create({ data: { name: 'Test Brand', slug: 'test-brand' } });
  const product = await database.product.create({
    data: {
      productTypeId: productType.id,
      brandId: brand.id,
      name: 'Test Kurta',
      slug: 'test-kurta',
      taxRateBasisPoints: 500,
    },
    select: { id: true },
  });
  const variant = await database.productVariant.create({
    data: {
      productId: product.id,
      sku: 'TEST-KURTA-M',
      optionSignature: 'size=M',
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    },
    select: { id: true },
  });
  const warehouse = await database.warehouse.create({
    data: {
      code: 'WH-TEST',
      name: 'Test Warehouse',
      addressLine1: '1 Test Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      contactName: 'Test Contact',
      contactPhone: '9876500000',
      priority: 1,
    },
    select: { id: true },
  });
  await database.inventoryLevel.create({
    data: { variantId: variant.id, warehouseId: warehouse.id, onHandQuantity },
  });
  return { variantId: variant.id, warehouseId: warehouse.id };
}

function reserveOneUnit(variantId: string, warehouseId: string): Promise<number> {
  return database.$executeRaw`
    UPDATE inventory_levels SET reserved_quantity = reserved_quantity + 1
    WHERE variant_id = ${variantId}::uuid AND warehouse_id = ${warehouseId}::uuid
      AND on_hand_quantity - reserved_quantity >= 1`;
}

async function readStock(variantId: string, warehouseId: string) {
  return database.inventoryLevel.findUniqueOrThrow({
    where: { variantId_warehouseId: { variantId, warehouseId } },
    select: { onHandQuantity: true, reservedQuantity: true, availableQuantity: true },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('inventory constraints', () => {
  it('rejects reserving more than is on hand', async () => {
    const { variantId, warehouseId } = await createStockedVariant(2);
    await expect(
      database.inventoryLevel.update({
        where: { variantId_warehouseId: { variantId, warehouseId } },
        data: { reservedQuantity: 3 },
      }),
    ).rejects.toThrow(/inventory_levels_quantities_check/);
    expect(await readStock(variantId, warehouseId)).toEqual({
      onHandQuantity: 2,
      reservedQuantity: 0,
      availableQuantity: 2,
    });
  });

  it('rejects negative on-hand stock', async () => {
    const { variantId, warehouseId } = await createStockedVariant(2);
    await expect(
      database.inventoryLevel.update({
        where: { variantId_warehouseId: { variantId, warehouseId } },
        data: { onHandQuantity: -1 },
      }),
    ).rejects.toThrow(/inventory_levels_quantities_check/);
  });

  it('the guarded reservation updates one row when stock is available and none when it is not', async () => {
    const { variantId, warehouseId } = await createStockedVariant(1);
    expect(await reserveOneUnit(variantId, warehouseId)).toBe(1);
    expect(await reserveOneUnit(variantId, warehouseId)).toBe(0);
    expect(await readStock(variantId, warehouseId)).toEqual({
      onHandQuantity: 1,
      reservedQuantity: 1,
      availableQuantity: 0,
    });
  });

  it('20 parallel reservations against 7 units reserve exactly 7 and never oversell', async () => {
    const { variantId, warehouseId } = await createStockedVariant(7);
    const updatedRowCounts = await Promise.all(
      Array.from({ length: 20 }, () => reserveOneUnit(variantId, warehouseId)),
    );
    expect(updatedRowCounts.filter((count) => count === 1)).toHaveLength(7);
    expect(updatedRowCounts.filter((count) => count === 0)).toHaveLength(13);
    expect(await readStock(variantId, warehouseId)).toEqual({
      onHandQuantity: 7,
      reservedQuantity: 7,
      availableQuantity: 0,
    });
  });

  it('refuses writes to the generated available_quantity column', async () => {
    const { variantId, warehouseId } = await createStockedVariant(2);
    await expect(
      database.$executeRaw`
        UPDATE inventory_levels SET available_quantity = 99
        WHERE variant_id = ${variantId}::uuid AND warehouse_id = ${warehouseId}::uuid`,
    ).rejects.toThrow(/available_quantity/);
  });
});

describe('catalogue and customer constraints', () => {
  it('rejects a variant price above its MRP, and a zero price', async () => {
    const { variantId } = await createStockedVariant(1);
    await expect(
      database.productVariant.update({ where: { id: variantId }, data: { pricePaise: 100_000 } }),
    ).rejects.toThrow(/product_variants_price_check/);
    await expect(
      database.productVariant.update({ where: { id: variantId }, data: { pricePaise: 0 } }),
    ).rejects.toThrow(/product_variants_price_check/);
  });

  it('rejects a category deeper than level 4 and a root category with a level other than 1', async () => {
    await expect(
      database.category.create({
        data: { level: 5, name: 'Too Deep', slug: 'too-deep', path: '/too-deep/' },
      }),
    ).rejects.toThrow(/categories_level_check/);
    await expect(
      database.category.create({
        data: { level: 2, name: 'Orphan', slug: 'orphan', path: '/orphan/' },
      }),
    ).rejects.toThrow(/categories_root_level_check/);
  });

  it('allows only one default address per customer, and validates pincodes', async () => {
    const customer = await database.customer.create({
      data: {
        fullName: 'Test Customer',
        email: 'test.customer@example.test',
        phone: '9876500099',
        passwordHash: 'not-a-real-hash',
      },
      select: { id: true },
    });
    const address = {
      customerId: customer.id,
      recipientName: 'Test Customer',
      phone: '9876500099',
      addressLine1: '1 Test Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    };
    await database.customerAddress.create({ data: { ...address, isDefault: true } });
    await expect(
      database.customerAddress.create({ data: { ...address, isDefault: true } }),
    ).rejects.toThrow(/customer_addresses_one_default_per_customer|Unique constraint/);
    await expect(
      database.customerAddress.create({ data: { ...address, pincode: '012345' } }),
    ).rejects.toThrow(/customer_addresses_pincode_check/);
    expect(await database.customerAddress.count({ where: { customerId: customer.id } })).toBe(1);
  });
});
