import { z } from 'zod';

import { emailSchema, fullNameSchema } from './identity.schema';

const roleCodesSchema = z
  .array(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z_]{2,40}$/, 'Choose a role'),
  )
  .min(1, 'Choose at least one role')
  .max(10)
  .refine((codes) => new Set(codes).size === codes.length, 'Each role once')
  .transform((codes) => [...codes].sort());

// D3. Staff passwords are longer than customer ones (admin access); the hash is Argon2id like every
// other password, and the value is never logged or audited.
export const createStaffSchema = z.strictObject({
  fullName: fullNameSchema,
  email: emailSchema,
  password: z.string().min(12, 'Use at least 12 characters').max(128, 'Use at most 128 characters'),
  roleCodes: roleCodesSchema,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const changeStaffRolesSchema = z.strictObject({ roleCodes: roleCodesSchema });
export type ChangeStaffRolesInput = z.infer<typeof changeStaffRolesSchema>;

export const changeStaffStatusSchema = z.strictObject({
  status: z.enum(['ACTIVE', 'DEACTIVATED']),
});
export type ChangeStaffStatusInput = z.infer<typeof changeStaffStatusSchema>;
