import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { updateBrand } from '@/modules/catalogue/brand.service';
import {
  createBrandSchema,
  createProductSchema,
  listProductsSchema,
  updateBrandSchema,
  updateProductSchema,
} from '@/modules/catalogue/catalogue.schema';
import { createBrand } from '@/modules/catalogue/brand.service';
import {
  createProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '@/modules/catalogue/product.service';

import {
  actorFor,
  createApparelType,
  createTestBrand,
  createTestProduct,
  staffWithoutCatalogue,
  supportStaff,
} from './support/catalogue-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function setUp() {
  const productType = await createApparelType();
  const brand = await createTestBrand();
  return { productType, brand };
}

function productInput(
  productTypeId: string,
  brandId: string,
  overrides: Record<string, unknown> = {},
) {
  return createProductSchema.parse({
    productTypeId,
    brandId,
    name: 'Cotton Kurta',
    attributes: { fabric: 'Cotton' },
    taxRateBasisPoints: 500,
    ...overrides,
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('brands', () => {
  it('derives the slug from the name, refuses a duplicate slug and reindexes the brand’s products on rename', async () => {
    const { productType } = await setUp();
    const brand = await createBrand(actorFor(), createBrandSchema.parse({ name: 'Indigo Looms' }));
    expect(brand.slug).toBe('indigo-looms');
    await expect(
      createBrand(actorFor(), createBrandSchema.parse({ name: 'Copy', slug: 'indigo-looms' })),
    ).rejects.toMatchObject({ code: 'BRAND_SLUG_TAKEN', httpStatus: 409 });
    await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    const outboxBefore = await database.searchOutbox.count();
    await updateBrand(actorFor(), brand.id, updateBrandSchema.parse({ name: 'Indigo Looms Co' }));
    expect(await database.searchOutbox.count()).toBe(outboxBefore + 1);
  });

  it('keeps a deactivated brand on its products but refuses it for new products', async () => {
    const { productType, brand } = await setUp();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    await updateBrand(actorFor(), brand.id, updateBrandSchema.parse({ isActive: false }));
    expect((await getProduct(supportStaff, product.id)).brand.id).toBe(brand.id);
    await expect(
      createProduct(actorFor(), productInput(productType.id, brand.id, { slug: 'second' })),
    ).rejects.toMatchObject({ code: 'BRAND_INACTIVE', httpStatus: 422 });
  });
});

describe('creating products', () => {
  it('creates a draft with version 0, no category, one audit row and one outbox row', async () => {
    const { productType, brand } = await setUp();
    const actor = actorFor();
    const product = await createProduct(actor, productInput(productType.id, brand.id));
    expect(product).toMatchObject({
      slug: 'cotton-kurta',
      status: 'DRAFT',
      version: 0,
      taggingStatus: 'UNTAGGED',
      categoryId: null,
      attributes: { fabric: 'Cotton' },
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.product_created', entityId: product.id },
      select: { actorId: true, after: true },
    });
    expect(audit.actorId).toBe(actor.staff.staffUserId);
    expect(audit.after).toMatchObject({ status: 'DRAFT', attributes: '{"fabric":"Cotton"}' });
    expect(await database.searchOutbox.count({ where: { entityId: product.id } })).toBe(1);
  });

  it.each([
    ['a missing required attribute', {}, 'attributes.fabric'],
    ['an enum value that is not allowed', { fabric: 'Wool' }, 'attributes.fabric'],
    ['an attribute the type does not have', { fabric: 'Silk', gsm: 180 }, 'attributes.gsm'],
    ['a variant option at product level', { fabric: 'Silk', size: 'M' }, 'attributes.size'],
  ])('refuses %s with 400 and writes nothing', async (_label, attributes, field) => {
    const { productType, brand } = await setUp();
    const auditRowsBefore = await database.auditLog.count();
    const outboxRowsBefore = await database.searchOutbox.count();
    const rejection = await createProduct(
      actorFor(),
      productInput(productType.id, brand.id, { attributes }),
    ).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
    expect(rejection).toHaveProperty(['details', 'fieldErrors', field]);
    expect(await database.product.count()).toBe(0);
    expect(await database.auditLog.count()).toBe(auditRowsBefore);
    expect(await database.searchOutbox.count()).toBe(outboxRowsBefore);
  });

  it('refuses a duplicate slug with 409, and unknown types or brands with 404', async () => {
    const { productType, brand } = await setUp();
    await createProduct(actorFor(), productInput(productType.id, brand.id));
    await expect(
      createProduct(actorFor(), productInput(productType.id, brand.id)),
    ).rejects.toMatchObject({ code: 'PRODUCT_SLUG_TAKEN', httpStatus: 409 });
    const unknownId = '0195f2a0-0000-7000-8000-000000000999';
    await expect(
      createProduct(actorFor(), productInput(unknownId, brand.id, { slug: 'x-1' })),
    ).rejects.toMatchObject({ code: 'PRODUCT_TYPE_NOT_FOUND', httpStatus: 404 });
    await expect(
      createProduct(actorFor(), productInput(productType.id, unknownId, { slug: 'x-2' })),
    ).rejects.toMatchObject({ code: 'BRAND_NOT_FOUND', httpStatus: 404 });
  });

  it('refuses read-only and unrelated staff', async () => {
    const { productType, brand } = await setUp();
    await expect(
      createProduct(actorFor(supportStaff), productInput(productType.id, brand.id)),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    await expect(getProduct(staffWithoutCatalogue, product.id)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect((await getProduct(supportStaff, product.id)).id).toBe(product.id);
  });
});

describe('updating products (optimistic locking)', () => {
  it('increments the version, audits before and after, and refuses a stale version without writing', async () => {
    const { productType, brand } = await setUp();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    const updated = await updateProduct(
      actorFor(),
      product.id,
      updateProductSchema.parse({
        expectedVersion: 0,
        name: 'Silk Kurta',
        attributes: { fabric: 'Silk' },
      }),
    );
    expect(updated).toMatchObject({
      version: 1,
      name: 'Silk Kurta',
      attributes: { fabric: 'Silk' },
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.product_updated' },
      select: { before: true, after: true },
    });
    expect(audit.before).toMatchObject({ name: 'Product kurta', version: 0 });
    expect(audit.after).toMatchObject({ name: 'Silk Kurta', version: 1 });

    await expect(
      updateProduct(
        actorFor(),
        product.id,
        updateProductSchema.parse({ expectedVersion: 0, name: 'Lost update' }),
      ),
    ).rejects.toMatchObject({ code: 'STALE_PRODUCT', httpStatus: 409 });
    expect((await getProduct(supportStaff, product.id)).name).toBe('Silk Kurta');
    expect(await database.auditLog.count({ where: { action: 'catalogue.product_updated' } })).toBe(
      1,
    );
  });

  it('lets exactly one of five concurrent updates from the same version win', async () => {
    const { productType, brand } = await setUp();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, attempt) =>
        updateProduct(
          actorFor(),
          product.id,
          updateProductSchema.parse({ expectedVersion: 0, name: `Edit number ${attempt}` }),
        ),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(4);
    for (const result of rejected) expect(result.reason).toMatchObject({ code: 'STALE_PRODUCT' });
    const final = await getProduct(supportStaff, product.id);
    expect(final.version).toBe(1);
    expect(await database.auditLog.count({ where: { action: 'catalogue.product_updated' } })).toBe(
      1,
    );
  });

  it('allows a slug change only while the product is a draft', async () => {
    const { productType, brand } = await setUp();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    const renamed = await updateProduct(
      actorFor(),
      product.id,
      updateProductSchema.parse({ expectedVersion: 0, slug: 'kurta-renamed' }),
    );
    await database.product.update({ where: { id: product.id }, data: { status: 'ACTIVE' } });
    await expect(
      updateProduct(
        actorFor(),
        product.id,
        updateProductSchema.parse({ expectedVersion: renamed.version, slug: 'again' }),
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_SLUG_LOCKED', httpStatus: 409 });
    const sameSlug = await updateProduct(
      actorFor(),
      product.id,
      updateProductSchema.parse({
        expectedVersion: renamed.version,
        slug: 'kurta-renamed',
        name: 'Same slug',
      }),
    );
    expect(sameSlug.name).toBe('Same slug');
  });

  it('treats an archived product as read-only', async () => {
    const { productType, brand } = await setUp();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    await database.product.update({
      where: { id: product.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await expect(
      updateProduct(
        actorFor(),
        product.id,
        updateProductSchema.parse({ expectedVersion: 0, name: 'Changed' }),
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_ARCHIVED', httpStatus: 409 });
  });

  it('answers 404 for an unknown product', async () => {
    await expect(
      updateProduct(
        actorFor(),
        '0195f2a0-0000-7000-8000-000000000999',
        updateProductSchema.parse({ expectedVersion: 0, name: 'Ghost' }),
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND', httpStatus: 404 });
  });
});

describe('listing products', () => {
  async function stockOneVariant(productId: string, sku: string, onHandQuantity: number) {
    const variant = await database.productVariant.create({
      data: {
        productId,
        sku,
        optionSignature: 'size=M',
        optionValues: { size: 'M' },
        mrpPaise: 99_900,
        pricePaise: 79_900,
        weightGrams: 300,
        lengthMm: 300,
        breadthMm: 250,
        heightMm: 30,
      },
    });
    const warehouse = await database.warehouse.upsert({
      where: { code: 'WH-TEST' },
      create: {
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
      update: {},
    });
    await database.inventoryLevel.create({
      data: { variantId: variant.id, warehouseId: warehouse.id, onHandQuantity },
    });
  }

  it('hides archived products by default, filters, searches and pages without gaps or repeats', async () => {
    const { productType, brand } = await setUp();
    const otherBrand = await createTestBrand('other-brand');
    const slugs = ['alpha-kurta', 'beta-kurta', 'gamma-shirt', 'delta-kurta', 'epsilon-kurta'];
    const products = [];
    for (const slug of slugs) {
      products.push(
        await createTestProduct({
          productTypeId: productType.id,
          brandId: slug === 'gamma-shirt' ? otherBrand.id : brand.id,
          slug,
        }),
      );
    }
    const archived = products[3];
    if (archived === undefined) throw new Error('fixture missing');
    await database.product.update({
      where: { id: archived.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });

    const all = await listProducts(supportStaff, listProductsSchema.parse({}));
    expect(all.totalCount).toBe(4);
    expect(all.items.map(({ slug }) => slug)).not.toContain('delta-kurta');
    const onlyArchived = await listProducts(
      supportStaff,
      listProductsSchema.parse({ status: 'ARCHIVED' }),
    );
    expect(onlyArchived.items.map(({ slug }) => slug)).toEqual(['delta-kurta']);
    const search = await listProducts(supportStaff, listProductsSchema.parse({ search: 'SHIRT' }));
    expect(search.items.map(({ slug }) => slug)).toEqual(['gamma-shirt']);
    const byBrand = await listProducts(
      supportStaff,
      listProductsSchema.parse({ brandId: otherBrand.id }),
    );
    expect(byBrand.totalCount).toBe(1);

    for (const sort of ['NEWEST', 'OLDEST', 'NAME'] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listProducts(
          supportStaff,
          listProductsSchema.parse({ sort, limit: 3, ...(cursor === undefined ? {} : { cursor }) }),
        );
        seen.push(...page.items.map(({ slug }) => slug));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      expect(seen, sort).toHaveLength(4);
      expect(new Set(seen).size, sort).toBe(4);
    }
    const byName = await listProducts(supportStaff, listProductsSchema.parse({ sort: 'NAME' }));
    expect(byName.items.map(({ slug }) => slug)).toEqual([
      'alpha-kurta',
      'beta-kurta',
      'epsilon-kurta',
      'gamma-shirt',
    ]);
  });

  it('filters by stock: only active variants with available quantity count as in stock', async () => {
    const { productType, brand } = await setUp();
    const stocked = await createTestProduct({
      productTypeId: productType.id,
      brandId: brand.id,
      slug: 'stocked',
    });
    const empty = await createTestProduct({
      productTypeId: productType.id,
      brandId: brand.id,
      slug: 'empty',
    });
    await createTestProduct({
      productTypeId: productType.id,
      brandId: brand.id,
      slug: 'no-variants',
    });
    await stockOneVariant(stocked.id, 'STOCKED-M', 5);
    await stockOneVariant(empty.id, 'EMPTY-M', 0);
    const inStock = await listProducts(
      supportStaff,
      listProductsSchema.parse({ stock: 'IN_STOCK' }),
    );
    expect(inStock.items.map(({ slug }) => slug)).toEqual(['stocked']);
    const outOfStock = await listProducts(
      supportStaff,
      listProductsSchema.parse({ stock: 'OUT_OF_STOCK' }),
    );
    expect(outOfStock.items.map(({ slug }) => slug).sort()).toEqual(['empty', 'no-variants']);
  });
});
