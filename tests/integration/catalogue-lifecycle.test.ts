import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { updateBrand } from '@/modules/catalogue/brand.service';
import {
  changeProductStatusSchema,
  changeVariantStatusSchema,
  createVariantSchema,
  updateBrandSchema,
} from '@/modules/catalogue/catalogue.schema';
import { changeProductStatus } from '@/modules/catalogue/product.service';
import { archiveProductType } from '@/modules/catalogue/product-type.service';
import { changeVariantStatus, createVariant } from '@/modules/catalogue/variant.service';

import {
  actorFor,
  createApparelType,
  createTestBrand,
  createTestProduct,
  supportStaff,
} from './support/catalogue-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function setUp(slug = 'kurta') {
  const productType = await createApparelType(`apparel_${slug.replaceAll('-', '_')}`);
  const brand = await createTestBrand(`brand-${slug}`);
  const product = await createTestProduct({
    productTypeId: productType.id,
    brandId: brand.id,
    slug,
  });
  return { productType, brand, product };
}

async function addVariant(productId: string, sku: string, size: string) {
  const { variant, productVersion } = await createVariant(
    actorFor(),
    productId,
    createVariantSchema.parse({
      sku,
      optionValues: { size },
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    }),
  );
  return { variant, productVersion };
}

function setStatus(
  productId: string,
  expectedVersion: number,
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
) {
  return changeProductStatus(
    actorFor(),
    productId,
    changeProductStatusSchema.parse({ expectedVersion, status }),
  );
}

function setVariantStatus(variantId: string, status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED') {
  return changeVariantStatus(actorFor(), variantId, changeVariantStatusSchema.parse({ status }));
}

async function currentVersion(productId: string): Promise<number> {
  return (await database.product.findUniqueOrThrow({ where: { id: productId } })).version;
}

async function invariantHolds(productId: string): Promise<boolean> {
  const product = await database.product.findUniqueOrThrow({ where: { id: productId } });
  const activeVariants = await database.productVariant.count({
    where: { productId, status: 'ACTIVE' },
  });
  return product.status !== 'ACTIVE' || activeVariants > 0;
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('activating a product', () => {
  it('fails with 422 while there is no active variant, and changes nothing', async () => {
    const { product } = await setUp();
    await expect(setStatus(product.id, 0, 'ACTIVE')).rejects.toMatchObject({
      code: 'PRODUCT_NOT_READY',
      httpStatus: 422,
      details: { reasons: ['Add at least one active variant'] },
    });
    const { variant, productVersion } = await addVariant(product.id, 'KURTA-M', 'M');
    await setVariantStatus(variant.id, 'INACTIVE');
    await expect(setStatus(product.id, productVersion + 1, 'ACTIVE')).rejects.toMatchObject({
      code: 'PRODUCT_NOT_READY',
    });
    expect((await database.product.findUniqueOrThrow({ where: { id: product.id } })).status).toBe(
      'DRAFT',
    );
    expect(
      await database.auditLog.count({ where: { action: 'catalogue.product_status_changed' } }),
    ).toBe(0);
  });

  it('lists every reason: stored attributes that no longer pass, and an inactive brand', async () => {
    const { brand, product } = await setUp();
    const { productVersion } = await addVariant(product.id, 'KURTA-M', 'M');
    await database.product.update({
      where: { id: product.id },
      data: { attributes: { fabric: 'Wool' } },
    });
    await updateBrand(actorFor(), brand.id, updateBrandSchema.parse({ isActive: false }));
    const rejection = await setStatus(product.id, productVersion, 'ACTIVE').catch(
      (error: unknown) => error,
    );
    expect(rejection).toMatchObject({ code: 'PRODUCT_NOT_READY' });
    const { reasons } = z
      .object({ details: z.object({ reasons: z.array(z.string()) }) })
      .parse(rejection).details;
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toMatch(/^attributes\.fabric: /);
    expect(reasons[1]).toBe('The brand is inactive');
  });

  it('activates with an active variant, bumps the version and audits the change', async () => {
    const { product } = await setUp();
    const { productVersion } = await addVariant(product.id, 'KURTA-M', 'M');
    const active = await setStatus(product.id, productVersion, 'ACTIVE');
    expect(active).toMatchObject({
      status: 'ACTIVE',
      version: productVersion + 1,
      archivedAt: null,
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.product_status_changed' },
      select: { before: true, after: true },
    });
    expect(audit).toEqual({
      before: { status: 'DRAFT', version: productVersion },
      after: { status: 'ACTIVE', version: productVersion + 1 },
    });
  });

  it('refuses a stale version, an undefined transition, a no-op and read-only staff', async () => {
    const { product } = await setUp();
    const { productVersion } = await addVariant(product.id, 'KURTA-M', 'M');
    await expect(setStatus(product.id, 0, 'ACTIVE')).rejects.toMatchObject({
      code: 'STALE_PRODUCT',
    });
    await expect(setStatus(product.id, productVersion, 'DRAFT')).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    });
    const archived = await setStatus(product.id, productVersion, 'ARCHIVED');
    await expect(setStatus(product.id, archived.version, 'ACTIVE')).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
      httpStatus: 409,
      details: { from: 'ARCHIVED', to: 'ACTIVE' },
    });
    await expect(
      changeProductStatus(
        actorFor(supportStaff),
        product.id,
        changeProductStatusSchema.parse({ expectedVersion: archived.version, status: 'DRAFT' }),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('archiving and restoring a product', () => {
  it('archives with a timestamp, keeps variant statuses, and restores to DRAFT', async () => {
    const { product } = await setUp();
    const { variant: medium } = await addVariant(product.id, 'KURTA-M', 'M');
    const { variant: large } = await addVariant(product.id, 'KURTA-L', 'L');
    await setVariantStatus(large.id, 'INACTIVE');
    const active = await setStatus(product.id, await currentVersion(product.id), 'ACTIVE');
    const archived = await setStatus(product.id, active.version, 'ARCHIVED');
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const variants = await database.productVariant.findMany({
      where: { productId: product.id },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(variants.map(({ id, status }) => [id, status]))).toEqual({
      [medium.id]: 'ACTIVE',
      [large.id]: 'INACTIVE',
    });
    const restored = await setStatus(product.id, archived.version, 'DRAFT');
    expect(restored).toMatchObject({ status: 'DRAFT', archivedAt: null });
  });

  it('refuses to restore a product whose type has been archived', async () => {
    const { productType, product } = await setUp();
    const archived = await setStatus(product.id, 0, 'ARCHIVED');
    await archiveProductType(actorFor(), productType.id);
    await expect(setStatus(product.id, archived.version, 'DRAFT')).rejects.toMatchObject({
      code: 'PRODUCT_TYPE_ARCHIVED',
    });
  });
});

describe('the invariant under concurrency', () => {
  it('never leaves an ACTIVE product without an active variant when activation races an archive', async () => {
    for (let round = 0; round < 6; round += 1) {
      const { product } = await setUp(`race-${round}`);
      const { variant, productVersion } = await addVariant(product.id, `RACE-${round}-M`, 'M');
      const results = await Promise.allSettled([
        setStatus(product.id, productVersion, 'ACTIVE'),
        setVariantStatus(variant.id, 'ARCHIVED'),
      ]);
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
        `round ${round}`,
      ).toHaveLength(1);
      expect(await invariantHolds(product.id), `round ${round}`).toBe(true);
    }
  });

  it('lets only one of two concurrent archives remove an active variant of an ACTIVE product', async () => {
    for (let round = 0; round < 4; round += 1) {
      const { product } = await setUp(`pair-${round}`);
      const { variant: medium } = await addVariant(product.id, `PAIR-${round}-M`, 'M');
      const { variant: large, productVersion } = await addVariant(
        product.id,
        `PAIR-${round}-L`,
        'L',
      );
      await setStatus(product.id, productVersion, 'ACTIVE');
      const results = await Promise.allSettled([
        setVariantStatus(medium.id, 'ARCHIVED'),
        setVariantStatus(large.id, 'ARCHIVED'),
      ]);
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(rejected, `round ${round}`).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: 'LAST_ACTIVE_VARIANT' });
      expect(
        await database.productVariant.count({ where: { productId: product.id, status: 'ACTIVE' } }),
      ).toBe(1);
    }
  });
});

describe('archiving never touches stock, orders, carts, reviews or collections', () => {
  async function dependentRecords(): Promise<Record<string, unknown>> {
    const tables = [
      'inventory_levels',
      'inventory_movements',
      'carts',
      'cart_items',
      'orders',
      'order_items',
      'reviews',
      'collection_products',
    ] as const;
    const snapshot: Record<string, unknown> = {};
    for (const table of tables) {
      snapshot[table] = await database.$queryRawUnsafe(
        `SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
      );
    }
    return snapshot;
  }

  async function createDependents(productId: string, variantId: string) {
    const customer = await database.customer.create({
      data: {
        fullName: 'Asha Test',
        email: 'asha.test@example.test',
        phone: '9876500111',
        passwordHash: 'not-a-real-hash',
      },
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
    });
    await database.inventoryLevel.create({
      data: { variantId, warehouseId: warehouse.id, onHandQuantity: 10, reservedQuantity: 3 },
    });
    await database.inventoryMovement.create({
      data: {
        variantId,
        warehouseId: warehouse.id,
        movementType: 'RESERVE',
        quantityDelta: 3,
        onHandAfter: 10,
        reservedAfter: 3,
        actorType: 'SYSTEM',
        reason: 'test reservation',
      },
    });
    const cart = await database.cart.create({ data: { customerId: customer.id } });
    await database.cartItem.create({
      data: { cartId: cart.id, variantId, quantity: 2, addedUnitPricePaise: 79_900 },
    });
    const order = await database.order.create({
      data: {
        orderNumber: 'ORD-TEST-0001',
        customerId: customer.id,
        idempotencyKey: 'archive-test',
        requestFingerprint: 'fingerprint',
        subtotalPaise: 79_900,
        taxPaise: 3_805,
        totalPaise: 79_900,
        shippingAddress: { city: 'Bengaluru', pincode: '560001' },
      },
    });
    const orderItem = await database.orderItem.create({
      data: {
        orderId: order.id,
        variantId,
        productId,
        productName: 'Product kurta',
        brandName: 'Brand kurta',
        sku: 'KURTA-M',
        optionValues: { size: 'M' },
        imageUrl: 'https://picsum.photos/seed/kurta/600/800',
        quantity: 1,
        mrpPaise: 99_900,
        unitPricePaise: 79_900,
        taxRateBasisPoints: 500,
        taxPaise: 3_805,
        lineTotalPaise: 79_900,
      },
    });
    await database.review.create({
      data: {
        productId,
        customerId: customer.id,
        orderItemId: orderItem.id,
        rating: 5,
        title: 'Lovely',
      },
    });
    const collection = await database.collection.create({
      data: { name: 'Festive', slug: 'festive' },
    });
    await database.collectionProduct.create({ data: { collectionId: collection.id, productId } });
  }

  it('keeps every dependent row byte-identical through variant archive, product archive and restore', async () => {
    const { product } = await setUp();
    const { variant: medium } = await addVariant(product.id, 'KURTA-M', 'M');
    await addVariant(product.id, 'KURTA-L', 'L');
    const active = await setStatus(product.id, await currentVersion(product.id), 'ACTIVE');
    await createDependents(product.id, medium.id);
    const before = await dependentRecords();
    expect(Object.values(before).every((rows) => Array.isArray(rows) && rows.length > 0)).toBe(
      true,
    );

    await setVariantStatus(medium.id, 'ARCHIVED');
    expect(await dependentRecords()).toEqual(before);
    const archived = await setStatus(product.id, active.version + 1, 'ARCHIVED');
    expect(await dependentRecords()).toEqual(before);
    await setStatus(product.id, archived.version, 'DRAFT');
    expect(await dependentRecords()).toEqual(before);

    const stock = await database.inventoryLevel.findFirstOrThrow({
      where: { variantId: medium.id },
    });
    expect(stock).toMatchObject({ onHandQuantity: 10, reservedQuantity: 3, availableQuantity: 7 });
  });
});
