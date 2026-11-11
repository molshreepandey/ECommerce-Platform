import { describe, expect, it } from 'vitest';

import type { InventoryMovementType } from '@/generated/prisma/enums';
import { DomainError } from '@/lib/errors';

import { maximumOnHandQuantity } from './inventory.schema';
import {
  adjustmentDelta,
  assertWithinOnHandLimit,
  isLowStock,
  isReservable,
  lowStockEligible,
  type MovementQuantities,
  quantitiesBefore,
  thresholdChangeAllowed,
} from './stock-rules';

describe('quantitiesBefore', () => {
  const cases: readonly [MovementQuantities, { onHandBefore: number; reservedBefore: number }][] = [
    [
      { movementType: 'RESERVE', quantityDelta: 2, onHandAfter: 10, reservedAfter: 3 },
      { onHandBefore: 10, reservedBefore: 1 },
    ],
    [
      { movementType: 'RELEASE', quantityDelta: -1, onHandAfter: 10, reservedAfter: 2 },
      { onHandBefore: 10, reservedBefore: 3 },
    ],
    [
      { movementType: 'DISPATCH', quantityDelta: -2, onHandAfter: 8, reservedAfter: 1 },
      { onHandBefore: 10, reservedBefore: 3 },
    ],
    [
      { movementType: 'RETURN_RESTOCK', quantityDelta: 1, onHandAfter: 9, reservedAfter: 1 },
      { onHandBefore: 8, reservedBefore: 1 },
    ],
    [
      { movementType: 'RTO_RESTOCK', quantityDelta: 2, onHandAfter: 11, reservedAfter: 1 },
      { onHandBefore: 9, reservedBefore: 1 },
    ],
    [
      { movementType: 'ADJUSTMENT', quantityDelta: -4, onHandAfter: 7, reservedAfter: 1 },
      { onHandBefore: 11, reservedBefore: 1 },
    ],
    [
      { movementType: 'ADJUSTMENT', quantityDelta: 0, onHandAfter: 0, reservedAfter: 0 },
      { onHandBefore: 0, reservedBefore: 0 },
    ],
    [
      { movementType: 'TRANSFER_OUT', quantityDelta: -3, onHandAfter: 4, reservedAfter: 1 },
      { onHandBefore: 7, reservedBefore: 1 },
    ],
    [
      { movementType: 'TRANSFER_IN', quantityDelta: 3, onHandAfter: 7, reservedAfter: 1 },
      { onHandBefore: 4, reservedBefore: 1 },
    ],
    [
      { movementType: 'RECEIPT', quantityDelta: 20, onHandAfter: 27, reservedAfter: 1 },
      { onHandBefore: 7, reservedBefore: 1 },
    ],
  ];

  it.each(cases)('works out the quantities before a movement (%o)', (movement, expected) => {
    expect(quantitiesBefore(movement)).toEqual(expected);
  });

  it('covers every movement type', () => {
    const covered = new Set(cases.map(([movement]) => movement.movementType));
    const allTypes: readonly InventoryMovementType[] = [
      'RESERVE',
      'RELEASE',
      'DISPATCH',
      'RETURN_RESTOCK',
      'RTO_RESTOCK',
      'ADJUSTMENT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'RECEIPT',
    ];
    expect([...covered].sort()).toEqual([...allTypes].sort());
  });

  it('chains a ledger: each movement starts where the previous one ended', () => {
    const ledger: readonly MovementQuantities[] = [
      { movementType: 'ADJUSTMENT', quantityDelta: 10, onHandAfter: 10, reservedAfter: 0 },
      { movementType: 'RESERVE', quantityDelta: 3, onHandAfter: 10, reservedAfter: 3 },
      { movementType: 'RELEASE', quantityDelta: -1, onHandAfter: 10, reservedAfter: 2 },
      { movementType: 'DISPATCH', quantityDelta: -2, onHandAfter: 8, reservedAfter: 0 },
      { movementType: 'RECEIPT', quantityDelta: 5, onHandAfter: 13, reservedAfter: 0 },
      { movementType: 'RTO_RESTOCK', quantityDelta: 1, onHandAfter: 14, reservedAfter: 0 },
    ];
    ledger.forEach((movement, index) => {
      const previous = ledger[index - 1];
      const before = quantitiesBefore(movement);
      expect(before).toEqual(
        previous === undefined
          ? { onHandBefore: 0, reservedBefore: 0 }
          : { onHandBefore: previous.onHandAfter, reservedBefore: previous.reservedAfter },
      );
    });
  });
});

describe('adjustmentDelta', () => {
  it('turns add, remove and set into an on-hand change', () => {
    expect(adjustmentDelta({ operation: 'ADD', quantity: 5 })).toBe(5);
    expect(adjustmentDelta({ operation: 'REMOVE', quantity: 3 })).toBe(-3);
    expect(
      adjustmentDelta({ operation: 'SET', expectedOnHandQuantity: 10, newOnHandQuantity: 7 }),
    ).toBe(-3);
    expect(
      adjustmentDelta({ operation: 'SET', expectedOnHandQuantity: 0, newOnHandQuantity: 12 }),
    ).toBe(12);
  });

  it('refuses a change of zero with 422 NO_STOCK_CHANGE', () => {
    for (const plan of [
      { operation: 'SET', expectedOnHandQuantity: 9, newOnHandQuantity: 9 },
      { operation: 'ADD', quantity: 0 },
      { operation: 'REMOVE', quantity: 0 },
    ] as const) {
      expect(() => adjustmentDelta(plan)).toThrow(DomainError);
      try {
        adjustmentDelta(plan);
      } catch (error) {
        expect(error).toMatchObject({ code: 'NO_STOCK_CHANGE', httpStatus: 422 });
      }
    }
  });
});

describe('isLowStock', () => {
  it('matches the partial-index rule: threshold above 0 and available at or below it', () => {
    expect(isLowStock({ availableQuantity: 5, lowStockThreshold: 5 })).toBe(true);
    expect(isLowStock({ availableQuantity: 0, lowStockThreshold: 1 })).toBe(true);
    expect(isLowStock({ availableQuantity: 6, lowStockThreshold: 5 })).toBe(false);
    expect(isLowStock({ availableQuantity: 0, lowStockThreshold: 0 })).toBe(false);
  });
});

describe('thresholdChangeAllowed', () => {
  it('lets an archived product or variant only clear its threshold to 0', () => {
    const cases = [
      { productStatus: 'ACTIVE', variantStatus: 'ACTIVE', newThreshold: 8, allowed: true },
      { productStatus: 'DRAFT', variantStatus: 'ACTIVE', newThreshold: 8, allowed: true },
      { productStatus: 'ACTIVE', variantStatus: 'INACTIVE', newThreshold: 8, allowed: true },
      { productStatus: 'ARCHIVED', variantStatus: 'ACTIVE', newThreshold: 8, allowed: false },
      { productStatus: 'ACTIVE', variantStatus: 'ARCHIVED', newThreshold: 1, allowed: false },
      { productStatus: 'ARCHIVED', variantStatus: 'ARCHIVED', newThreshold: 0, allowed: true },
      { productStatus: 'ARCHIVED', variantStatus: 'ACTIVE', newThreshold: 0, allowed: true },
    ] as const;
    for (const { allowed, ...input } of cases) {
      expect(thresholdChangeAllowed(input), JSON.stringify(input)).toBe(allowed);
    }
  });
});

describe('isReservable', () => {
  it('needs both the product and the variant to be ACTIVE', () => {
    expect(isReservable({ productStatus: 'ACTIVE', variantStatus: 'ACTIVE' })).toBe(true);
    for (const input of [
      { productStatus: 'DRAFT', variantStatus: 'ACTIVE' },
      { productStatus: 'ARCHIVED', variantStatus: 'ACTIVE' },
      { productStatus: 'ACTIVE', variantStatus: 'INACTIVE' },
      { productStatus: 'ACTIVE', variantStatus: 'ARCHIVED' },
    ] as const) {
      expect(isReservable(input), JSON.stringify(input)).toBe(false);
    }
  });
});

describe('lowStockEligible', () => {
  it('never counts archived products or variants, and inactive warehouses only when asked', () => {
    const active = {
      productStatus: 'ACTIVE',
      variantStatus: 'ACTIVE',
      warehouseActive: true,
      includeInactiveWarehouses: false,
    } as const;
    expect(lowStockEligible(active)).toBe(true);
    expect(lowStockEligible({ ...active, productStatus: 'DRAFT' })).toBe(true);
    expect(lowStockEligible({ ...active, variantStatus: 'INACTIVE' })).toBe(true);
    expect(lowStockEligible({ ...active, productStatus: 'ARCHIVED' })).toBe(false);
    expect(lowStockEligible({ ...active, variantStatus: 'ARCHIVED' })).toBe(false);
    expect(lowStockEligible({ ...active, warehouseActive: false })).toBe(false);
    expect(
      lowStockEligible({ ...active, warehouseActive: false, includeInactiveWarehouses: true }),
    ).toBe(true);
    expect(
      lowStockEligible({
        ...active,
        variantStatus: 'ARCHIVED',
        warehouseActive: false,
        includeInactiveWarehouses: true,
      }),
    ).toBe(false);
  });
});

describe('assertWithinOnHandLimit', () => {
  const level = { variantId: 'v', warehouseId: 'w', onHandQuantity: maximumOnHandQuantity - 5 };

  it('allows reaching the ceiling exactly, and any removal', () => {
    expect(() => {
      assertWithinOnHandLimit(level, 5);
    }).not.toThrow();
    expect(() => {
      assertWithinOnHandLimit({ ...level, onHandQuantity: maximumOnHandQuantity + 10 }, -1);
    }).not.toThrow();
  });

  it('refuses going one above the ceiling with 422 ON_HAND_LIMIT_EXCEEDED and the numbers', () => {
    try {
      assertWithinOnHandLimit(level, 6);
      throw new Error('expected a DomainError');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        httpStatus: 422,
        code: 'ON_HAND_LIMIT_EXCEEDED',
        details: {
          onHandQuantity: maximumOnHandQuantity - 5,
          requestedOnHandQuantity: maximumOnHandQuantity + 1,
          maximumOnHandQuantity,
        },
      });
    }
  });
});
