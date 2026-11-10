import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import {
  createAttributeDefinitionSchema,
  createProductSchema,
  createProductTypeSchema,
  updateAttributeDefinitionSchema,
} from '@/modules/catalogue/catalogue.schema';
import { createProduct } from '@/modules/catalogue/product.service';
import {
  archiveAttributeDefinition,
  archiveProductType,
  createAttributeDefinition,
  createProductType,
  getProductType,
  listAllProductTypes,
  restoreProductType,
  updateAttributeDefinition,
} from '@/modules/catalogue/product-type.service';

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

async function definitionId(productTypeId: string, code: string): Promise<string> {
  const definition = await database.attributeDefinition.findUniqueOrThrow({
    where: { productTypeId_code: { productTypeId, code } },
    select: { id: true },
  });
  return definition.id;
}

function auditCount(action: string): Promise<number> {
  return database.auditLog.count({ where: { action } });
}

async function createVariantRow(
  productId: string,
  sku: string,
  optionValues: Record<string, string>,
) {
  await database.productVariant.create({
    data: {
      productId,
      sku,
      optionValues,
      optionSignature: Object.keys(optionValues)
        .sort()
        .map((code) => `${code}=${optionValues[code] ?? ''}`)
        .join('|'),
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
    },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('permissions', () => {
  it('lets catalogue.read list and view types but not change them', async () => {
    const productType = await createApparelType();
    expect(await listAllProductTypes(supportStaff)).toHaveLength(1);
    expect((await getProductType(supportStaff, productType.id)).attributeDefinitions).toHaveLength(
      5,
    );
    await expect(
      createProductType(
        actorFor(supportStaff),
        createProductTypeSchema.parse({ code: 'shoes', name: 'Shoes' }),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
  });

  it('refuses staff without any catalogue permission', async () => {
    await expect(listAllProductTypes(staffWithoutCatalogue)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});

describe('product types', () => {
  it('creates a type with an audit row naming the staff member, and refuses a duplicate code', async () => {
    const actor = actorFor();
    const productType = await createProductType(
      actor,
      createProductTypeSchema.parse({ code: 'shoes', name: 'Shoes' }),
    );
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.product_type_created' },
      select: { actorType: true, actorId: true, entityId: true, after: true, ipAddress: true },
    });
    expect(audit).toEqual({
      actorType: 'STAFF',
      actorId: actor.staff.staffUserId,
      entityId: productType.id,
      after: { code: 'shoes', name: 'Shoes' },
      ipAddress: '203.0.113.50',
    });
    await expect(
      createProductType(actor, createProductTypeSchema.parse({ code: 'shoes', name: 'Other' })),
    ).rejects.toMatchObject({ code: 'PRODUCT_TYPE_CODE_TAKEN', httpStatus: 409 });
    expect(await auditCount('catalogue.product_type_created')).toBe(1);
  });

  it('refuses to archive a type that still has unarchived products, then archives and restores it', async () => {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    await expect(archiveProductType(actorFor(), productType.id)).rejects.toMatchObject({
      code: 'PRODUCT_TYPE_IN_USE',
      details: { productCount: 1 },
    });
    await database.product.update({
      where: { id: product.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await archiveProductType(actorFor(), productType.id);
    await expect(
      createProduct(
        actorFor(),
        createProductSchema.parse({
          productTypeId: productType.id,
          brandId: brand.id,
          name: 'New kurta',
          attributes: { fabric: 'Silk' },
          taxRateBasisPoints: 500,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_TYPE_ARCHIVED' });
    await restoreProductType(actorFor(), productType.id);
    await expect(restoreProductType(actorFor(), productType.id)).rejects.toMatchObject({
      code: 'PRODUCT_TYPE_NOT_ARCHIVED',
    });
  });

  it('answers 404 for an unknown type', async () => {
    await expect(
      getProductType(supportStaff, '0195f2a0-0000-7000-8000-000000000999'),
    ).rejects.toMatchObject({ code: 'PRODUCT_TYPE_NOT_FOUND', httpStatus: 404 });
  });
});

describe('attribute definitions', () => {
  it('refuses a duplicate code in the same type but allows it in another type', async () => {
    const apparel = await createApparelType();
    const footwear = await createApparelType('footwear');
    await expect(
      createAttributeDefinition(
        actorFor(),
        apparel.id,
        createAttributeDefinitionSchema.parse({
          code: 'fabric',
          label: 'Again',
          dataType: 'TEXT',
          scope: 'PRODUCT',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_CODE_TAKEN', httpStatus: 409 });
    expect((await getProductType(supportStaff, footwear.id)).attributeDefinitions).toHaveLength(5);
  });

  it('refuses a new required attribute while products lack it, and writes nothing', async () => {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    const auditRowsBefore = await database.auditLog.count();
    await expect(
      createAttributeDefinition(
        actorFor(),
        productType.id,
        createAttributeDefinitionSchema.parse({
          code: 'fit',
          label: 'Fit',
          dataType: 'ENUM',
          scope: 'PRODUCT',
          isRequired: true,
          allowedValues: ['Slim'],
        }),
      ),
    ).rejects.toMatchObject({
      code: 'ATTRIBUTE_REQUIRED_BUT_MISSING',
      details: { missingCount: 1 },
    });
    expect(await database.attributeDefinition.count({ where: { code: 'fit' } })).toBe(0);
    expect(await database.auditLog.count()).toBe(auditRowsBefore);
  });

  it('refuses making a variant option required while variants lack it', async () => {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    await createVariantRow(product.id, 'KURTA-M', { size: 'M' });
    await expect(
      updateAttributeDefinition(
        actorFor(),
        await definitionId(productType.id, 'colour'),
        updateAttributeDefinitionSchema.parse({ isRequired: true }),
      ),
    ).rejects.toMatchObject({
      code: 'ATTRIBUTE_REQUIRED_BUT_MISSING',
      details: { missingCount: 1 },
    });
  });

  it('refuses removing allowed values that products still use, and allows removing unused ones', async () => {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    await createTestProduct({
      productTypeId: productType.id,
      brandId: brand.id,
      attributes: { fabric: 'Cotton', occasion: ['Festive'] },
    });
    const fabricId = await definitionId(productType.id, 'fabric');
    await expect(
      updateAttributeDefinition(
        actorFor(),
        fabricId,
        updateAttributeDefinitionSchema.parse({ allowedValues: ['Silk'] }),
      ),
    ).rejects.toMatchObject({
      code: 'ATTRIBUTE_VALUE_IN_USE',
      details: { valuesInUse: ['Cotton'] },
    });
    await expect(
      updateAttributeDefinition(
        actorFor(),
        await definitionId(productType.id, 'occasion'),
        updateAttributeDefinitionSchema.parse({ allowedValues: ['Casual'] }),
      ),
    ).rejects.toMatchObject({
      code: 'ATTRIBUTE_VALUE_IN_USE',
      details: { valuesInUse: ['Festive'] },
    });

    const outboxBefore = await database.searchOutbox.count();
    const updated = await updateAttributeDefinition(
      actorFor(),
      fabricId,
      updateAttributeDefinitionSchema.parse({ allowedValues: ['Cotton', 'Silk'] }),
    );
    expect(updated.allowedValues).toEqual(['Cotton', 'Silk']);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'catalogue.attribute_definition_updated' },
      select: { before: true, after: true },
    });
    expect(audit.before).toMatchObject({ allowedValues: '["Cotton","Silk","Linen"]' });
    expect(audit.after).toMatchObject({ allowedValues: '["Cotton","Silk"]' });
    expect(await database.searchOutbox.count()).toBe(outboxBefore + 1);
  });

  it('refuses a variant option value in use by a variant', async () => {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    await createVariantRow(product.id, 'KURTA-M', { size: 'M' });
    await expect(
      updateAttributeDefinition(
        actorFor(),
        await definitionId(productType.id, 'size'),
        updateAttributeDefinitionSchema.parse({ allowedValues: ['S', 'L'] }),
      ),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_VALUE_IN_USE', details: { valuesInUse: ['M'] } });
  });

  it('refuses allowed values on a text attribute', async () => {
    const productType = await createApparelType();
    await expect(
      updateAttributeDefinition(
        actorFor(),
        await definitionId(productType.id, 'care_instructions'),
        updateAttributeDefinitionSchema.parse({ allowedValues: ['Dry clean'] }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
  });

  it('refuses archiving a variant option in use, archives an unused one, and then treats it as gone', async () => {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    const product = await createTestProduct({ productTypeId: productType.id, brandId: brand.id });
    await createVariantRow(product.id, 'KURTA-M', { size: 'M' });
    await expect(
      archiveAttributeDefinition(actorFor(), await definitionId(productType.id, 'size')),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_IN_USE', details: { variantCount: 1 } });

    const careId = await definitionId(productType.id, 'care_instructions');
    await archiveAttributeDefinition(actorFor(), careId);
    await expect(
      updateAttributeDefinition(
        actorFor(),
        careId,
        updateAttributeDefinitionSchema.parse({ label: 'Care' }),
      ),
    ).rejects.toMatchObject({ code: 'ATTRIBUTE_DEFINITION_ARCHIVED' });
    await expect(
      createTestProduct({
        productTypeId: productType.id,
        brandId: brand.id,
        slug: 'with-care',
        attributes: { fabric: 'Silk', care_instructions: 'Hand wash' },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        fieldErrors: {
          'attributes.care_instructions': ['This product type has no such attribute'],
        },
      },
    });
  });

  it('never lets "make it required" and "create a product without it" both succeed', async () => {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    const careId = await definitionId(productType.id, 'care_instructions');
    const results = await Promise.allSettled([
      updateAttributeDefinition(
        actorFor(),
        careId,
        updateAttributeDefinitionSchema.parse({ isRequired: true }),
      ),
      createTestProduct({ productTypeId: productType.id, brandId: brand.id, slug: 'racing' }),
    ]);
    const [definitionChange, productCreation] = results;
    const bothSucceeded =
      definitionChange.status === 'fulfilled' && productCreation.status === 'fulfilled';
    expect(bothSucceeded).toBe(false);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  });
});
