import { describe, expect, it } from 'vitest';

import { type RecordedMovement, stockRequestResult } from './stock-request-result';

const recordedAt = new Date('2026-11-11T05:30:00.123Z');

function movement(
  overrides: Partial<RecordedMovement> & Pick<RecordedMovement, 'id'>,
): RecordedMovement {
  return {
    variantId: 'v2',
    warehouseId: 'w1',
    movementType: 'RECEIPT',
    quantityDelta: 6,
    onHandAfter: 16,
    reservedAfter: 3,
    reason: 'INV-2026-114',
    createdAt: recordedAt,
    ...overrides,
  };
}

describe('stockRequestResult', () => {
  it('works out before-values and availability from the stored after-values', () => {
    const result = stockRequestResult({
      changeRequestId: 'request-1',
      operation: 'RECEIPT',
      replayed: false,
      movements: [movement({ id: 'm1' })],
    });
    expect(result).toEqual({
      changeRequestId: 'request-1',
      operation: 'RECEIPT',
      replayed: false,
      movements: [
        {
          movementId: 'm1',
          variantId: 'v2',
          warehouseId: 'w1',
          movementType: 'RECEIPT',
          quantityDelta: 6,
          onHandBefore: 10,
          onHandAfter: 16,
          reservedBefore: 3,
          reservedAfter: 3,
          availableAfter: 13,
          reason: 'INV-2026-114',
          recordedAt,
        },
      ],
    });
  });

  it('orders movements by variant, warehouse and id, whatever order they arrive in', () => {
    const result = stockRequestResult({
      changeRequestId: 'request-1',
      operation: 'RECEIPT',
      replayed: false,
      movements: [
        movement({ id: 'm3', variantId: 'v2' }),
        movement({ id: 'm1', variantId: 'v1' }),
        movement({ id: 'm2', variantId: 'v1', warehouseId: 'w0' }),
      ],
    });
    expect(result.movements.map(({ movementId }) => movementId)).toEqual(['m2', 'm1', 'm3']);
  });

  it('gives a replay exactly the original result apart from the replayed flag', () => {
    const rows = [
      movement({
        id: 'm1',
        movementType: 'ADJUSTMENT',
        quantityDelta: -4,
        onHandAfter: 6,
        reason: 'Damaged',
      }),
    ];
    const original = stockRequestResult({
      changeRequestId: 'r',
      operation: 'ADJUST_REMOVE',
      replayed: false,
      movements: rows,
    });
    const replay = stockRequestResult({
      changeRequestId: 'r',
      operation: 'ADJUST_REMOVE',
      replayed: true,
      movements: [...rows].reverse(),
    });
    expect({ ...replay, replayed: false }).toEqual(original);
    expect(replay.movements[0]).toMatchObject({ onHandBefore: 10, onHandAfter: 6 });
  });
});
