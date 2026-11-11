import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type DatabaseClient, getDatabase } from '@/lib/db';
import { receiveStockSchema } from '@/modules/inventory/inventory.schema';
import { lockStockLevels } from '@/modules/inventory/stock-level.repository';
import { addStock, removeStock, setStock } from '@/modules/inventory/stock-adjustment.service';
import { receiveStock } from '@/modules/inventory/stock-receipt.service';
import type { StockRequestResult } from '@/modules/inventory/stock-request-result';

import { inventoryState, stockedLocation, stockLevel } from './support/inventory-fixtures';
import { backendProcessId, waitForWaiterOn } from './support/lock-probes';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

function withoutReplayFlag(result: StockRequestResult) {
  return { ...result, replayed: false };
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('replaying a repeated request', () => {
  it('returns the original result for the same key and content, applying the stock change once', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const idempotencyKey = randomUUID();
    const request = { ...key, quantity: 4, reason: 'Found in aisle 4' };
    const original = await addStock(actor, idempotencyKey, request);
    const replay = await addStock(actor, idempotencyKey, request);

    expect(original.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(withoutReplayFlag(replay)).toEqual(original);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 14 });
    expect(await inventoryState()).toMatchObject({
      movements: 1,
      changeRequests: 1,
      inventoryAudits: 1,
      outbox: 1,
    });
  });

  it('replays the original values even after later changes to the same stock', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const idempotencyKey = randomUUID();
    const request = { ...key, quantity: 3, reason: 'Damaged' };
    const original = await removeStock(actor, idempotencyKey, request);
    await addStock(actor, randomUUID(), { ...key, quantity: 50, reason: 'Delivery' });
    const replay = await removeStock(actor, idempotencyKey, request);
    expect(replay.movements[0]).toMatchObject({ onHandBefore: 10, onHandAfter: 7 });
    expect(withoutReplayFlag(replay)).toEqual(original);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 57 });
  });

  it('replays a receipt whatever the order of its lines in the repeat', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 0 });
    const other = await stockedLocation({ onHandQuantity: 0 });
    const idempotencyKey = randomUUID();
    const lines = [
      { variantId: key.variantId, quantity: 2 },
      { variantId: other.key.variantId, quantity: 5 },
    ];
    const receipt = (orderedLines: typeof lines) =>
      receiveStockSchema.parse({
        warehouseId: key.warehouseId,
        supplierReference: 'INV-9',
        lines: orderedLines,
      });
    const original = await receiveStock(actor, idempotencyKey, receipt(lines));
    const replay = await receiveStock(actor, idempotencyKey, receipt([...lines].reverse()));
    expect(replay.replayed).toBe(true);
    expect(withoutReplayFlag(replay)).toEqual(original);
    expect(await database.inventoryMovement.count()).toBe(2);
  });

  it('refuses the same key with different content, or for another operation (422), changing nothing', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const idempotencyKey = randomUUID();
    await addStock(actor, idempotencyKey, { ...key, quantity: 4, reason: 'Found' });
    const before = await inventoryState();
    for (const attempt of [
      () => addStock(actor, idempotencyKey, { ...key, quantity: 5, reason: 'Found' }),
      () => addStock(actor, idempotencyKey, { ...key, quantity: 4, reason: 'Found again' }),
      () => removeStock(actor, idempotencyKey, { ...key, quantity: 4, reason: 'Found' }),
      () =>
        setStock(actor, idempotencyKey, {
          ...key,
          expectedOnHandQuantity: 14,
          newOnHandQuantity: 4,
          reason: 'Found',
        }),
      () =>
        receiveStock(
          actor,
          idempotencyKey,
          receiveStockSchema.parse({
            warehouseId: key.warehouseId,
            supplierReference: 'Found',
            lines: [{ variantId: key.variantId, quantity: 4 }],
          }),
        ),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: 'IDEMPOTENCY_KEY_REUSED',
        httpStatus: 422,
      });
    }
    expect(await inventoryState()).toEqual(before);
  });

  it('treats a new key as a new, intentional change, even with identical content', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const request = { ...key, quantity: 2, reason: 'Found' };
    const first = await addStock(actor, randomUUID(), request);
    const second = await addStock(actor, randomUUID(), request);
    expect(first.changeRequestId).not.toBe(second.changeRequestId);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 14 });
    expect(await inventoryState()).toMatchObject({
      movements: 2,
      changeRequests: 2,
      inventoryAudits: 2,
    });
  });

  it('scopes keys to the staff member: a colleague using the same key makes a separate change', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const { actor: colleague } = await stockedLocation();
    const idempotencyKey = randomUUID();
    await addStock(actor, idempotencyKey, { ...key, quantity: 1, reason: 'Found' });
    const theirs = await addStock(colleague, idempotencyKey, {
      ...key,
      quantity: 1,
      reason: 'Found',
    });
    expect(theirs.replayed).toBe(false);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 12 });
  });
});

describe('concurrent duplicates', () => {
  it('applies one of ten simultaneous identical requests and replays the other nine', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const idempotencyKey = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        addStock(actor, idempotencyKey, { ...key, quantity: 3, reason: 'Delivery' }),
      ),
    );
    expect(results.filter(({ replayed }) => !replayed)).toHaveLength(1);
    const [applied] = results.filter(({ replayed }) => !replayed);
    if (applied === undefined) throw new Error('one applied result expected');
    for (const result of results) expect(withoutReplayFlag(result)).toEqual(applied);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 13 });
    expect(await inventoryState()).toMatchObject({
      movements: 1,
      changeRequests: 1,
      inventoryAudits: 1,
    });
  });

  it('applies exactly one of two simultaneous requests sharing a key but not their content; the other gets 422', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const idempotencyKey = randomUUID();
    const results = await Promise.allSettled([
      addStock(actor, idempotencyKey, { ...key, quantity: 3, reason: 'Delivery' }),
      addStock(actor, idempotencyKey, { ...key, quantity: 5, reason: 'Delivery' }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    const level = await stockLevel(key);
    expect([13, 15]).toContain(level?.onHandQuantity);
    expect(await database.inventoryMovement.count()).toBe(1);
  });

  async function holdStockRow(key: { variantId: string; warehouseId: string }) {
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<
      'commit' | ((transaction: DatabaseClient) => Promise<unknown>)
    >();
    const done = database.$transaction(
      async (transaction) => {
        await lockStockLevels(transaction, [key]);
        ready.resolve(await backendProcessId(transaction));
        const action = await release.promise;
        if (action !== 'commit') await action(transaction);
      },
      { timeout: 20_000 },
    );
    return { holderPid: await ready.promise, release: release.resolve, done };
  }

  it('makes a duplicate wait for the first request, which waits on the stock row, then replays it', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const idempotencyKey = randomUUID();
    const request = { ...key, quantity: 4, reason: 'Delivery' };
    const holder = await holdStockRow(key);

    const first = addStock(actor, idempotencyKey, request);
    const firstPid = await waitForWaiterOn(holder.holderPid);
    const duplicate = addStock(actor, idempotencyKey, request);
    const duplicatePid = await waitForWaiterOn(firstPid);
    expect(duplicatePid).not.toBe(firstPid);
    // The first request already holds its request row (L1) while it waits on the stock row (L5).
    expect(await database.inventoryChangeRequest.count()).toBe(0);

    holder.release('commit');
    await holder.done;
    const [applied, replayed] = await Promise.all([first, duplicate]);
    expect(applied.replayed).toBe(false);
    expect(replayed.replayed).toBe(true);
    expect(withoutReplayFlag(replayed)).toEqual(applied);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 14 });
    expect(await inventoryState()).toMatchObject({ movements: 1, changeRequests: 1 });
  });

  it('runs the waiting duplicate as a new request when the first rolls back, leaving no request row', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10, reservedQuantity: 8 });
    const idempotencyKey = randomUUID();
    const request = { ...key, quantity: 2, reason: 'Damaged' };
    const holder = await holdStockRow(key);

    const first = removeStock(actor, idempotencyKey, request).then(
      () => 'applied' as const,
      (error: unknown) => error,
    );
    const firstPid = await waitForWaiterOn(holder.holderPid);
    const duplicate = removeStock(actor, idempotencyKey, request).then(
      (result) => result,
      (error: unknown) => error,
    );
    await waitForWaiterOn(firstPid);

    // While both wait, the holder lowers on hand to the reserved quantity, so the removal can no longer fit.
    holder.release(async (transaction) => {
      await transaction.$executeRaw`
        UPDATE inventory_levels SET on_hand_quantity = reserved_quantity
        WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid`;
    });
    await holder.done;

    expect(await first).toMatchObject({ code: 'STOCK_BELOW_RESERVED' });
    // Not a replay: the duplicate ran on its own and reached its own outcome against the new stock.
    expect(await duplicate).toMatchObject({
      code: 'STOCK_BELOW_RESERVED',
      details: { onHandQuantity: 8, reservedQuantity: 8, requestedOnHandQuantity: 6 },
    });
    expect(await inventoryState()).toMatchObject({
      movements: 0,
      changeRequests: 0,
      inventoryAudits: 0,
    });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 8, reservedQuantity: 8 });
  });

  it('stores nothing for a key whose only attempt failed, so a later retry applies it', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 3, reservedQuantity: 3 });
    const idempotencyKey = randomUUID();
    const request = { ...key, quantity: 1, reason: 'Damaged' };
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => removeStock(actor, idempotencyKey, request)),
    );
    expect(attempts.every(({ status }) => status === 'rejected')).toBe(true);
    expect(await database.inventoryChangeRequest.count()).toBe(0);
    await database.inventoryLevel.update({
      where: { variantId_warehouseId: key },
      data: { onHandQuantity: 6 },
    });
    const retried = await removeStock(actor, idempotencyKey, request);
    expect(retried.replayed).toBe(false);
    expect(z.number().parse((await stockLevel(key))?.onHandQuantity)).toBe(5);
  });
});
