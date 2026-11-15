import { z } from 'zod';

export const maximumQuantityPerLine = 10;
export const maximumCartLines = 30;

export const cartQuantitySchema = z.int().min(1).max(maximumQuantityPerLine);

export const addCartItemSchema = z.object({
  variantId: z.uuid().transform((value) => value.toLowerCase()),
  quantity: cartQuantitySchema.default(1),
});

export const updateCartItemSchema = z.object({ quantity: cartQuantitySchema });

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, 'Enter a coupon code of 3–32 letters or digits.');

export const applyCouponSchema = z.object({ code: couponCodeSchema });

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
