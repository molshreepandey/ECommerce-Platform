import { z } from 'zod';

import { productIdSchema } from '@/lib/ids';
import { slugPattern } from '@/modules/catalogue/catalogue.schema';

export const maximumProductsPerBulkChange = 100;

const categoryNameSchema = z.string().trim().min(2, 'Enter a name').max(100);
const categorySlugSchema = z
  .string()
  .trim()
  .max(120)
  .regex(slugPattern, 'Use lower-case letters and numbers joined by single hyphens');
const positionSchema = z.int().min(0).max(10_000);
const categoryIdSchema = z.uuid();

export const createCategorySchema = z.strictObject({
  name: categoryNameSchema,
  slug: categorySlugSchema.optional(),
  parentId: categoryIdSchema.nullable().default(null),
  position: positionSchema.optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .strictObject({
    name: categoryNameSchema.optional(),
    slug: categorySlugSchema.optional(),
    position: positionSchema.optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Change at least one field',
  });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const moveCategorySchema = z.strictObject({
  parentId: categoryIdSchema.nullable(),
  position: positionSchema.optional(),
});
export type MoveCategoryInput = z.infer<typeof moveCategorySchema>;

export const changeCategoryStatusSchema = z.strictObject({ isActive: z.boolean() });
export type ChangeCategoryStatusInput = z.infer<typeof changeCategoryStatusSchema>;

// Tag (categoryId set) or untag (categoryId null) up to 100 products in one all-or-nothing change.
export const tagProductsSchema = z.strictObject({
  productIds: z
    .array(productIdSchema)
    .min(1, 'Choose at least one product')
    .max(maximumProductsPerBulkChange)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each product once' }),
  categoryId: categoryIdSchema.nullable(),
});
export type TagProductsInput = z.infer<typeof tagProductsSchema>;

// D21: every non-archived product on category A moves to leaf category B in one change.
export const maximumProductsPerRecategorise = 2_000;
export const recategoriseProductsSchema = z
  .strictObject({
    fromCategoryId: categoryIdSchema.transform((value) => value.toLowerCase()),
    toCategoryId: categoryIdSchema.transform((value) => value.toLowerCase()),
  })
  .refine((input) => input.fromCategoryId !== input.toCategoryId, {
    message: 'Choose a different target category',
    path: ['toCategoryId'],
  });
export type RecategoriseProductsInput = z.infer<typeof recategoriseProductsSchema>;
