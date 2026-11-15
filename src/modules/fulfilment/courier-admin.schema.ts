import { z } from 'zod';

const pincodeSchema = z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode.');

export const createCourierPartnerSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,40}$/, 'Use 3–40 letters, digits or -.'),
  name: z.string().trim().min(2).max(80),
  priority: z.int().min(1).max(1000),
  supportsCod: z.boolean(),
  isActive: z.boolean(),
});

export const updateCourierPartnerSchema = createCourierPartnerSchema
  .omit({ code: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Change at least one field.' });

export const serviceablePincodeSchema = z.strictObject({
  pincode: pincodeSchema,
  codAvailable: z.boolean(),
  maxCodValuePaise: z.int().min(100).max(100_000_000).nullable(),
  etaDays: z.int().min(1).max(30),
});

export const removePincodeSchema = z.strictObject({ pincode: pincodeSchema });

export type CreateCourierPartnerInput = z.infer<typeof createCourierPartnerSchema>;
export type UpdateCourierPartnerInput = z.infer<typeof updateCourierPartnerSchema>;
export type ServiceablePincodeInput = z.infer<typeof serviceablePincodeSchema>;
