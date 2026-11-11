import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const newPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters');
export const indianMobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9');
export const fullNameSchema = z.string().trim().min(2, 'Enter your full name').max(100);
export const indianPincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode');

export const registerCustomerSchema = z.strictObject({
  fullName: fullNameSchema,
  email: emailSchema,
  phone: indianMobileSchema,
  password: newPasswordSchema,
});
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z
  .strictObject({ fullName: fullNameSchema.optional(), phone: indianMobileSchema.optional() })
  .refine((input) => input.fullName !== undefined || input.phone !== undefined, {
    message: 'Change at least one field',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

const optionalText = (maximumLength: number) => z.string().trim().max(maximumLength).optional();

export const addressFieldsSchema = z.strictObject({
  recipientName: fullNameSchema,
  phone: indianMobileSchema,
  addressLine1: z.string().trim().min(3, 'Enter the street address').max(200),
  addressLine2: optionalText(200),
  landmark: optionalText(100),
  city: z.string().trim().min(2, 'Enter the city').max(100),
  state: z.string().trim().min(2, 'Enter the state').max(100),
  pincode: indianPincodeSchema,
});
export const createAddressSchema = addressFieldsSchema.extend({
  isDefault: z.boolean().optional(),
});
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export const updateAddressSchema = addressFieldsSchema
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Change at least one field',
  });
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
