import { z } from 'zod';

import { couponCodeSchema } from '@/modules/cart/cart.schema';

const optionalLimit = z.int().min(1).max(10_000_000).nullable();

const couponFieldsSchema = z.object({
  description: z.string().trim().max(200).default(''),
  discountType: z.enum(['FLAT', 'PERCENT']),
  discountValue: z.int().min(1).max(10_000_000),
  maxDiscountPaise: z.int().min(1).max(10_000_000).nullable(),
  minCartPaise: z.int().min(0).max(100_000_000),
  validFrom: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  validUntil: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  totalUsageLimit: optionalLimit,
  perCustomerLimit: optionalLimit,
  firstOrderOnly: z.boolean(),
  isActive: z.boolean(),
});

function couponRulesHold(coupon: z.infer<typeof couponFieldsSchema>, context: z.RefinementCtx) {
  if (coupon.discountType === 'PERCENT' && coupon.discountValue > 100) {
    context.addIssue({
      code: 'custom',
      path: ['discountValue'],
      message: 'A percentage must be 1–100.',
    });
  }
  if (coupon.validUntil <= coupon.validFrom) {
    context.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'The end must be after the start.',
    });
  }
}

// D45: amounts in paise; PERCENT takes a whole percent with an optional cap.
export const couponInputSchema = couponFieldsSchema
  .extend({ code: couponCodeSchema })
  .superRefine(couponRulesHold);

export const updateCouponSchema = couponFieldsSchema.superRefine(couponRulesHold);

export type CouponInput = z.infer<typeof couponInputSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
