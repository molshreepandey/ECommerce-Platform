import { describe, expect, it } from 'vitest';
import {
  allocateOrder,
  type AllocatableStock,
  byPincodeProximity,
  sharedPincodePrefixLength,
  warehouseOrderFor,
} from './allocation';

const stock = (
  variantId: string,
  warehouseId: string,
  warehousePriority: number,
  availableQuantity: number,
  warehousePincode = '560001',
): AllocatableStock => ({
  variantId,
  warehouseId,
  warehousePriority,
  warehousePincode,
  availableQuantity,
});

describe('allocateOrder', () => {
  it('prefers one warehouse that has the whole order, lowest priority number first', () => {
    const result = allocateOrder(
      [
        { variantId: 'a', quantity: 2 },
        { variantId: 'b', quantity: 1 },
      ],
      [stock('a', 'w1', 1, 5), stock('a', 'w2', 2, 5), stock('b', 'w2', 2, 1)],
    );
    expect(result).toEqual({
      isAllocated: true,
      lines: [
        { variantId: 'a', quantity: 2, warehouseId: 'w2' },
        { variantId: 'b', quantity: 1, warehouseId: 'w2' },
      ],
      warehouseIds: ['w2'],
    });
  });

  it('puts each line in the best warehouse that has all of it when no single one fits', () => {
    const result = allocateOrder(
      [
        { variantId: 'a', quantity: 2 },
        { variantId: 'b', quantity: 1 },
      ],
      [stock('a', 'w1', 1, 5), stock('b', 'w2', 2, 1), stock('b', 'w3', 3, 4)],
    );
    expect(result).toMatchObject({
      isAllocated: true,
      lines: [
        { variantId: 'a', warehouseId: 'w1', quantity: 2 },
        { variantId: 'b', warehouseId: 'w2', quantity: 1 },
      ],
      warehouseIds: ['w1', 'w2'],
    });
  });

  it('splits a line across warehouses only when no warehouse has enough', () => {
    const result = allocateOrder(
      [{ variantId: 'a', quantity: 3 }],
      [stock('a', 'w2', 2, 2), stock('a', 'w1', 1, 1)],
    );
    expect(result).toMatchObject({
      isAllocated: true,
      lines: [
        { variantId: 'a', warehouseId: 'w1', quantity: 1 },
        { variantId: 'a', warehouseId: 'w2', quantity: 2 },
      ],
      warehouseIds: ['w1', 'w2'],
    });
  });

  it('reports every line that is short, with what is available', () => {
    expect(
      allocateOrder(
        [
          { variantId: 'a', quantity: 4 },
          { variantId: 'b', quantity: 1 },
          { variantId: 'c', quantity: 1 },
        ],
        [stock('a', 'w1', 1, 3), stock('c', 'w1', 1, 1)],
      ),
    ).toEqual({
      isAllocated: false,
      shortLines: [
        { variantId: 'a', requestedQuantity: 4, availableQuantity: 3 },
        { variantId: 'b', requestedQuantity: 1, availableQuantity: 0 },
      ],
    });
  });

  it('breaks priority ties by warehouse id so the result is deterministic', () => {
    const result = allocateOrder(
      [{ variantId: 'a', quantity: 1 }],
      [stock('a', 'w9', 1, 1), stock('a', 'w3', 1, 1)],
    );
    expect(result).toMatchObject({ warehouseIds: ['w3'] });
  });
});

describe('pincode-distance allocation (Wave 16)', () => {
  it('measures nearness by the shared PIN prefix', () => {
    expect(sharedPincodePrefixLength('411001', '411045')).toBe(4);
    expect(sharedPincodePrefixLength('411001', '400050')).toBe(1);
    expect(sharedPincodePrefixLength('411001', '560034')).toBe(0);
    expect(sharedPincodePrefixLength('411001', '411001')).toBe(6);
  });

  it('ships the whole order from the nearest warehouse that has it, before a higher priority far one', () => {
    const lines = [{ variantId: 'a', quantity: 2 }];
    const stockRows = [stock('a', 'bengaluru', 1, 9, '560034'), stock('a', 'pune', 5, 9, '411045')];
    expect(allocateOrder(lines, stockRows)).toMatchObject({ warehouseIds: ['bengaluru'] });
    expect(allocateOrder(lines, stockRows, byPincodeProximity('411001'))).toMatchObject({
      warehouseIds: ['pune'],
    });
  });

  it('falls back to priority between equally near warehouses and to the next nearest without stock', () => {
    const lines = [{ variantId: 'a', quantity: 3 }];
    const order = warehouseOrderFor('NEAREST_PINCODE', '411001');
    expect(
      allocateOrder(
        lines,
        [stock('a', 'pune-b', 2, 9, '411002'), stock('a', 'pune-a', 1, 9, '411003')],
        order,
      ),
    ).toMatchObject({ warehouseIds: ['pune-a'] });
    expect(
      allocateOrder(
        lines,
        [
          stock('a', 'pune', 1, 1, '411002'),
          stock('a', 'mumbai', 3, 9, '400050'),
          stock('a', 'delhi', 2, 9, '110017'),
        ],
        order,
      ),
    ).toMatchObject({ warehouseIds: ['mumbai'] });
  });

  it('splits a line nearest first when no single warehouse has enough', () => {
    const result = allocateOrder(
      [{ variantId: 'a', quantity: 4 }],
      [
        stock('a', 'delhi', 1, 3, '110017'),
        stock('a', 'pune', 2, 2, '411002'),
        stock('a', 'mumbai', 3, 2, '400050'),
      ],
      warehouseOrderFor('NEAREST_PINCODE', '411001'),
    );
    expect(result).toEqual({
      isAllocated: true,
      lines: [
        { variantId: 'a', warehouseId: 'pune', quantity: 2 },
        { variantId: 'a', warehouseId: 'mumbai', quantity: 2 },
      ],
      warehouseIds: ['pune', 'mumbai'],
    });
  });

  it('PRIORITY keeps the original order whatever the pincode', () => {
    const result = allocateOrder(
      [{ variantId: 'a', quantity: 1 }],
      [stock('a', 'far', 1, 5, '110017'), stock('a', 'near', 2, 5, '411002')],
      warehouseOrderFor('PRIORITY', '411001'),
    );
    expect(result).toMatchObject({ warehouseIds: ['far'] });
  });
});
