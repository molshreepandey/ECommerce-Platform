import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { getDatabase, isTransactionTimeout } from '@/lib/db';
import {
  listMovementsSchema,
  listStockLevelsSchema,
  maximumOnHandQuantity,
  receiveStockSchema,
} from '@/modules/inventory/inventory.schema';
import { listMovements, listStockLevels } from '@/modules/inventory/inventory-query.service';
import { setLowStockThreshold } from '@/modules/inventory/low-stock-threshold.service';
import { addStock, removeStock, setStock } from '@/modules/inventory/stock-adjustment.service';
import { receiveStock } from '@/modules/inventory/stock-receipt.service';

import {
  createStockLevelRow,
  createVariantRow,
  inventoryState,
  stockedLocation,
  stockLevel,
} from './support/inventory-fixtures';
import { backendProcessId, waitUntilSomeoneWaitsOn } from './support/lock-probes';
import { truncateAllTestTables } from './support/test-database';

// Rules added with the admin inventory API (Wave 5 step 3): the on-hand ceiling (L44), receipt input
// normalised inside the service (L45), cursors that must exist (L37) and the transaction timeout (L43).

const database = getDatabase();
const unknownId = '0195f2a0-0000-7000-8000-000000000999';

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('on-hand ceiling for add and receipt (same as set)', () => {
  it('adds up to the ceiling exactly, refuses one more (422) and still allows removals', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: maximumOnHandQuantity - 3 });
    await addStock(actor, randomUUID(), { ...key, quantity: 3, reason: 'Top up' });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: maximumOnHandQuantity });

    const before = await inventoryState();
    await expect(
      addStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'One too many' }),
    ).rejects.toMatchObject({
      code: 'ON_HAND_LIMIT_EXCEEDED',
      details: {
        onHandQuantity: maximumOnHandQuantity,
        requestedOnHandQuantity: maximumOnHandQuantity + 1,
        maximumOnHandQuantity,
      },
    });
    expect(await inventoryState()).toEqual(before);

    await removeStock(actor, randomUUID(), { ...key, quantity: 10, reason: 'Damaged' });
    await setStock(actor, randomUUID(), {
      ...key,
      expectedOnHandQuantity: maximumOnHandQuantity - 10,
      newOnHandQuantity: maximumOnHandQuantity,
      reason: 'Recount',
    });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: maximumOnHandQuantity });
  });

  it('refuses a whole receipt when one line would pass the ceiling, applying none of it', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 5 });
    const second = await createVariantRow();
    await createStockLevelRow({
      variantId: second.variantId,
      warehouseId: key.warehouseId,
      onHandQuantity: maximumOnHandQuantity - 1,
    });
    const before = await inventoryState();
    await expect(
      receiveStock(
        actor,
        randomUUID(),
        receiveStockSchema.parse({
          warehouseId: key.warehouseId,
          supplierReference: 'INV-CEILING',
          lines: [
            { variantId: key.variantId, quantity: 10 },
            { variantId: second.variantId, quantity: 2 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'ON_HAND_LIMIT_EXCEEDED' });
    expect(await inventoryState()).toEqual(before);
  });
});

describe('receipt input is normalised inside the service', () => {
  it('replays a receipt sent with unsorted lines and an untrimmed reference, not parsed by the caller', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 0 });
    const second = await createVariantRow();
    const lines = [
      { variantId: key.variantId, quantity: 2 },
      { variantId: second.variantId, quantity: 3 },
    ].sort((left, right) => right.variantId.localeCompare(left.variantId));
    const idempotencyKey = randomUUID();
    const first = await receiveStock(actor, idempotencyKey, {
      warehouseId: key.warehouseId,
      supplierReference: 'INV-77',
      lines: receiveStockSchema.shape.lines.parse(lines),
    });
    // Built by hand, as a caller that skipped the schema would: reversed lines, padded reference.
    const raw = {
      warehouseId: key.warehouseId,
      supplierReference: '  INV-77  ',
      lines: [...lines].reverse(),
    } as unknown as Parameters<typeof receiveStock>[2];
    const repeat = await receiveStock(actor, idempotencyKey, raw);
    expect(repeat).toMatchObject({ replayed: true, changeRequestId: first.changeRequestId });
    expect(await database.inventoryMovement.count()).toBe(2);
  });
});

describe('adjustment input is validated inside the service (L53)', () => {
  it('replays a padded repeat, refuses invalid input before writing, and keeps 422 for a zero change', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 5 });
    const idempotencyKey = randomUUID();
    const first = await addStock(actor, idempotencyKey, {
      ...key,
      quantity: 2,
      reason: 'Found two',
    });
    // Built by hand, as a caller that skipped the schema would: a padded reason, keys in another order.
    const padded = { reason: '  Found two  ', quantity: 2, ...key };
    const repeat = await addStock(actor, idempotencyKey, padded);
    expect(repeat).toMatchObject({ replayed: true, changeRequestId: first.changeRequestId });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 7 });

    const before = await inventoryState();
    for (const input of [
      { ...key, quantity: 1, reason: 'Extra field', note: 'not allowed' },
      { ...key, quantity: 1.5, reason: 'Fraction' },
      { ...key, quantity: -1, reason: 'Negative' },
      { ...key, quantity: 1, reason: '  ' },
      { ...key, variantId: 'not-a-uuid', quantity: 1, reason: 'Bad id' },
    ]) {
      await expect(
        addStock(actor, randomUUID(), input as unknown as Parameters<typeof addStock>[2]),
        JSON.stringify(input),
      ).rejects.toBeInstanceOf(ZodError);
    }
    await expect(
      setStock(actor, randomUUID(), {
        ...key,
        expectedOnHandQuantity: 7,
        newOnHandQuantity: 7,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'NO_STOCK_CHANGE', httpStatus: 422 });
    await expect(
      addStock(actor, randomUUID(), { ...key, quantity: 0, reason: 'Count' }),
    ).rejects.toMatchObject({ code: 'NO_STOCK_CHANGE', httpStatus: 422 });
    expect(await inventoryState()).toEqual(before);
  });
});

describe('upper-case ids in receipts and thresholds (PostgreSQL returns lower case)', () => {
  it('receives stock and sets a threshold for an existing variant named in upper case, by any caller', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 4 });
    const upper = {
      variantId: key.variantId.toUpperCase(),
      warehouseId: key.warehouseId.toUpperCase(),
    } as unknown as typeof key;
    const receipt = await receiveStock(actor, randomUUID(), {
      warehouseId: upper.warehouseId,
      supplierReference: 'PO-UPPER',
      lines: [{ variantId: upper.variantId, quantity: 3 }],
    });
    expect(receipt.movements).toEqual([
      expect.objectContaining({ ...key, quantityDelta: 3, onHandBefore: 4, onHandAfter: 7 }),
    ]);
    const threshold = await setLowStockThreshold(actor, { ...upper, lowStockThreshold: 9 });
    expect(threshold).toMatchObject({
      changed: true,
      stockLevel: { ...key, lowStockThreshold: 9 },
    });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 7, lowStockThreshold: 9 });
  });
});

describe('page cursors must exist', () => {
  it('answers 400 INVALID_CURSOR for an unknown stock-matrix or ledger cursor', async () => {
    const { staff, actor, key } = await stockedLocation({ onHandQuantity: 1 });
    await addStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'Found' });
    await expect(
      listStockLevels(staff, listStockLevelsSchema.parse({ cursor: unknownId })),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR', httpStatus: 400 });
    await expect(
      listMovements(staff, listMovementsSchema.parse({ cursor: unknownId })),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR', httpStatus: 400 });
  });
});

describe('transaction timeout', () => {
  it('fails a stock request that outlives the transaction timeout as P2028, leaving nothing behind', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 4 });
    const before = await inventoryState();
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holderPid = 0;
    let holderReady = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      holderReady = resolve;
    });
    const holder = database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT 1 FROM inventory_levels WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid FOR UPDATE`;
        holderPid = await backendProcessId(transaction);
        holderReady();
        await released;
      },
      { timeout: 25_000 },
    );
    await ready;
    const attempt = addStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'Late' }).then(
      () => null,
      (error: unknown) => error,
    );
    await waitUntilSomeoneWaitsOn(holderPid);
    // Prisma's default interactive-transaction timeout is 5 seconds.
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    release();
    await holder;
    const error = await attempt;
    expect(isTransactionTimeout(error), String(error)).toBe(true);
    expect(String(error)).toMatch(/cannot be executed on an expired transaction/);
    expect(await inventoryState()).toEqual(before);
  }, 30_000);
});
