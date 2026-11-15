import { describe, expect, it } from 'vitest';
import { type CouponTerms, couponDiscountPaise, evaluateCoupon } from './coupon-rules';

const now = new Date('2026-11-14T10:00:00Z');
const day = 86_400_000;

function terms(overrides: Partial<CouponTerms> = {}): CouponTerms {
  return {
    code: 'SAVE10',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountPaise: 20000,
    minCartPaise: 99900,
    validFrom: new Date(now.getTime() - 30 * day),
    validUntil: new Date(now.getTime() + 365 * day),
    totalUsageLimit: 1000,
    perCustomerLimit: 3,
    firstOrderOnly: false,
    usedCount: 0,
    isActive: true,
    ...overrides,
  };
}

const freshCustomer = { redemptionCount: 0, placedOrderCount: 0 };

describe('couponDiscountPaise (seeded coupons)', () => {
  it('SAVE10: 10% rounded down, capped at ₹200', () => {
    expect(couponDiscountPaise(terms(), 99999)).toBe(9999);
    expect(couponDiscountPaise(terms(), 500000)).toBe(20000);
  });

  it('FLAT150: flat ₹150, never more than the subtotal', () => {
    const flat = terms({ discountType: 'FLAT', discountValue: 15000, maxDiscountPaise: null });
    expect(couponDiscountPaise(flat, 79900)).toBe(15000);
    expect(couponDiscountPaise(flat, 10000)).toBe(10000);
  });

  it('WELCOME20: 20% capped at ₹300', () => {
    const welcome = terms({ discountValue: 20, maxDiscountPaise: 30000, minCartPaise: 0 });
    expect(couponDiscountPaise(welcome, 100000)).toBe(20000);
    expect(couponDiscountPaise(welcome, 200000)).toBe(30000);
  });
});

describe('evaluateCoupon', () => {
  const evaluate = (couponTerms: CouponTerms, subtotalPaise = 150000, history = freshCustomer) =>
    evaluateCoupon({ terms: couponTerms, subtotalPaise, history, now });

  it('accepts a valid coupon with its discount', () => {
    expect(evaluate(terms())).toEqual({ isApplicable: true, discountPaise: 15000 });
  });

  it.each([
    [terms({ isActive: false }), 'COUPON_INACTIVE'],
    [terms({ validFrom: new Date(now.getTime() + day) }), 'COUPON_NOT_STARTED'],
    [terms({ validUntil: new Date(now.getTime() - 1) }), 'COUPON_EXPIRED'],
    [terms({ validUntil: now }), 'COUPON_EXPIRED'],
    [terms({ totalUsageLimit: 100, usedCount: 100 }), 'COUPON_EXHAUSTED'],
  ] as const)('rejects %#: %s', (couponTerms, rejectionCode) => {
    expect(evaluate(couponTerms)).toMatchObject({ isApplicable: false, rejectionCode });
  });

  it('rejects below the minimum cart and says how much more is needed', () => {
    const evaluation = evaluate(terms(), 90000);
    expect(evaluation).toMatchObject({
      isApplicable: false,
      rejectionCode: 'COUPON_MIN_CART_NOT_MET',
    });
    expect(evaluation.isApplicable ? '' : evaluation.message).toContain('99.00');
  });

  it('rejects once the customer reached the per-customer limit', () => {
    expect(evaluate(terms(), 150000, { redemptionCount: 3, placedOrderCount: 3 })).toMatchObject({
      rejectionCode: 'COUPON_CUSTOMER_LIMIT_REACHED',
    });
  });

  it('rejects a first-order coupon for a customer with orders', () => {
    const firstOrder = terms({ firstOrderOnly: true, perCustomerLimit: 1 });
    expect(evaluate(firstOrder, 150000, { redemptionCount: 0, placedOrderCount: 1 })).toMatchObject(
      {
        rejectionCode: 'COUPON_FIRST_ORDER_ONLY',
      },
    );
    expect(evaluate(firstOrder)).toMatchObject({ isApplicable: true });
  });
});
