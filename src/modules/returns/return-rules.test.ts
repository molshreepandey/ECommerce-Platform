import { describe, expect, it } from 'vitest';
import {
  canMoveReturn,
  refundablePerUnitPaise,
  returnableQuantity,
  returnWindowEndsAt,
} from './return-rules';

describe('return transitions', () => {
  it('follows request → approve → pickup → received → restock → refund or exchange', () => {
    expect(canMoveReturn('REQUESTED', 'APPROVED', 'RETURN')).toBe(true);
    expect(canMoveReturn('REQUESTED', 'REJECTED', 'RETURN')).toBe(true);
    expect(canMoveReturn('APPROVED', 'RECEIVED', 'RETURN')).toBe(false);
    expect(canMoveReturn('RESTOCKED', 'REFUNDED', 'RETURN')).toBe(true);
    expect(canMoveReturn('RESTOCKED', 'EXCHANGED', 'RETURN')).toBe(false);
    expect(canMoveReturn('RESTOCKED', 'EXCHANGED', 'EXCHANGE')).toBe(true);
    expect(canMoveReturn('RESTOCKED', 'REFUNDED', 'EXCHANGE')).toBe(false);
    expect(canMoveReturn('REJECTED', 'APPROVED', 'RETURN')).toBe(false);
  });
});

describe('return eligibility', () => {
  it('never allows more than was delivered and not yet requested', () => {
    const quantity = (delivered: number, inWindow: number, requested: number) =>
      returnableQuantity({
        deliveredQuantity: delivered,
        deliveredInOpenWindowQuantity: inWindow,
        alreadyRequestedQuantity: requested,
      });
    expect(quantity(3, 3, 1)).toBe(2);
    expect(quantity(1, 1, 2)).toBe(0);
  });

  it('counts each package from its own delivery (L67)', () => {
    const quantity = (delivered: number, inWindow: number, requested: number) =>
      returnableQuantity({
        deliveredQuantity: delivered,
        deliveredInOpenWindowQuantity: inWindow,
        alreadyRequestedQuantity: requested,
      });
    // 2 units delivered first (window now closed), 1 later (still open).
    expect(quantity(3, 1, 0)).toBe(1);
    // The 2 earlier units were requested while their window was open: the later unit stays returnable.
    expect(quantity(3, 1, 2)).toBe(1);
    expect(quantity(3, 1, 3)).toBe(0);
  });

  it('counts the window from delivery', () => {
    expect(returnWindowEndsAt(new Date('2026-11-01T10:00:00Z'), 7).toISOString()).toBe(
      '2026-11-08T10:00:00.000Z',
    );
  });

  it('refunds what was paid per unit after the coupon, rounded down', () => {
    expect(
      refundablePerUnitPaise({
        unitPricePaise: 79_900,
        subtotalPaise: 159_800,
        discountPaise: 15_980,
      }),
    ).toBe(71_910);
    expect(
      refundablePerUnitPaise({ unitPricePaise: 333, subtotalPaise: 1000, discountPaise: 1 }),
    ).toBe(332);
    expect(
      refundablePerUnitPaise({ unitPricePaise: 500, subtotalPaise: 500, discountPaise: 0 }),
    ).toBe(500);
  });
});
