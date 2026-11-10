import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getDatabase } from '@/lib/db';

import { currentDatabaseName, truncateAllTestTables } from './support/test-database';

const database = getDatabase();

const variantDimensions = {
  mrpPaise: 99_900,
  pricePaise: 79_900,
  weightGrams: 300,
  lengthMm: 300,
  breadthMm: 250,
  heightMm: 30,
};

async function createProductType(code = 'apparel') {
  return database.productType.create({ data: { code, name: 'Apparel' }, select: { id: true } });
}

async function createProductWithVariant(input: {
  productTypeId: string;
  brandId: string;
  slug: string;
  sku: string;
}) {
  const product = await database.product.create({
    data: {
      productTypeId: input.productTypeId,
      brandId: input.brandId,
      name: `Product ${input.slug}`,
      slug: input.slug,
      taxRateBasisPoints: 500,
    },
    select: { id: true, version: true },
  });
  const variant = await database.productVariant.create({
    data: {
      productId: product.id,
      sku: input.sku,
      optionSignature: 'size=M',
      ...variantDimensions,
    },
    select: { id: true },
  });
  return { productId: product.id, productVersion: product.version, variantId: variant.id };
}

async function createCatalogue() {
  const productType = await createProductType();
  const brand = await database.brand.create({
    data: { name: 'Test Brand', slug: 'test-brand' },
    select: { id: true },
  });
  const kurta = await createProductWithVariant({
    productTypeId: productType.id,
    brandId: brand.id,
    slug: 'test-kurta',
    sku: 'TEST-KURTA-M',
  });
  const shirt = await createProductWithVariant({
    productTypeId: productType.id,
    brandId: brand.id,
    slug: 'test-shirt',
    sku: 'TEST-SHIRT-M',
  });
  return { productTypeId: productType.id, brandId: brand.id, kurta, shirt };
}

function attributeDefinition(
  productTypeId: string,
  overrides: Partial<{
    code: string;
    dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM' | 'MULTI_ENUM';
    scope: 'PRODUCT' | 'VARIANT_OPTION';
    allowedValues: string[] | string;
  }>,
) {
  return database.attributeDefinition.create({
    data: {
      productTypeId,
      code: overrides.code ?? 'fabric',
      label: 'Label',
      dataType: overrides.dataType ?? 'ENUM',
      scope: overrides.scope ?? 'PRODUCT',
      ...(overrides.allowedValues === undefined ? {} : { allowedValues: overrides.allowedValues }),
    },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('catalogue integrity migration (20261110093000_catalogue_integrity)', () => {
  it('is recorded as applied, with its three indexes and the composite image foreign key', async () => {
    expect(await currentDatabaseName()).toBe('ecommerce_test');
    const migrations = z
      .array(z.object({ migration_name: z.string() }))
      .parse(
        await database.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
      );
    expect(migrations.map(({ migration_name }) => migration_name)).toContain(
      '20261110093000_catalogue_integrity',
    );
    const indexes = z
      .array(z.object({ indexname: z.string() }))
      .parse(
        await database.$queryRaw`SELECT indexname FROM pg_indexes WHERE indexname IN ('products_name_id_idx', 'product_variants_product_id_id_key', 'product_variants_option_values_path_idx') ORDER BY indexname`,
      );
    expect(indexes.map(({ indexname }) => indexname)).toEqual([
      'product_variants_option_values_path_idx',
      'product_variants_product_id_id_key',
      'products_name_id_idx',
    ]);
    const foreignKeys = z
      .array(z.object({ definition: z.string() }))
      .parse(
        await database.$queryRaw`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'product_media'::regclass AND contype = 'f' AND conname LIKE '%variant%'`,
      );
    expect(foreignKeys).toEqual([
      {
        definition:
          'FOREIGN KEY (product_id, variant_id) REFERENCES product_variants(product_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT',
      },
    ]);
  });
});

describe('products', () => {
  it('starts every product at version 0 and refuses a negative version', async () => {
    const { kurta } = await createCatalogue();
    expect(kurta.productVersion).toBe(0);
    await expect(
      database.product.update({ where: { id: kurta.productId }, data: { version: -1 } }),
    ).rejects.toThrow(/products_version_check/);
  });

  it('requires archived_at exactly when the status is ARCHIVED', async () => {
    const { kurta } = await createCatalogue();
    await expect(
      database.product.update({ where: { id: kurta.productId }, data: { status: 'ARCHIVED' } }),
    ).rejects.toThrow(/products_archived_at_check/);
    await expect(
      database.product.update({ where: { id: kurta.productId }, data: { archivedAt: new Date() } }),
    ).rejects.toThrow(/products_archived_at_check/);
    await database.product.update({
      where: { id: kurta.productId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
  });

  it.each(['Test-Kurta', 'test kurta', 'test--kurta', '-test-kurta', 'test_kurta'])(
    'refuses the product slug %j',
    async (slug) => {
      const { kurta } = await createCatalogue();
      await expect(
        database.product.update({ where: { id: kurta.productId }, data: { slug } }),
      ).rejects.toThrow(/products_slug_format_check/);
    },
  );

  it('refuses a brand slug that is not lower-case words joined by hyphens', async () => {
    await expect(
      database.brand.create({ data: { name: 'Bad Brand', slug: 'Bad_Brand' } }),
    ).rejects.toThrow(/brands_slug_format_check/);
  });
});

describe('product types and attribute definitions', () => {
  it.each(['Apparel', '1apparel', 'apparel-wear', ''])('refuses the type code %j', async (code) => {
    await expect(createProductType(code)).rejects.toThrow(/product_types_code_format_check/);
  });

  it('refuses an attribute code that is not lower snake case', async () => {
    const { id } = await createProductType();
    await expect(
      attributeDefinition(id, { code: 'Fabric', allowedValues: ['Cotton'] }),
    ).rejects.toThrow(/attribute_definitions_code_format_check/);
  });

  it('requires a non-empty list of allowed values for ENUM and MULTI_ENUM, and none for other types', async () => {
    const { id } = await createProductType();
    await expect(attributeDefinition(id, { dataType: 'ENUM' })).rejects.toThrow(
      /attribute_definitions_allowed_values_check/,
    );
    await expect(
      attributeDefinition(id, { dataType: 'MULTI_ENUM', allowedValues: [] }),
    ).rejects.toThrow(/attribute_definitions_allowed_values_check/);
    await expect(
      attributeDefinition(id, { dataType: 'ENUM', allowedValues: 'Cotton' }),
    ).rejects.toThrow(/attribute_definitions_allowed_values_check/);
    await expect(
      attributeDefinition(id, { code: 'care', dataType: 'TEXT', allowedValues: ['Hand wash'] }),
    ).rejects.toThrow(/attribute_definitions_allowed_values_check/);
    await attributeDefinition(id, { dataType: 'MULTI_ENUM', allowedValues: ['Cotton', 'Silk'] });
    await attributeDefinition(id, { code: 'care', dataType: 'TEXT' });
  });

  it('allows only ENUM attributes as variant options', async () => {
    const { id } = await createProductType();
    await expect(
      attributeDefinition(id, {
        code: 'size',
        dataType: 'MULTI_ENUM',
        scope: 'VARIANT_OPTION',
        allowedValues: ['S', 'M'],
      }),
    ).rejects.toThrow(/attribute_definitions_variant_option_enum_check/);
    await attributeDefinition(id, {
      code: 'size',
      dataType: 'ENUM',
      scope: 'VARIANT_OPTION',
      allowedValues: ['S', 'M'],
    });
  });
});

describe('variants', () => {
  it.each(['test-kurta-l', 'TEST KURTA L', 'TEST--KURTA', 'TEST-KURTA-', `A${'B'.repeat(64)}`])(
    'refuses the SKU %j',
    async (sku) => {
      const { kurta } = await createCatalogue();
      await expect(
        database.productVariant.update({ where: { id: kurta.variantId }, data: { sku } }),
      ).rejects.toThrow(/product_variants_sku_format_check/);
    },
  );

  it('accepts an upper-case SKU of up to 64 characters', async () => {
    const { kurta } = await createCatalogue();
    await database.productVariant.update({
      where: { id: kurta.variantId },
      data: { sku: `A${'B'.repeat(63)}` },
    });
  });
});

describe('product images', () => {
  it('refuses a negative position and blank alt text', async () => {
    const { kurta } = await createCatalogue();
    const image = { productId: kurta.productId, url: 'https://picsum.photos/seed/a/600/800' };
    await expect(
      database.productMedia.create({ data: { ...image, altText: 'Front view', position: -1 } }),
    ).rejects.toThrow(/product_media_position_check/);
    await expect(
      database.productMedia.create({ data: { ...image, altText: '   ' } }),
    ).rejects.toThrow(/product_media_alt_text_check/);
  });

  it('accepts product-level images and images of the product’s own variants', async () => {
    const { kurta } = await createCatalogue();
    const url = 'https://picsum.photos/seed/a/600/800';
    await database.productMedia.create({
      data: { productId: kurta.productId, url, altText: 'Front view' },
    });
    await database.productMedia.create({
      data: {
        productId: kurta.productId,
        variantId: kurta.variantId,
        url,
        altText: 'Size M',
        position: 1,
      },
    });
    expect(await database.productMedia.count()).toBe(2);
  });

  it('refuses an image that points at another product’s variant', async () => {
    const { kurta, shirt } = await createCatalogue();
    await expect(
      database.productMedia.create({
        data: {
          productId: kurta.productId,
          variantId: shirt.variantId,
          url: 'https://picsum.photos/seed/a/600/800',
          altText: 'Wrong variant',
        },
      }),
    ).rejects.toThrow(/product_media_product_id_variant_id_fkey/);
  });

  it('refuses to delete a variant, or move it to another product, while an image refers to it', async () => {
    const { kurta, shirt } = await createCatalogue();
    await database.productMedia.create({
      data: {
        productId: kurta.productId,
        variantId: kurta.variantId,
        url: 'https://picsum.photos/seed/a/600/800',
        altText: 'Size M',
      },
    });
    await expect(
      database.productVariant.delete({ where: { id: kurta.variantId } }),
    ).rejects.toThrow(/product_media_product_id_variant_id_fkey/);
    await expect(
      database.productVariant.update({
        where: { id: kurta.variantId },
        data: { productId: shirt.productId, optionSignature: 'size=L' },
      }),
    ).rejects.toThrow(/product_media_product_id_variant_id_fkey/);
  });
});
