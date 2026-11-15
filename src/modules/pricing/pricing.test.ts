import { describe, expect, it } from 'vitest';
import { allocateDiscount, includedTaxPaise, priceOrder } from './pricing';

const fees = { shippingFeePaise: 4900, freeShippingThresholdPaise: 49900, codFeePaise: 2900 };

describe('includedTaxPaise', () => {
  it('extracts the GST component of a tax-inclusive price, rounding half up', () => {
    expect(includedTaxPaise(11800, 1800)).toBe(1800);
    expect(includedTaxPaise(100, 1800)).toBe(15);
    expect(includedTaxPaise(10500, 500)).toBe(500);
    expect(includedTaxPaise(0, 1800)).toBe(0);
    expect(includedTaxPaise(1000, 0)).toBe(0);
  });
});

describe('allocateDiscount', () => {
  it('splits in proportion and gives leftover paise to the largest remainders', () => {
    expect(allocateDiscount([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(allocateDiscount([300, 100], 101)).toEqual([76, 25]);
  });

  it('always allocates exactly the discount', () => {
    const allocated = allocateDiscount([12345, 678, 9999, 1], 4321);
    expect(allocated.reduce((total, amount) => total + amount, 0)).toBe(4321);
  });

  it('allocates nothing when there is no discount or no subtotal', () => {
    expect(allocateDiscount([500, 500], 0)).toEqual([0, 0]);
    expect(allocateDiscount([], 0)).toEqual([]);
  });
});

describe('priceOrder', () => {
  const lines = [
    { lineKey: 'a', unitPricePaise: 39900, quantity: 2, taxRateBasisPoints: 1200 },
    { lineKey: 'b', unitPricePaise: 19900, quantity: 1, taxRateBasisPoints: 1800 },
  ];

  it('adds shipping below the free-shipping threshold and the COD fee for COD', () => {
    const breakdown = priceOrder({
      lines: [{ lineKey: 'a', unitPricePaise: 29900, quantity: 1, taxRateBasisPoints: 1800 }],
      discountPaise: 0,
      fees,
      paymentMethod: 'COD',
    });
    expect(breakdown.subtotalPaise).toBe(29900);
    expect(breakdown.shippingFeePaise).toBe(4900);
    expect(breakdown.codFeePaise).toBe(2900);
    expect(breakdown.totalPaise).toBe(29900 + 4900 + 2900);
    expect(breakdown.taxPaise).toBe(4561);
  });

  it('charges no COD fee for online payment', () => {
    const breakdown = priceOrder({ lines, discountPaise: 0, fees, paymentMethod: 'ONLINE' });
    expect(breakdown.codFeePaise).toBe(0);
    expect(breakdown.shippingFeePaise).toBe(0);
    expect(breakdown.totalPaise).toBe(99700);
  });

  it('applies the threshold to the amount after the coupon', () => {
    const atThreshold = priceOrder({
      lines: [{ lineKey: 'a', unitPricePaise: 59900, quantity: 1, taxRateBasisPoints: 1800 }],
      discountPaise: 10000,
      fees,
      paymentMethod: 'ONLINE',
    });
    expect(atThreshold.shippingFeePaise).toBe(0);
    const below = priceOrder({
      lines: [{ lineKey: 'a', unitPricePaise: 59900, quantity: 1, taxRateBasisPoints: 1800 }],
      discountPaise: 10001,
      fees,
      paymentMethod: 'ONLINE',
    });
    expect(below.shippingFeePaise).toBe(4900);
    expect(below.totalPaise).toBe(59900 - 10001 + 4900);
  });

  it('computes tax per line on the discounted amount', () => {
    const breakdown = priceOrder({ lines, discountPaise: 9970, fees, paymentMethod: 'ONLINE' });
    expect(breakdown.lines.map((line) => line.discountPaise)).toEqual([7980, 1990]);
    expect(breakdown.lines.map((line) => line.taxPaise)).toEqual([
      includedTaxPaise(79800 - 7980, 1200),
      includedTaxPaise(19900 - 1990, 1800),
    ]);
    expect(breakdown.taxPaise).toBe(
      breakdown.lines.reduce((total, line) => total + line.taxPaise, 0),
    );
  });

  it('never discounts more than the subtotal', () => {
    const breakdown = priceOrder({
      lines: [{ lineKey: 'a', unitPricePaise: 5000, quantity: 1, taxRateBasisPoints: 0 }],
      discountPaise: 15000,
      fees,
      paymentMethod: 'ONLINE',
    });
    expect(breakdown.discountPaise).toBe(5000);
    expect(breakdown.totalPaise).toBe(4900);
  });

  it('prices an empty cart at zero with no fees', () => {
    const breakdown = priceOrder({ lines: [], discountPaise: 0, fees, paymentMethod: 'COD' });
    expect(breakdown.totalPaise).toBe(0);
    expect(breakdown.shippingFeePaise).toBe(0);
    expect(breakdown.codFeePaise).toBe(0);
  });
});
