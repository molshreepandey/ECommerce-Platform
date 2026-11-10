import { describe, expect, it } from 'vitest';

import {
  addMediaSchema,
  changeProductStatusSchema,
  createAttributeDefinitionSchema,
  createProductSchema,
  createVariantSchema,
  generateVariantsSchema,
  listProductsSchema,
  reorderMediaSchema,
  updateAttributeDefinitionSchema,
  updateMediaSchema,
  updateProductSchema,
  updateVariantSchema,
} from './catalogue.schema';

const uuid = '0195f2a0-0000-7000-8000-000000000001';
const measurements = {
  mrpPaise: 99_900,
  pricePaise: 79_900,
  weightGrams: 300,
  lengthMm: 300,
  breadthMm: 250,
  heightMm: 30,
};

function fieldsWithErrors(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join('.'));
}

describe('fields that can never change are not accepted by update schemas', () => {
  it.each([
    ['productTypeId', uuid],
    ['status', 'ACTIVE'],
    ['version', 3],
    ['categoryId', uuid],
    ['productGroupId', uuid],
  ])('updateProductSchema refuses %s', (field, value) => {
    expect(updateProductSchema.safeParse({ expectedVersion: 0, [field]: value }).success).toBe(
      false,
    );
  });

  it.each([
    ['sku', 'NEW-SKU'],
    ['optionValues', { size: 'M' }],
    ['status', 'ARCHIVED'],
    ['productId', uuid],
  ])('updateVariantSchema refuses %s', (field, value) => {
    expect(updateVariantSchema.safeParse({ pricePaise: 100, [field]: value }).success).toBe(false);
  });

  it.each([
    ['code', 'new_code'],
    ['dataType', 'TEXT'],
    ['scope', 'PRODUCT'],
    ['productTypeId', uuid],
  ])('updateAttributeDefinitionSchema refuses %s', (field, value) => {
    expect(updateAttributeDefinitionSchema.safeParse({ label: 'x', [field]: value }).success).toBe(
      false,
    );
  });

  it('updateMediaSchema refuses the URL, product and position', () => {
    for (const change of [
      { url: 'https://picsum.photos/x' },
      { productId: uuid },
      { position: 2 },
    ]) {
      expect(updateMediaSchema.safeParse({ altText: 'x', ...change }).success).toBe(false);
    }
  });
});

describe('product schemas', () => {
  it('requires an expected version and at least one change', () => {
    expect(updateProductSchema.safeParse({ name: 'New name' }).success).toBe(false);
    expect(updateProductSchema.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(updateProductSchema.safeParse({ expectedVersion: -1, name: 'New name' }).success).toBe(
      false,
    );
    expect(updateProductSchema.safeParse({ expectedVersion: 0, name: 'New name' }).success).toBe(
      true,
    );
  });

  it.each(['Kurta', 'kurta_1', 'kurta--1', '-kurta', 'kurta-'])('refuses the slug %j', (slug) => {
    const result = createProductSchema.safeParse({
      productTypeId: uuid,
      brandId: uuid,
      name: 'Kurta',
      slug,
      taxRateBasisPoints: 500,
    });
    expect(fieldsWithErrors(result)).toContain('slug');
  });

  it('refuses a tax rate outside 0–100 %', () => {
    for (const taxRateBasisPoints of [-1, 10_001, 5.5]) {
      const result = createProductSchema.safeParse({
        productTypeId: uuid,
        brandId: uuid,
        name: 'Kurta',
        taxRateBasisPoints,
      });
      expect(fieldsWithErrors(result)).toContain('taxRateBasisPoints');
    }
  });

  it('accepts only DRAFT, ACTIVE and ARCHIVED as target statuses', () => {
    expect(
      changeProductStatusSchema.safeParse({ expectedVersion: 0, status: 'DELETED' }).success,
    ).toBe(false);
  });
});

describe('attribute definition schema', () => {
  const base = { code: 'fabric', label: 'Fabric', scope: 'PRODUCT' };

  it('needs allowed values exactly for ENUM and MULTI_ENUM', () => {
    expect(createAttributeDefinitionSchema.safeParse({ ...base, dataType: 'ENUM' }).success).toBe(
      false,
    );
    expect(
      createAttributeDefinitionSchema.safeParse({ ...base, dataType: 'TEXT', allowedValues: ['x'] })
        .success,
    ).toBe(false);
    expect(
      createAttributeDefinitionSchema.safeParse({ ...base, dataType: 'ENUM', allowedValues: [] })
        .success,
    ).toBe(false);
    expect(
      createAttributeDefinitionSchema.safeParse({
        ...base,
        dataType: 'ENUM',
        allowedValues: ['Cotton', 'Cotton'],
      }).success,
    ).toBe(false);
    expect(
      createAttributeDefinitionSchema.safeParse({
        ...base,
        dataType: 'ENUM',
        allowedValues: ['Cotton'],
      }).success,
    ).toBe(true);
  });

  it('allows only ENUM as a variant option', () => {
    const result = createAttributeDefinitionSchema.safeParse({
      ...base,
      scope: 'VARIANT_OPTION',
      dataType: 'MULTI_ENUM',
      allowedValues: ['S'],
    });
    expect(fieldsWithErrors(result)).toContain('dataType');
  });

  it.each(['Fabric', '1fabric', 'fabric-type', 'a'.repeat(41)])('refuses the code %j', (code) => {
    expect(
      createAttributeDefinitionSchema.safeParse({ ...base, code, dataType: 'TEXT' }).success,
    ).toBe(false);
  });
});

describe('variant schemas', () => {
  it('upper-cases the SKU and refuses an invalid one', () => {
    const parsed = createVariantSchema.parse({
      sku: ' app-001-m ',
      optionValues: {},
      ...measurements,
    });
    expect(parsed.sku).toBe('APP-001-M');
    for (const sku of ['APP 001', 'APP--1', 'A'.repeat(65), '']) {
      expect(
        createVariantSchema.safeParse({ sku, optionValues: {}, ...measurements }).success,
      ).toBe(false);
    }
  });

  it('refuses a price above the MRP, a zero price and non-integer paise', () => {
    for (const change of [{ pricePaise: 100_000 }, { pricePaise: 0 }, { mrpPaise: 99_900.5 }]) {
      const result = createVariantSchema.safeParse({
        sku: 'APP-1',
        optionValues: {},
        ...measurements,
        ...change,
      });
      expect(result.success, JSON.stringify(change)).toBe(false);
    }
  });

  it('refuses zero or fractional weights and dimensions', () => {
    for (const change of [{ weightGrams: 0 }, { lengthMm: -5 }, { heightMm: 1.5 }]) {
      expect(
        createVariantSchema.safeParse({
          sku: 'APP-1',
          optionValues: {},
          ...measurements,
          ...change,
        }).success,
      ).toBe(false);
    }
  });

  it('needs at least one option for the generator, and a valid SKU prefix', () => {
    expect(
      generateVariantsSchema.safeParse({ options: {}, skuPrefix: 'APP-1', ...measurements })
        .success,
    ).toBe(false);
    expect(
      generateVariantsSchema.safeParse({
        options: { size: [] },
        skuPrefix: 'APP-1',
        ...measurements,
      }).success,
    ).toBe(false);
    expect(
      generateVariantsSchema.safeParse({
        options: { size: ['S'] },
        skuPrefix: 'app 1',
        ...measurements,
      }).success,
    ).toBe(false);
  });
});

describe('media schemas', () => {
  it('requires meaningful alt text and an https URL', () => {
    for (const altText of ['', '   ', 'x'.repeat(201)]) {
      expect(addMediaSchema.safeParse({ url: 'https://picsum.photos/x', altText }).success).toBe(
        false,
      );
    }
    for (const url of [
      'http://picsum.photos/x',
      'javascript:alert(1)',
      'not a url',
      'ftp://x.test/a',
    ]) {
      expect(addMediaSchema.safeParse({ url, altText: 'Front' }).success, url).toBe(false);
    }
    expect(
      addMediaSchema.safeParse({ url: 'https://picsum.photos/x', altText: ' Front ' }).data
        ?.altText,
    ).toBe('Front');
  });

  it('refuses duplicate ids when reordering', () => {
    expect(reorderMediaSchema.safeParse({ mediaIds: [uuid, uuid] }).success).toBe(false);
  });
});

describe('list products schema', () => {
  it('defaults to the newest 25 and caps the page size at 100', () => {
    expect(listProductsSchema.parse({})).toMatchObject({ sort: 'NEWEST', limit: 25 });
    expect(listProductsSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listProductsSchema.parse({ limit: '10' }).limit).toBe(10);
  });
});
