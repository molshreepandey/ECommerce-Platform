import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  addStockSchema,
  changeWarehouseStatusSchema,
  customerReturnLinesSchema,
  createWarehouseSchema,
  idempotencyKeySchema,
  listLowStockSchema,
  listMovementsSchema,
  maximumLinesPerRequest,
  maximumStockQuantity,
  receiveStockSchema,
  reservationChangesSchema,
  setLowStockThresholdSchema,
  setStockSchema,
  shipmentStockLinesSchema,
  stockAdjustmentSchema,
  updateWarehouseSchema,
} from './inventory.schema';

const variantId = randomUUID();
const warehouseId = randomUUID();
const location = { variantId, warehouseId };

// Text with no letter or digit: whitespace of every kind, invisible characters and punctuation.
const meaninglessTexts = ['   ', '\t', '\n', '\r\n', ' \t\n ', '   ', '​​​', '﻿﻿﻿', '...', '---'];

describe('addStockSchema (also used for removals)', () => {
  it('accepts a whole positive quantity and a reason in any script, trimmed', () => {
    expect(
      addStockSchema.parse({ ...location, quantity: 4, reason: '  Found during count ' }),
    ).toEqual({
      ...location,
      quantity: 4,
      reason: 'Found during count',
    });
    for (const reason of ['क्षतिग्रस्त माल', 'Défectueux', '破损的货物', 'Box 42']) {
      expect(addStockSchema.safeParse({ ...location, quantity: 1, reason }).success, reason).toBe(
        true,
      );
    }
  });

  it('refuses zero, negative, fractional and too-large quantities', () => {
    for (const quantity of [0, -1, 1.5, maximumStockQuantity + 1, Number.NaN]) {
      expect(
        addStockSchema.safeParse({ ...location, quantity, reason: 'Count' }).success,
        String(quantity),
      ).toBe(false);
    }
  });

  it('refuses reasons that are too short or contain no letter or digit', () => {
    for (const reason of ['ab', ...meaninglessTexts]) {
      expect(
        addStockSchema.safeParse({ ...location, quantity: 1, reason }).success,
        JSON.stringify(reason),
      ).toBe(false);
    }
  });

  it('refuses unknown fields and bad ids', () => {
    expect(
      addStockSchema.safeParse({ ...location, quantity: 1, reason: 'Count', note: 'x' }).success,
    ).toBe(false);
    expect(
      addStockSchema.safeParse({
        variantId: 'not-a-uuid',
        warehouseId,
        quantity: 1,
        reason: 'Count',
      }).success,
    ).toBe(false);
  });
});

describe('setStockSchema', () => {
  it('needs the expected and the new on-hand quantity (0 allowed), and a reason', () => {
    expect(
      setStockSchema.safeParse({
        ...location,
        expectedOnHandQuantity: 0,
        newOnHandQuantity: 12,
        reason: 'Cycle count',
      }).success,
    ).toBe(true);
    expect(
      setStockSchema.safeParse({ ...location, newOnHandQuantity: 12, reason: 'Cycle count' })
        .success,
    ).toBe(false);
    expect(
      setStockSchema.safeParse({
        ...location,
        expectedOnHandQuantity: 3,
        newOnHandQuantity: -1,
        reason: 'Cycle count',
      }).success,
    ).toBe(false);
  });
});

describe('receiveStockSchema', () => {
  const receipt = (overrides: Record<string, unknown>) => ({
    warehouseId,
    supplierReference: 'INV-2026-114',
    lines: [{ variantId, quantity: 10 }],
    ...overrides,
  });

  it('accepts a supplier reference and sorts the lines by variant', () => {
    const [first, second] = [randomUUID(), randomUUID()].sort();
    if (first === undefined || second === undefined) throw new Error('two ids expected');
    const parsed = receiveStockSchema.parse(
      receipt({
        lines: [
          { variantId: second, quantity: 1 },
          { variantId: first, quantity: 2 },
        ],
      }),
    );
    expect(parsed.lines.map((line) => line.variantId)).toEqual([first, second]);
  });

  it('has no note field: a receipt carries only the supplier reference', () => {
    expect(receiveStockSchema.safeParse(receipt({ note: 'Delivered late' })).success).toBe(false);
  });

  it('refuses a missing or meaningless supplier reference', () => {
    expect(receiveStockSchema.safeParse(receipt({ supplierReference: undefined })).success).toBe(
      false,
    );
    for (const supplierReference of ['', ...meaninglessTexts]) {
      expect(
        receiveStockSchema.safeParse(receipt({ supplierReference })).success,
        JSON.stringify(supplierReference),
      ).toBe(false);
    }
  });

  it('refuses no lines, too many lines, repeated variants and zero quantities', () => {
    expect(receiveStockSchema.safeParse(receipt({ lines: [] })).success).toBe(false);
    const tooMany = Array.from({ length: maximumLinesPerRequest + 1 }, () => ({
      variantId: randomUUID(),
      quantity: 1,
    }));
    expect(receiveStockSchema.safeParse(receipt({ lines: tooMany })).success).toBe(false);
    expect(
      receiveStockSchema.safeParse(
        receipt({
          lines: [
            { variantId, quantity: 1 },
            { variantId, quantity: 2 },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      receiveStockSchema.safeParse(receipt({ lines: [{ variantId, quantity: 0 }] })).success,
    ).toBe(false);
  });
});

describe('setLowStockThresholdSchema', () => {
  it('accepts 0 (cleared) up to the maximum, and refuses negative or fractional values', () => {
    expect(
      setLowStockThresholdSchema.safeParse({ ...location, lowStockThreshold: 0 }).success,
    ).toBe(true);
    expect(
      setLowStockThresholdSchema.safeParse({ ...location, lowStockThreshold: 25 }).success,
    ).toBe(true);
    for (const lowStockThreshold of [-1, 2.5, 100_001]) {
      expect(setLowStockThresholdSchema.safeParse({ ...location, lowStockThreshold }).success).toBe(
        false,
      );
    }
  });
});

describe('warehouse schemas', () => {
  const warehouse = {
    code: ' wh-pune ',
    name: 'Pune Fulfilment Centre',
    addressLine1: '12 Chakan Industrial Area',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '410501',
    contactName: 'Asha Rao',
    contactPhone: '9876511004',
    priority: 4,
  };

  it('accepts a warehouse and upper-cases its code', () => {
    expect(createWarehouseSchema.parse(warehouse).code).toBe('WH-PUNE');
  });

  it('refuses a bad code, pincode, phone or priority', () => {
    for (const overrides of [
      { code: 'WH PUNE' },
      { code: 'WH--PUNE' },
      { pincode: '012345' },
      { contactPhone: '12345' },
      { priority: 0 },
    ]) {
      expect(
        createWarehouseSchema.safeParse({ ...warehouse, ...overrides }).success,
        JSON.stringify(overrides),
      ).toBe(false);
    }
  });

  it('edits only the given fields, needs at least one, and never the code', () => {
    expect(updateWarehouseSchema.parse({ name: 'Pune Hub' })).toEqual({ name: 'Pune Hub' });
    expect(updateWarehouseSchema.safeParse({}).success).toBe(false);
    expect(updateWarehouseSchema.safeParse({ code: 'WH-NEW' }).success).toBe(false);
    expect(changeWarehouseStatusSchema.safeParse({ isActive: false }).success).toBe(true);
  });
});

describe('idempotencyKeySchema', () => {
  it('matches the database rule: 16 to 100 letters, digits, hyphens or underscores', () => {
    expect(idempotencyKeySchema.safeParse(randomUUID()).success).toBe(true);
    expect(idempotencyKeySchema.safeParse('k'.repeat(16)).success).toBe(true);
    for (const key of [
      'k'.repeat(15),
      'k'.repeat(101),
      'has spaces in it ok',
      'ключ-ключ-ключ-ключ',
    ]) {
      expect(idempotencyKeySchema.safeParse(key).success, key).toBe(false);
    }
  });
});

describe('reservationChangesSchema', () => {
  const line = { shipmentId: randomUUID(), variantId, warehouseId, quantity: 2 };

  it('needs at least one line and defaults the other list to empty', () => {
    expect(reservationChangesSchema.parse({ reserve: [line] })).toEqual({
      reserve: [line],
      release: [],
    });
    expect(reservationChangesSchema.safeParse({}).success).toBe(false);
    expect(reservationChangesSchema.safeParse({ reserve: [], release: [] }).success).toBe(false);
  });

  it('refuses the same shipment, variant and warehouse twice in one list, and zero quantities', () => {
    expect(
      reservationChangesSchema.safeParse({ release: [line, { ...line, quantity: 1 }] }).success,
    ).toBe(false);
    expect(
      reservationChangesSchema.safeParse({ reserve: [{ ...line, quantity: 0 }] }).success,
    ).toBe(false);
  });

  it('refuses reserving and releasing the same shipment, variant and warehouse in one call', () => {
    expect(reservationChangesSchema.safeParse({ reserve: [line], release: [line] }).success).toBe(
      false,
    );
    const otherShipment = { ...line, shipmentId: randomUUID() };
    expect(
      reservationChangesSchema.safeParse({ reserve: [line], release: [otherShipment] }).success,
    ).toBe(true);
  });
});

describe('list query schemas', () => {
  it('coerces query-string values and refuses unknown parameters', () => {
    const parsed = listMovementsSchema.parse({
      limit: '20',
      movementType: 'RECEIPT',
      createdFrom: '2026-11-01T00:00:00+05:30',
    });
    expect(parsed.limit).toBe(20);
    expect(parsed.createdFrom?.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(listMovementsSchema.parse({}).limit).toBe(50);
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { movementType: 'GIFT' },
      { createdFrom: 'yesterday' },
      { page: '2' },
    ]) {
      expect(listMovementsSchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
  });

  it('reads true/false flags exactly, never treating "false" as true', () => {
    expect(
      listLowStockSchema.parse({ includeInactiveWarehouses: 'false' }).includeInactiveWarehouses,
    ).toBe(false);
    expect(
      listLowStockSchema.parse({ includeInactiveWarehouses: 'true' }).includeInactiveWarehouses,
    ).toBe(true);
    expect(listLowStockSchema.parse({}).includeInactiveWarehouses).toBe(false);
    expect(listLowStockSchema.safeParse({ includeInactiveWarehouses: 'yes' }).success).toBe(false);
  });

  it('reads the low-stock cursor as a warehouse and variant id pair, refusing anything else', () => {
    const [warehouse, variant] = [randomUUID(), randomUUID()];
    expect(
      listLowStockSchema.parse({ cursor: `${warehouse.toUpperCase()}/${variant}` }).cursor,
    ).toEqual({
      warehouseId: warehouse,
      variantId: variant,
    });
    for (const cursor of [
      warehouse,
      `${warehouse}/`,
      `${warehouse}/not-a-uuid`,
      `${warehouse}/${variant}/x`,
    ]) {
      expect(listLowStockSchema.safeParse({ cursor }).success, cursor).toBe(false);
    }
  });
});

describe('stockAdjustmentSchema (HTTP body for add, remove and set)', () => {
  it('accepts each operation with exactly its own fields', () => {
    expect(
      stockAdjustmentSchema.parse({
        operation: 'ADD',
        ...location,
        quantity: 2,
        reason: ' Found  ',
      }),
    ).toEqual({ operation: 'ADD', ...location, quantity: 2, reason: 'Found' });
    expect(
      stockAdjustmentSchema.parse({
        operation: 'REMOVE',
        ...location,
        quantity: 1,
        reason: 'Damaged',
      }).operation,
    ).toBe('REMOVE');
    expect(
      stockAdjustmentSchema.parse({
        operation: 'SET',
        ...location,
        expectedOnHandQuantity: 4,
        newOnHandQuantity: 6,
        reason: 'Recount',
      }).operation,
    ).toBe('SET');
  });

  it('refuses an unknown operation, a missing one, or fields that belong to another operation', () => {
    for (const body of [
      { ...location, quantity: 1, reason: 'No operation' },
      { operation: 'TRANSFER', ...location, quantity: 1, reason: 'Unknown' },
      { operation: 'ADD', ...location, quantity: 1, reason: 'Extra', newOnHandQuantity: 3 },
      { operation: 'SET', ...location, quantity: 1, reason: 'Wrong fields' },
      { operation: 'ADD', ...location, quantity: 0, reason: 'Zero' },
      { operation: 'ADD', variantId: 'not-a-uuid', warehouseId, quantity: 1, reason: 'Bad id' },
    ]) {
      expect(stockAdjustmentSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe('upper-case ids in receipts and thresholds', () => {
  const upperVariantId = variantId.toUpperCase();
  const upperWarehouseId = warehouseId.toUpperCase();

  it('lower-cases receipt and threshold ids, as PostgreSQL returns them', () => {
    const receipt = receiveStockSchema.parse({
      warehouseId: upperWarehouseId,
      supplierReference: 'PO-1',
      lines: [{ variantId: upperVariantId, quantity: 2 }],
    });
    expect(receipt.warehouseId).toBe(warehouseId);
    expect(receipt.lines).toEqual([{ variantId, quantity: 2 }]);
    expect(
      setLowStockThresholdSchema.parse({
        variantId: upperVariantId,
        warehouseId: upperWarehouseId,
        lowStockThreshold: 3,
      }),
    ).toEqual({ variantId, warehouseId, lowStockThreshold: 3 });
  });

  it('refuses a receipt naming the same variant twice in different letter case', () => {
    const result = receiveStockSchema.safeParse({
      warehouseId,
      supplierReference: 'PO-2',
      lines: [
        { variantId, quantity: 1 },
        { variantId: upperVariantId, quantity: 1 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ message }) => message)).toContain('Each variant once');
  });

  it('keeps the letter case of adjustment ids (part of their idempotency fingerprint)', () => {
    expect(
      addStockSchema.parse({ variantId: upperVariantId, warehouseId, quantity: 1, reason: 'Found' })
        .variantId,
    ).toBe(upperVariantId);
  });
});

describe('dispatch and restock line schemas', () => {
  const shipmentId = randomUUID();
  const returnRequestId = randomUUID();

  it('lower-cases every id of a shipment line', () => {
    expect(
      shipmentStockLinesSchema.parse([
        {
          shipmentId: shipmentId.toUpperCase(),
          variantId: variantId.toUpperCase(),
          warehouseId: warehouseId.toUpperCase(),
          quantity: 2,
        },
      ]),
    ).toEqual([{ shipmentId, variantId, warehouseId, quantity: 2 }]);
  });

  it('refuses no lines, too many lines, a zero quantity and a repeated line in any letter case', () => {
    const line = { shipmentId, ...location, quantity: 1 };
    expect(shipmentStockLinesSchema.safeParse([]).success).toBe(false);
    expect(
      shipmentStockLinesSchema.safeParse(
        Array.from({ length: maximumLinesPerRequest + 1 }, () => ({
          ...line,
          variantId: randomUUID(),
        })),
      ).success,
    ).toBe(false);
    expect(shipmentStockLinesSchema.safeParse([{ ...line, quantity: 0 }]).success).toBe(false);
    const repeated = shipmentStockLinesSchema.safeParse([
      line,
      { ...line, shipmentId: shipmentId.toUpperCase() },
    ]);
    expect(repeated.error?.issues.map(({ message }) => message)).toContain(
      'Each shipment, variant and warehouse once',
    );
  });

  it('takes a customer return line without a warehouse and refuses a repeated variant', () => {
    const line = { returnRequestId: returnRequestId.toUpperCase(), variantId, quantity: 1 };
    expect(customerReturnLinesSchema.parse([line])).toEqual([
      { returnRequestId, variantId, quantity: 1 },
    ]);
    expect(customerReturnLinesSchema.safeParse([{ ...line, warehouseId }]).success).toBe(false);
    const repeated = customerReturnLinesSchema.safeParse([
      line,
      { ...line, variantId: variantId.toUpperCase() },
    ]);
    expect(repeated.error?.issues.map(({ message }) => message)).toContain(
      'Each return request and variant once',
    );
  });
});
