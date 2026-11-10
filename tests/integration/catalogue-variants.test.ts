import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import {
  changeVariantStatusSchema,
  createVariantSchema,
  generateVariantsSchema,
  updateAttributeDefinitionSchema,
  updateVariantSchema,
} from '@/modules/catalogue/catalogue.schema';
import { updateAttributeDefinition } from '@/modules/catalogue/product-type.service';
import {
  changeVariantStatus,
  createVariant,
  generateVariants,
  updateVariant,
} from '@/modules/catalogue/variant.service';

import {
  actorFor,
  createApparelType,
  createTestBrand,
  createTestProduct,
  supportStaff,
} from './support/catalogue-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const measurements = {
  mrpPaise: 99_900,
  pricePaise: 79_900,
  weightGrams: 300,
  lengthMm: 300,
  breadthMm: 250,
  heightMm: 30,
};

async function setUp() {
  const productType = await createApparelType();
  const brand = await createTestBrand();
  const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
  return { productType, brand, product };
}

function variantInput(sku: string, optionValues: Record<string, unknown>) {
  return createVariantSchema.parse({ sku, optionValues, ...measurements });
}

async function productVersion(productId: string): Promise<number> {
  const product = await database.product.findUniqueOrThrow({
    where: { id: productId },
    select: { version: true },
  });
  return product.version;
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('creating variants', () => {
  it('validates options, normalises the SKU, bumps the product version and audits', async () => {
    const { product } = await setUp();
    const { variant, productVersion: newVersion } = await createVariant(
      actorFor(),
      product.id,
      variantInput(' kurta-m-indigo ', { size: 'M', colour: 'Indigo' }),
    );
    expect(variant).toMatchObject({
      sku: 'KURTA-M-INDIGO',
      optionValues: { size: 'M', colour: 'Indigo' },
      optionSignature: 'colour=Indigo|size=M',
      status: 'ACTIVE',
    });
    expect(newVersion).toBe(1);
    expect(await productVersion(product.id)).toBe(1);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.variant_created', entityId: variant.id },
      select: { after: true },
    });
    expect(audit.after).toMatchObject({
      sku: 'KURTA-M-INDIGO',
      optionValues: '{"size":"M","colour":"Indigo"}',
    });
  });

  it.each([
    ['a missing required option', { colour: 'Indigo' }, 'optionValues.size'],
    ['a value that is not allowed', { size: 'XXL' }, 'optionValues.size'],
    ['an option the type does not have', { size: 'M', sleeve: 'Long' }, 'optionValues.sleeve'],
    ['a product attribute used as an option', { size: 'M', fabric: 'Silk' }, 'optionValues.fabric'],
  ])('refuses %s with 400 and writes nothing', async (_label, optionValues, field) => {
    const { product } = await setUp();
    const rejection = await createVariant(
      actorFor(),
      product.id,
      variantInput('KURTA-X', optionValues),
    ).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
    expect(rejection).toHaveProperty(['details', 'fieldErrors', field]);
    expect(await database.productVariant.count()).toBe(0);
    expect(await productVersion(product.id)).toBe(0);
  });

  it('refuses a SKU used by any product, and a combination the product already has (even archived)', async () => {
    const { productType, brand, product } = await setUp();
    const other = await createTestProduct({
      productTypeId: productType.id,
      brandId: brand.id,
      slug: 'other',
    });
    const { variant } = await createVariant(
      actorFor(),
      product.id,
      variantInput('KURTA-M', { size: 'M' }),
    );
    await expect(
      createVariant(actorFor(), other.id, variantInput('KURTA-M', { size: 'L' })),
    ).rejects.toMatchObject({ code: 'SKU_TAKEN', httpStatus: 409, details: { sku: 'KURTA-M' } });
    await changeVariantStatus(
      actorFor(),
      variant.id,
      changeVariantStatusSchema.parse({ status: 'ARCHIVED' }),
    );
    await expect(
      createVariant(actorFor(), product.id, variantInput('KURTA-M-NEW', { size: 'M' })),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_VARIANT_COMBINATION',
      httpStatus: 409,
      details: { optionSignature: 'size=M' },
    });
  });

  it('refuses variants on an archived product and needs catalogue.write', async () => {
    const { product } = await setUp();
    await expect(
      createVariant(actorFor(supportStaff), product.id, variantInput('KURTA-M', { size: 'M' })),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await database.product.update({
      where: { id: product.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await expect(
      createVariant(actorFor(), product.id, variantInput('KURTA-M', { size: 'M' })),
    ).rejects.toMatchObject({ code: 'PRODUCT_ARCHIVED', httpStatus: 409 });
  });
});

describe('updating variants', () => {
  it('checks price against the stored MRP, keeps SKU and options, and refuses archived variants', async () => {
    const { product } = await setUp();
    const { variant } = await createVariant(
      actorFor(),
      product.id,
      variantInput('KURTA-M', { size: 'M' }),
    );
    await expect(
      updateVariant(actorFor(), variant.id, updateVariantSchema.parse({ pricePaise: 100_000 })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fieldErrors: { pricePaise: ['The price cannot be higher than the MRP'] } },
    });
    const { variant: updated } = await updateVariant(
      actorFor(),
      variant.id,
      updateVariantSchema.parse({ mrpPaise: 120_000, pricePaise: 110_000, weightGrams: 350 }),
    );
    expect(updated).toMatchObject({
      sku: 'KURTA-M',
      optionSignature: 'size=M',
      pricePaise: 110_000,
      weightGrams: 350,
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.variant_updated' },
      select: { before: true, after: true },
    });
    expect(audit.before).toMatchObject({ pricePaise: 79_900 });
    expect(audit.after).toMatchObject({ pricePaise: 110_000 });

    await changeVariantStatus(
      actorFor(),
      variant.id,
      changeVariantStatusSchema.parse({ status: 'ARCHIVED' }),
    );
    await expect(
      updateVariant(actorFor(), variant.id, updateVariantSchema.parse({ weightGrams: 400 })),
    ).rejects.toMatchObject({ code: 'VARIANT_ARCHIVED', httpStatus: 409 });
  });

  it('answers 404 for an unknown variant', async () => {
    await expect(
      updateVariant(
        actorFor(),
        '0195f2a0-0000-7000-8000-000000000999',
        updateVariantSchema.parse({ weightGrams: 400 }),
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND', httpStatus: 404 });
  });
});

describe('generating variants', () => {
  const generatorInput = (options: Record<string, string[]>, skuPrefix = 'KURTA') =>
    generateVariantsSchema.parse({ options, skuPrefix, ...measurements });

  it('creates every combination once; running it again creates nothing', async () => {
    const { product } = await setUp();
    const first = await generateVariants(
      actorFor(),
      product.id,
      generatorInput({ size: ['S', 'M', 'L'], colour: ['White', 'Indigo'] }),
    );
    expect(first.created.map(({ sku }) => sku).sort()).toEqual([
      'KURTA-INDIGO-L',
      'KURTA-INDIGO-M',
      'KURTA-INDIGO-S',
      'KURTA-WHITE-L',
      'KURTA-WHITE-M',
      'KURTA-WHITE-S',
    ]);
    expect(first.productVersion).toBe(1);
    const second = await generateVariants(
      actorFor(),
      product.id,
      generatorInput({ size: ['S', 'M', 'L'], colour: ['White', 'Indigo'] }),
    );
    expect(second).toMatchObject({ created: [], productVersion: 1 });
    expect(second.skippedOptionSignatures).toHaveLength(6);
    expect(
      await database.auditLog.count({ where: { action: 'catalogue.variants_generated' } }),
    ).toBe(1);
  });

  it('adds only the new combinations when values are added later', async () => {
    const { product } = await setUp();
    await generateVariants(actorFor(), product.id, generatorInput({ size: ['S', 'M'] }));
    const more = await generateVariants(
      actorFor(),
      product.id,
      generatorInput({ size: ['S', 'M', 'L'] }),
    );
    expect(more.created.map(({ sku }) => sku)).toEqual(['KURTA-L']);
    expect(more.skippedOptionSignatures).toEqual(['size=S', 'size=M']);
  });

  it('is all-or-nothing when a generated SKU is already used by another product', async () => {
    const { productType, brand, product } = await setUp();
    const other = await createTestProduct({
      productTypeId: productType.id,
      brandId: brand.id,
      slug: 'other',
    });
    await createVariant(actorFor(), other.id, variantInput('KURTA-M', { size: 'M' }));
    await expect(
      generateVariants(actorFor(), product.id, generatorInput({ size: ['S', 'M', 'L'] })),
    ).rejects.toMatchObject({ code: 'SKU_TAKEN', httpStatus: 409, details: null });
    expect(await database.productVariant.count({ where: { productId: product.id } })).toBe(0);
    expect(await productVersion(product.id)).toBe(0);
  });

  it('refuses unknown options, disallowed values, missing required options and too many combinations', async () => {
    const { product } = await setUp();
    for (const options of [
      { size: ['M'], sleeve: ['Long'] },
      { size: ['XXL'] },
      { colour: ['White'] },
    ]) {
      await expect(
        generateVariants(actorFor(), product.id, generatorInput(options)),
        JSON.stringify(options),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    const manySizes = Array.from({ length: 101 }, (_, index) => `S${index}`);
    await expect(
      generateVariants(actorFor(), product.id, generatorInput({ size: manySizes })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        fieldErrors: { options: ['Choose fewer values: at most 100 variants at a time'] },
      },
    });
    expect(await database.productVariant.count()).toBe(0);
  });

  it('never duplicates a combination when two generators run at the same time', async () => {
    const { product } = await setUp();
    const input = generatorInput({ size: ['S', 'M', 'L'], colour: ['White', 'Indigo'] });
    const results = await Promise.allSettled([
      generateVariants(actorFor(), product.id, input),
      generateVariants(actorFor(), product.id, input),
    ]);
    expect(results.every(({ status }) => status === 'fulfilled')).toBe(true);
    expect(await database.productVariant.count({ where: { productId: product.id } })).toBe(6);
  });
});

describe('variant status', () => {
  it('refuses to archive or deactivate the last active variant of an ACTIVE product (409)', async () => {
    const { product } = await setUp();
    const { variant } = await createVariant(
      actorFor(),
      product.id,
      variantInput('KURTA-M', { size: 'M' }),
    );
    await database.product.update({ where: { id: product.id }, data: { status: 'ACTIVE' } });
    for (const status of ['ARCHIVED', 'INACTIVE'] as const) {
      await expect(
        changeVariantStatus(actorFor(), variant.id, changeVariantStatusSchema.parse({ status })),
      ).rejects.toMatchObject({ code: 'LAST_ACTIVE_VARIANT', httpStatus: 409 });
    }
    expect(
      (await database.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).status,
    ).toBe('ACTIVE');

    await database.product.update({ where: { id: product.id }, data: { status: 'DRAFT' } });
    const archived = await changeVariantStatus(
      actorFor(),
      variant.id,
      changeVariantStatusSchema.parse({ status: 'ARCHIVED' }),
    );
    expect(archived.variant.status).toBe('ARCHIVED');
  });

  it('allows archiving one of two active variants of an ACTIVE product, and refuses a no-op change', async () => {
    const { product } = await setUp();
    const { variant: first } = await createVariant(
      actorFor(),
      product.id,
      variantInput('KURTA-M', { size: 'M' }),
    );
    await createVariant(actorFor(), product.id, variantInput('KURTA-L', { size: 'L' }));
    await database.product.update({ where: { id: product.id }, data: { status: 'ACTIVE' } });
    await changeVariantStatus(
      actorFor(),
      first.id,
      changeVariantStatusSchema.parse({ status: 'ARCHIVED' }),
    );
    await expect(
      changeVariantStatus(
        actorFor(),
        first.id,
        changeVariantStatusSchema.parse({ status: 'ARCHIVED' }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION', httpStatus: 409 });
  });

  it('restores an archived variant, unless its options are no longer allowed (422)', async () => {
    const { productType, product } = await setUp();
    const { variant: medium } = await createVariant(
      actorFor(),
      product.id,
      variantInput('KURTA-M', { size: 'M' }),
    );
    const { variant: large } = await createVariant(
      actorFor(),
      product.id,
      variantInput('KURTA-L', { size: 'L' }),
    );
    await changeVariantStatus(
      actorFor(),
      medium.id,
      changeVariantStatusSchema.parse({ status: 'ARCHIVED' }),
    );
    const restored = await changeVariantStatus(
      actorFor(),
      medium.id,
      changeVariantStatusSchema.parse({ status: 'ACTIVE' }),
    );
    expect(restored.variant.status).toBe('ACTIVE');

    await changeVariantStatus(
      actorFor(),
      large.id,
      changeVariantStatusSchema.parse({ status: 'ARCHIVED' }),
    );
    const sizeDefinition = await database.attributeDefinition.findUniqueOrThrow({
      where: { productTypeId_code: { productTypeId: productType.id, code: 'size' } },
    });
    // Only the archived variant uses "L", so the value may be removed.
    await updateAttributeDefinition(
      actorFor(),
      sizeDefinition.id,
      updateAttributeDefinitionSchema.parse({ allowedValues: ['S', 'M'] }),
    );
    await expect(
      changeVariantStatus(
        actorFor(),
        large.id,
        changeVariantStatusSchema.parse({ status: 'ACTIVE' }),
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_OPTIONS_OUTDATED', httpStatus: 422 });
  });
});
