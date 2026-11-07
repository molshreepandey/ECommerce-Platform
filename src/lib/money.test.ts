import { describe, expect, it } from 'vitest';

import { InvalidMoneyAmountError, Money } from '@/lib/money';

describe('Money', () => {
  it('accepts integer paise and rejects fractions or unsafe integers', () => {
    expect(Money.fromPaise(12_345)).toBe(12_345);
    expect(() => Money.fromPaise(10.5)).toThrow(InvalidMoneyAmountError);
    expect(() => Money.fromPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyAmountError);
    expect(() => Money.fromPaise(Number.NaN)).toThrow(InvalidMoneyAmountError);
  });

  it('adds and subtracts without floating point drift', () => {
    const totalPaise = Money.add(Money.fromPaise(10), Money.fromPaise(20), Money.fromPaise(30));
    expect(totalPaise).toBe(60);
    expect(Money.subtract(totalPaise, Money.fromPaise(75))).toBe(-15);
    expect(Money.add()).toBe(0);
  });

  it('multiplies by an integer quantity only', () => {
    expect(Money.multiplyByQuantity(Money.fromPaise(49_900), 3)).toBe(149_700);
    expect(() => Money.multiplyByQuantity(Money.fromPaise(100), 1.5)).toThrow(
      InvalidMoneyAmountError,
    );
  });

  it('applies basis points with half-up rounding', () => {
    expect(Money.applyBasisPoints(Money.fromPaise(10_000), 1_000)).toBe(1_000);
    expect(Money.applyBasisPoints(Money.fromPaise(999), 500)).toBe(50);
    expect(Money.applyBasisPoints(Money.fromPaise(10), 2_500)).toBe(3);
    expect(Money.applyBasisPoints(Money.fromPaise(10), 2_400)).toBe(2);
    expect(Money.applyBasisPoints(Money.fromPaise(-10), 2_500)).toBe(-3);
  });

  it('picks the smaller or larger amount', () => {
    expect(Money.min(Money.fromPaise(5), Money.fromPaise(9))).toBe(5);
    expect(Money.max(Money.fromPaise(5), Money.fromPaise(9))).toBe(9);
  });

  it('formats paise as Indian rupees', () => {
    expect(Money.formatRupees(Money.fromPaise(12_345_678))).toBe('₹1,23,456.78');
    expect(Money.formatRupees(Money.zero)).toBe('₹0.00');
  });
});
