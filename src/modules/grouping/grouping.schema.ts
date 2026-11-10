import { z } from 'zod';

import { productIdSchema } from '@/lib/ids';

import { maximumGroupMembers } from './group-rules';

const groupNameSchema = z.string().trim().min(2, 'Enter a name').max(100);
const uniqueIds = { message: 'Each product once' };

export const createProductGroupSchema = z.strictObject({ name: groupNameSchema });
export type CreateProductGroupInput = z.infer<typeof createProductGroupSchema>;

export const renameProductGroupSchema = z.strictObject({ name: groupNameSchema });
export type RenameProductGroupInput = z.infer<typeof renameProductGroupSchema>;

export const listProductGroupsSchema = z.strictObject({
  search: z.string().trim().min(1).max(100).optional(),
});
export type ListProductGroupsInput = z.infer<typeof listProductGroupsSchema>;

export const addGroupMembersSchema = z.strictObject({
  productIds: z
    .array(productIdSchema)
    .min(1, 'Choose at least one product')
    .max(maximumGroupMembers)
    .refine((ids) => new Set(ids).size === ids.length, uniqueIds),
});
export type AddGroupMembersInput = z.infer<typeof addGroupMembersSchema>;

// The full member list in display order, with each product's swatch label (for example "Indigo").
export const setGroupMembersSchema = z.strictObject({
  members: z
    .array(
      z.strictObject({
        productId: productIdSchema,
        swatchLabel: z.string().trim().min(1).max(40).nullable(),
      }),
    )
    .min(1)
    .max(maximumGroupMembers)
    .refine(
      (members) => new Set(members.map(({ productId }) => productId)).size === members.length,
      uniqueIds,
    ),
});
export type SetGroupMembersInput = z.infer<typeof setGroupMembersSchema>;
