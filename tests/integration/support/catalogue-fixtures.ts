import { randomUUID } from 'node:crypto';

import { staffUserIdSchema } from '@/lib/ids';
import { createBrand } from '@/modules/catalogue/brand.service';
import type { CatalogueActor } from '@/modules/catalogue/catalogue-audit';
import {
  createAttributeDefinitionSchema,
  createBrandSchema,
  createProductSchema,
  createProductTypeSchema,
} from '@/modules/catalogue/catalogue.schema';
import { createProduct } from '@/modules/catalogue/product.service';
import {
  createAttributeDefinition,
  createProductType,
} from '@/modules/catalogue/product-type.service';
import type { StaffContext } from '@/modules/identity/access-control';
import type { PermissionCode } from '@/modules/identity/permissions';

import { testMetadata } from './identity-fixtures';

export function staffWith(permissionCodes: readonly PermissionCode[]): StaffContext {
  return {
    staffUserId: staffUserIdSchema.parse(randomUUID()),
    sessionId: randomUUID(),
    permissionCodes: new Set(permissionCodes),
  };
}

export const catalogueManager = staffWith(['catalogue.read', 'catalogue.write', 'taxonomy.write']);
export const catalogueWriterWithoutTaxonomy = staffWith(['catalogue.read', 'catalogue.write']);
export const supportStaff = staffWith(['catalogue.read']);
export const staffWithoutCatalogue = staffWith(['orders.read']);

export function actorFor(staff: StaffContext = catalogueManager): CatalogueActor {
  return { staff, metadata: testMetadata('203.0.113.50') };
}

// An apparel type like the seed's: fabric (required enum), occasion (multi-enum), size and colour options.
export async function createApparelType(code = 'apparel') {
  const actor = actorFor();
  const productType = await createProductType(
    actor,
    createProductTypeSchema.parse({ code, name: 'Apparel' }),
  );
  const definitions = [
    {
      code: 'fabric',
      label: 'Fabric',
      dataType: 'ENUM',
      scope: 'PRODUCT',
      isRequired: true,
      allowedValues: ['Cotton', 'Silk', 'Linen'],
    },
    {
      code: 'occasion',
      label: 'Occasion',
      dataType: 'MULTI_ENUM',
      scope: 'PRODUCT',
      allowedValues: ['Casual', 'Festive'],
    },
    { code: 'care_instructions', label: 'Care', dataType: 'TEXT', scope: 'PRODUCT' },
    {
      code: 'size',
      label: 'Size',
      dataType: 'ENUM',
      scope: 'VARIANT_OPTION',
      isRequired: true,
      allowedValues: ['S', 'M', 'L'],
    },
    {
      code: 'colour',
      label: 'Colour',
      dataType: 'ENUM',
      scope: 'VARIANT_OPTION',
      allowedValues: ['White', 'Indigo'],
    },
  ];
  for (const definition of definitions) {
    await createAttributeDefinition(
      actor,
      productType.id,
      createAttributeDefinitionSchema.parse(definition),
    );
  }
  return productType;
}

export async function createTestBrand(slug = 'test-brand') {
  return createBrand(actorFor(), createBrandSchema.parse({ name: `Brand ${slug}`, slug }));
}

export async function createTestProduct(input: {
  productTypeId: string;
  brandId: string;
  slug?: string;
  attributes?: Record<string, unknown>;
}) {
  return createProduct(
    actorFor(),
    createProductSchema.parse({
      productTypeId: input.productTypeId,
      brandId: input.brandId,
      name: `Product ${input.slug ?? 'kurta'}`,
      slug: input.slug ?? 'kurta',
      attributes: input.attributes ?? { fabric: 'Cotton' },
      taxRateBasisPoints: 500,
    }),
  );
}
