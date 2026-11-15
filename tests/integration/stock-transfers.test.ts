import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { variantIdSchema, warehouseIdSchema } from '@/lib/ids';
import { transferStock } from '@/modules/inventory/stock-transfer.service';

import {
  createStaffMember,
  createStockLevelRow,
  createVariantRow,
  createWarehouseRow,
  inventoryState,
  staffInventoryActor,
  stockedLocation,
  stockLevel,
} from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error instanceof DomainError) return `${String(error.httpStatus)} ${error.code}`;
  if (error instanceof ZodError) return 'validation';
  return String(error);
}

// A variant with `onHandQuantity` (some of it reserved) at a source warehouse and an empty destination.
async function transferSetup(onHandQuantity: number, reservedQuantity = 0) {
  const source = await stockedLocation({ onHandQuantity, reservedQuantity });
  const destination = await createWarehouseRow({ priority: 2 });
  return {
    ...source,
    fromWarehouseId: source.key.warehouseId,
    toWarehouseId: warehouseIdSchema.parse(destination.id),
  };
}

async function totalOnHand(variantId: string): Promise<number> {
  const levels = await database.inventoryLevel.findMany({
    where: { variantId },
    select: { onHandQuantity: true },
  });
  return levels.reduce((total, level) => total + level.onHandQuantity, 0);
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('stock transfer between warehouses (D27)', () => {
  it('moves available units in one transaction with a TRANSFER_OUT and a TRANSFER_IN row; total stays the same', async () => {
    const setup = await transferSetup(10, 2);
    const result = await transferStock(setup.actor, randomUUID(), {
      fromWarehouseId: setup.fromWarehouseId,
      toWarehouseId: setup.toWarehouseId,
      reason: 'Rebalance for the festive sale',
      lines: [{ variantId: setup.key.variantId, quantity: 6 }],
    });
    expect(result).toMatchObject({ operation: 'TRANSFER', replayed: false });
    expect(
      result.movements.map(({ movementType, warehouseId, quantityDelta, onHandAfter }) => ({
        movementType,
        warehouseId,
        quantityDelta,
        onHandAfter,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          movementType: 'TRANSFER_OUT',
          warehouseId: setup.fromWarehouseId,
          quantityDelta: -6,
          onHandAfter: 4,
        },
        {
          movementType: 'TRANSFER_IN',
          warehouseId: setup.toWarehouseId,
          quantityDelta: 6,
          onHandAfter: 6,
        },
      ]),
    );
    expect(result.movements).toHaveLength(2);
    expect(await stockLevel(setup.key)).toMatchObject({ onHandQuantity: 4, reservedQuantity: 2 });
    expect(
      await stockLevel({ variantId: setup.key.variantId, warehouseId: setup.toWarehouseId }),
    ).toMatchObject({ onHandQuantity: 6, reservedQuantity: 0 });
    expect(await totalOnHand(setup.key.variantId)).toBe(10);
    expect(
      await database.auditLog.count({ where: { action: 'inventory.stock_transferred' } }),
    ).toBe(2);
    expect(
      await database.inventoryMovement.count({
        where: { movementType: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] }, reason: { not: null } },
      }),
    ).toBe(2);
    expect(await database.searchOutbox.count()).toBeGreaterThan(0);
  });

  it('never moves reserved units: asking for more than is available is 409 and changes nothing', async () => {
    const setup = await transferSetup(5, 3);
    const before = await inventoryState();
    expect(
      await failure(
        transferStock(setup.actor, randomUUID(), {
          fromWarehouseId: setup.fromWarehouseId,
          toWarehouseId: setup.toWarehouseId,
          reason: 'Too many',
          lines: [{ variantId: setup.key.variantId, quantity: 3 }],
        }),
      ),
    ).toBe('409 OUT_OF_STOCK');
    expect(await inventoryState()).toEqual(before);
  });

  it('is all or nothing across lines: one short line rolls back the others', async () => {
    const setup = await transferSetup(10);
    const second = await createVariantRow();
    await createStockLevelRow({
      variantId: second.variantId,
      warehouseId: setup.fromWarehouseId,
      onHandQuantity: 1,
    });
    const before = await inventoryState();
    expect(
      await failure(
        transferStock(setup.actor, randomUUID(), {
          fromWarehouseId: setup.fromWarehouseId,
          toWarehouseId: setup.toWarehouseId,
          reason: 'Two lines',
          lines: [
            { variantId: setup.key.variantId, quantity: 4 },
            { variantId: variantIdSchema.parse(second.variantId), quantity: 2 },
          ],
        }),
      ),
    ).toBe('409 OUT_OF_STOCK');
    expect(await inventoryState()).toEqual(before);
  });

  it('applies a repeated key once and refuses the key with another body (422)', async () => {
    const setup = await transferSetup(10);
    const key = randomUUID();
    const body = {
      fromWarehouseId: setup.fromWarehouseId,
      toWarehouseId: setup.toWarehouseId,
      reason: 'Retry safe',
      lines: [{ variantId: setup.key.variantId, quantity: 2 }],
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => transferStock(setup.actor, key, body)),
    );
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(await stockLevel(setup.key)).toMatchObject({ onHandQuantity: 8 });
    expect(
      await failure(
        transferStock(setup.actor, key, {
          ...body,
          lines: [{ variantId: setup.key.variantId, quantity: 3 }],
        }),
      ),
    ).toBe('422 IDEMPOTENCY_KEY_REUSED');
  });

  it('10 parallel one-unit transfers of 3 available units move exactly 3 and keep the total (plan test)', async () => {
    const setup = await transferSetup(5, 2);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        failure(
          transferStock(setup.actor, randomUUID(), {
            fromWarehouseId: setup.fromWarehouseId,
            toWarehouseId: setup.toWarehouseId,
            reason: 'Parallel move',
            lines: [{ variantId: setup.key.variantId, quantity: 1 }],
          }),
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === 'null')).toHaveLength(3);
    expect(outcomes.filter((outcome) => outcome === '409 OUT_OF_STOCK')).toHaveLength(7);
    expect(await stockLevel(setup.key)).toMatchObject({ onHandQuantity: 2, reservedQuantity: 2 });
    expect(await totalOnHand(setup.key.variantId)).toBe(5);
    expect(await database.inventoryMovement.count()).toBe(6);
  });

  it('two opposite transfers at once never deadlock and keep the total', async () => {
    const setup = await transferSetup(10);
    await createStockLevelRow({
      variantId: setup.key.variantId,
      warehouseId: setup.toWarehouseId,
      onHandQuantity: 10,
    });
    const move = (fromWarehouseId: string, toWarehouseId: string) =>
      transferStock(setup.actor, randomUUID(), {
        fromWarehouseId: warehouseIdSchema.parse(fromWarehouseId),
        toWarehouseId: warehouseIdSchema.parse(toWarehouseId),
        reason: 'Crossing',
        lines: [{ variantId: setup.key.variantId, quantity: 1 }],
      });
    await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        index % 2 === 0
          ? move(setup.fromWarehouseId, setup.toWarehouseId)
          : move(setup.toWarehouseId, setup.fromWarehouseId),
      ),
    );
    expect(await totalOnHand(setup.key.variantId)).toBe(20);
  });

  it('refuses the same warehouse (validation), an unknown warehouse (404) and staff without inventory.write (403)', async () => {
    const setup = await transferSetup(10);
    const line = [{ variantId: setup.key.variantId, quantity: 1 }];
    expect(
      await failure(
        transferStock(setup.actor, randomUUID(), {
          fromWarehouseId: setup.fromWarehouseId,
          toWarehouseId: setup.fromWarehouseId,
          reason: 'Same',
          lines: line,
        }),
      ),
    ).toBe('validation');
    expect(
      await failure(
        transferStock(setup.actor, randomUUID(), {
          fromWarehouseId: setup.fromWarehouseId,
          toWarehouseId: warehouseIdSchema.parse('0195f2a0-0000-7000-8000-000000000999'),
          reason: 'Unknown',
          lines: line,
        }),
      ),
    ).toBe('404 WAREHOUSE_NOT_FOUND');
    const reader = staffInventoryActor(await createStaffMember(['inventory.read']));
    expect(
      await failure(
        transferStock(reader, randomUUID(), {
          fromWarehouseId: setup.fromWarehouseId,
          toWarehouseId: setup.toWarehouseId,
          reason: 'Not allowed',
          lines: line,
        }),
      ),
    ).toBe('403 PERMISSION_DENIED');
  });
});
