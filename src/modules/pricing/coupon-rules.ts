import type { DiscountType } from '@/generated/prisma/enums';
import { Money, type Paise } from '@/lib/money';

export interface CouponTerms {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  validFrom: Date;
  validUntil: Date;
  totalUsageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  usedCount: number;
  isActive: boolean;
}

export interface CouponCustomerHistory {
  redemptionCount: number;
  placedOrderCount: number;
}

export const couponRejectionCodes = [
  'COUPON_INACTIVE',
  'COUPON_NOT_STARTED',
  'COUPON_EXPIRED',
  'COUPON_MIN_CART_NOT_MET',
  'COUPON_EXHAUSTED',
  'COUPON_CUSTOMER_LIMIT_REACHED',
  'COUPON_FIRST_ORDER_ONLY',
] as const;

export type CouponRejectionCode = (typeof couponRejectionCodes)[number];

export type CouponEvaluation =
  | { isApplicable: true; discountPaise: Paise }
  | { isApplicable: false; rejectionCode: CouponRejectionCode; message: string };

// Whole-percent discounts round down, so the customer is never promised more than the cap or the value.
export function couponDiscountPaise(terms: CouponTerms, subtotalPaise: number): Paise {
  const raw =
    terms.discountType === 'FLAT'
      ? terms.discountValue
      : Math.floor((subtotalPaise * terms.discountValue) / 100);
  const capped = terms.maxDiscountPaise === null ? raw : Math.min(raw, terms.maxDiscountPaise);
  return Money.fromPaise(Math.min(capped, subtotalPaise));
}

function reject(rejectionCode: CouponRejectionCode, message: string): CouponEvaluation {
  return { isApplicable: false, rejectionCode, message };
}

// C25 / D45: every rule in a fixed order, so the customer sees the first reason that applies.
export function evaluateCoupon(input: {
  terms: CouponTerms;
  subtotalPaise: number;
  history: CouponCustomerHistory;
  now: Date;
}): CouponEvaluation {
  const { terms, subtotalPaise, history, now } = input;
  if (!terms.isActive) return reject('COUPON_INACTIVE', 'This coupon is not active.');
  if (now < terms.validFrom) return reject('COUPON_NOT_STARTED', 'This coupon is not valid yet.');
  if (now >= terms.validUntil) return reject('COUPON_EXPIRED', 'This coupon has expired.');
  if (terms.totalUsageLimit !== null && terms.usedCount >= terms.totalUsageLimit) {
    return reject('COUPON_EXHAUSTED', 'This coupon has reached its usage limit.');
  }
  if (terms.perCustomerLimit !== null && history.redemptionCount >= terms.perCustomerLimit) {
    return reject(
      'COUPON_CUSTOMER_LIMIT_REACHED',
      'You have already used this coupon as many times as allowed.',
    );
  }
  if (terms.firstOrderOnly && history.placedOrderCount > 0) {
    return reject('COUPON_FIRST_ORDER_ONLY', 'This coupon is for your first order only.');
  }
  if (subtotalPaise < terms.minCartPaise) {
    return reject(
      'COUPON_MIN_CART_NOT_MET',
      `Add items worth ${Money.formatRupees(Money.fromPaise(terms.minCartPaise - subtotalPaise))} more to use this coupon.`,
    );
  }
  return { isApplicable: true, discountPaise: couponDiscountPaise(terms, subtotalPaise) };
}
