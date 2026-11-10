import { z } from 'zod';

import {
  brandIdSchema,
  productMediaIdSchema,
  productTypeIdSchema,
  variantIdSchema,
} from '@/lib/ids';

// The same patterns are CHECK constraints in the database (TD-016), so bad input fails here with a 400.
export const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const codePattern = /^[a-z][a-z0-9_]{0,39}$/;
export const skuPattern = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export const maximumImagesPerProduct = 20;
export const maximumGeneratedVariants = 100;
export const maximumAllowedValues = 200;

const slugSchema = z
  .string()
  .trim()
  .max(120)
  .regex(slugPattern, 'Use lower-case letters and numbers joined by single hyphens');
const codeSchema = z
  .string()
  .trim()
  .regex(
    codePattern,
    'Start with a letter; use lower-case letters, numbers and underscores (max 40)',
  );
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(64, 'Use at most 64 characters')
  .regex(skuPattern, 'Use letters and numbers joined by single hyphens');
const displayNameSchema = z.string().trim().min(2, 'Enter a name').max(200);
const descriptionSchema = z.string().trim().max(5000);
const httpsUrlSchema = z.url({ protocol: /^https$/, error: 'Enter an https:// URL' }).max(2048);
const pricePaiseSchema = z.int().positive().max(1_000_000_000);
const physicalSizeSchema = z.int().positive().max(1_000_000);
export const expectedVersionSchema = z.int().min(0);

function hasAnyField(input: Record<string, unknown>): boolean {
  return Object.values(input).some((value) => value !== undefined);
}
const changeAtLeastOneField = { message: 'Change at least one field' };

const allowedValuesSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1, 'Add at least one allowed value')
  .max(maximumAllowedValues)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Allowed values must be unique',
  });

export const createProductTypeSchema = z.strictObject({
  code: codeSchema,
  name: displayNameSchema,
  description: descriptionSchema.optional(),
});
export type CreateProductTypeInput = z.infer<typeof createProductTypeSchema>;

export const updateProductTypeSchema = z
  .strictObject({ name: displayNameSchema.optional(), description: descriptionSchema.optional() })
  .refine(hasAnyField, changeAtLeastOneField);
export type UpdateProductTypeInput = z.infer<typeof updateProductTypeSchema>;

const choiceDataTypes = new Set(['ENUM', 'MULTI_ENUM']);

export const createAttributeDefinitionSchema = z
  .strictObject({
    code: codeSchema,
    label: z.string().trim().min(1, 'Enter a label').max(100),
    dataType: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'ENUM', 'MULTI_ENUM']),
    scope: z.enum(['PRODUCT', 'VARIANT_OPTION']),
    isRequired: z.boolean().default(false),
    isFilterable: z.boolean().default(false),
    isSearchable: z.boolean().default(false),
    allowedValues: allowedValuesSchema.optional(),
    displayOrder: z.int().min(0).max(1000).default(0),
  })
  .superRefine((input, context) => {
    const isChoice = choiceDataTypes.has(input.dataType);
    if (isChoice && input.allowedValues === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: 'Choice attributes need allowed values',
      });
    }
    if (!isChoice && input.allowedValues !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['allowedValues'],
        message: 'Only choice attributes have allowed values',
      });
    }
    if (input.scope === 'VARIANT_OPTION' && input.dataType !== 'ENUM') {
      context.addIssue({
        code: 'custom',
        path: ['dataType'],
        message: 'Variant options must be single-choice (ENUM)',
      });
    }
  });
export type CreateAttributeDefinitionInput = z.infer<typeof createAttributeDefinitionSchema>;

export const updateAttributeDefinitionSchema = z
  .strictObject({
    label: z.string().trim().min(1).max(100).optional(),
    isRequired: z.boolean().optional(),
    isFilterable: z.boolean().optional(),
    isSearchable: z.boolean().optional(),
    allowedValues: allowedValuesSchema.optional(),
    displayOrder: z.int().min(0).max(1000).optional(),
  })
  .refine(hasAnyField, changeAtLeastOneField);
export type UpdateAttributeDefinitionInput = z.infer<typeof updateAttributeDefinitionSchema>;

export const createBrandSchema = z.strictObject({
  name: displayNameSchema,
  slug: slugSchema.optional(),
  logoUrl: httpsUrlSchema.optional(),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    slug: slugSchema.optional(),
    logoUrl: httpsUrlSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, changeAtLeastOneField);
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

const attributesInputSchema = z.record(z.string(), z.unknown());

export const createProductSchema = z.strictObject({
  productTypeId: productTypeIdSchema,
  brandId: brandIdSchema,
  name: displayNameSchema,
  slug: slugSchema.optional(),
  description: descriptionSchema.default(''),
  attributes: attributesInputSchema.default({}),
  taxRateBasisPoints: z.int().min(0).max(10_000),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

// The product type, status, category, group and version are not editable here (TD-016).
export const updateProductSchema = z
  .strictObject({
    expectedVersion: expectedVersionSchema,
    name: displayNameSchema.optional(),
    slug: slugSchema.optional(),
    description: descriptionSchema.optional(),
    brandId: brandIdSchema.optional(),
    attributes: attributesInputSchema.optional(),
    taxRateBasisPoints: z.int().min(0).max(10_000).optional(),
  })
  .refine((input) => hasAnyField({ ...input, expectedVersion: undefined }), changeAtLeastOneField);
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const changeProductStatusSchema = z.strictObject({
  expectedVersion: expectedVersionSchema,
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
});
export type ChangeProductStatusInput = z.infer<typeof changeProductStatusSchema>;

const variantMeasurements = {
  mrpPaise: pricePaiseSchema,
  pricePaise: pricePaiseSchema,
  weightGrams: physicalSizeSchema,
  lengthMm: physicalSizeSchema,
  breadthMm: physicalSizeSchema,
  heightMm: physicalSizeSchema,
};

const priceNotAboveMrp = {
  path: ['pricePaise'],
  message: 'The price cannot be higher than the MRP',
};

export const createVariantSchema = z
  .strictObject({
    sku: skuSchema,
    optionValues: attributesInputSchema,
    ...variantMeasurements,
  })
  .refine((input) => input.pricePaise <= input.mrpPaise, priceNotAboveMrp);
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

// SKU and option values are fixed after creation (TD-016); status has its own operation.
export const updateVariantSchema = z
  .strictObject({
    mrpPaise: pricePaiseSchema.optional(),
    pricePaise: pricePaiseSchema.optional(),
    weightGrams: physicalSizeSchema.optional(),
    lengthMm: physicalSizeSchema.optional(),
    breadthMm: physicalSizeSchema.optional(),
    heightMm: physicalSizeSchema.optional(),
  })
  .refine(hasAnyField, changeAtLeastOneField);
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const changeVariantStatusSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
});
export type ChangeVariantStatusInput = z.infer<typeof changeVariantStatusSchema>;

export const generateVariantsSchema = z
  .strictObject({
    options: z
      .record(z.string(), z.array(z.string().trim().min(1)).min(1, 'Choose at least one value'))
      .refine((options) => Object.keys(options).length > 0, {
        message: 'Choose at least one option',
      }),
    skuPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .regex(skuPattern, 'Use letters and numbers joined by single hyphens'),
    ...variantMeasurements,
  })
  .refine((input) => input.pricePaise <= input.mrpPaise, priceNotAboveMrp);
export type GenerateVariantsInput = z.infer<typeof generateVariantsSchema>;

export const addMediaSchema = z.strictObject({
  url: httpsUrlSchema,
  altText: z.string().trim().min(1, 'Describe the image for screen readers').max(200),
  variantId: variantIdSchema.nullable().optional(),
});
export type AddMediaInput = z.infer<typeof addMediaSchema>;

export const updateMediaSchema = z
  .strictObject({
    altText: z.string().trim().min(1, 'Describe the image for screen readers').max(200).optional(),
    variantId: variantIdSchema.nullable().optional(),
  })
  .refine(hasAnyField, changeAtLeastOneField);
export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;

export const reorderMediaSchema = z.strictObject({
  mediaIds: z
    .array(productMediaIdSchema)
    .min(1)
    .max(maximumImagesPerProduct)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each image once' }),
});
export type ReorderMediaInput = z.infer<typeof reorderMediaSchema>;

export const listProductsSchema = z.strictObject({
  search: z.string().trim().min(1).max(100).optional(),
  productTypeId: productTypeIdSchema.optional(),
  brandId: brandIdSchema.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  categoryId: z.uuid().optional(),
  taggingStatus: z.enum(['UNTAGGED', 'TAGGED']).optional(),
  productGroupId: z.uuid().optional(),
  stock: z.enum(['IN_STOCK', 'OUT_OF_STOCK']).optional(),
  sort: z.enum(['NEWEST', 'OLDEST', 'NAME']).default('NEWEST'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
});
export type ListProductsInput = z.infer<typeof listProductsSchema>;
