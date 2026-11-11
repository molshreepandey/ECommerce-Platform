import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';

import { getDatabase } from '@/lib/db';
import { variantIdSchema, warehouseIdSchema } from '@/lib/ids';
import { receiveStockSchema } from '@/modules/inventory/inventory.schema';
import { addStock, removeStock, setStock } from '@/modules/inventory/stock-adjustment.service';
import { receiveStock } from '@/modules/inventory/stock-receipt.service';

import { dependentRecords } from './support/dependent-records';
import {
  createStaffMember,
  createStockLevelRow,
  createVariantRow,
  inventoryState,
  staffInventoryActor,
  stockedLocation,
  stockLevel,
} from './support/inventory-fixtures';
import { assertConnectedDatabaseName } from '../support/test-target-guard';
import { currentDatabaseName, truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const unknownId = '0195f2a0-0000-7000-8000-000000000999';
const unknownVariantId = variantIdSchema.parse(unknownId);
const unknownWarehouseId = warehouseIdSchema.parse(unknownId);
const nearIntegerLimit = 2_147_483_600;

function movementAudits() {
  return database.auditLog.findMany({
    where: { entityType: 'inventory_movement' },
    select: {
      action: true,
      entityId: true,
      actorType: true,
      actorId: true,
      ipAddress: true,
      requestId: true,
      before: true,
      after: true,
    },
  });
}

// Test-only trigger and function for the database-failure rollback test (ecommerce_test only).
async function dropTestOnlyTrigger(): Promise<void> {
  await database.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS test_refuse_second_line ON inventory_levels',
  );
  await database.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_refuse_second_line()');
}

async function testOnlyTriggerObjects(): Promise<{ triggers: number; functions: number }> {
  const [row] = z.tuple([z.object({ triggers: z.number(), functions: z.number() })]).parse(
    await database.$queryRaw`
        SELECT (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'test_refuse_second_line') AS triggers,
               (SELECT count(*)::int FROM pg_proc WHERE proname = 'test_refuse_second_line') AS functions`,
  );
  return row;
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('adding and removing stock (ADJUSTMENT)', () => {
  it('adds stock with one ADJUSTMENT movement, its audit row, a search update and a request row', async () => {
    const { actor, key, productId } = await stockedLocation({
      onHandQuantity: 10,
      reservedQuantity: 2,
    });
    const result = await addStock(actor, randomUUID(), {
      ...key,
      quantity: 5,
      reason: 'Found in aisle 4',
    });

    expect(result).toMatchObject({ operation: 'ADJUST_ADD', replayed: false });
    expect(result.movements).toEqual([
      expect.objectContaining({
        ...key,
        movementType: 'ADJUSTMENT',
        quantityDelta: 5,
        onHandBefore: 10,
        onHandAfter: 15,
        reservedBefore: 2,
        reservedAfter: 2,
        availableAfter: 13,
        reason: 'Found in aisle 4',
      }),
    ]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 15, reservedQuantity: 2 });

    const [movement] = await database.inventoryMovement.findMany();
    expect(movement).toMatchObject({
      referenceType: 'inventory_change_request',
      referenceId: result.changeRequestId,
      actorType: 'STAFF',
      actorId: actor.staff.staffUserId,
    });
    const [audit] = await movementAudits();
    expect(audit).toMatchObject({
      action: 'inventory.stock_added',
      entityId: movement?.id,
      actorType: 'STAFF',
      actorId: actor.staff.staffUserId,
      ipAddress: actor.metadata.clientIp,
      requestId: actor.metadata.requestId,
      before: { onHandQuantity: 10, reservedQuantity: 2 },
      after: {
        onHandQuantity: 15,
        quantityDelta: 5,
        movementType: 'ADJUSTMENT',
        reason: 'Found in aisle 4',
        changeRequestId: result.changeRequestId,
      },
    });
    expect(await database.searchOutbox.findMany({ select: { entityId: true } })).toEqual([
      { entityId: productId },
    ]);
    expect(await database.inventoryChangeRequest.count()).toBe(1);
  });

  it('creates a missing stock row when adding', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: null });
    await addStock(actor, randomUUID(), { ...key, quantity: 3, reason: 'First delivery count' });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 3, reservedQuantity: 0 });
  });

  it('removes stock, but never below what is reserved, and then leaves nothing behind', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10, reservedQuantity: 4 });
    const removed = await removeStock(actor, randomUUID(), {
      ...key,
      quantity: 6,
      reason: 'Water damage',
    });
    expect(removed.movements[0]).toMatchObject({
      quantityDelta: -6,
      onHandAfter: 4,
      availableAfter: 0,
    });

    const before = await inventoryState();
    await expect(
      removeStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'Water damage' }),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_RESERVED',
      httpStatus: 409,
      details: { onHandQuantity: 4, reservedQuantity: 4, requestedOnHandQuantity: 3 },
    });
    expect(await inventoryState()).toEqual(before);
  });

  it('refuses to remove from a stock row that does not exist, without creating one', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: null });
    const before = await inventoryState();
    await expect(
      removeStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'Count' }),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_RESERVED',
    });
    expect(await inventoryState()).toEqual(before);
  });

  it('refuses a zero change (422) before any transaction, leaving no request row', async () => {
    const { actor, key } = await stockedLocation();
    const before = await inventoryState();
    for (const attempt of [
      () => addStock(actor, randomUUID(), { ...key, quantity: 0, reason: 'Count' }),
      () => removeStock(actor, randomUUID(), { ...key, quantity: 0, reason: 'Count' }),
      () =>
        setStock(actor, randomUUID(), {
          ...key,
          expectedOnHandQuantity: 10,
          newOnHandQuantity: 10,
          reason: 'Count',
        }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'NO_STOCK_CHANGE', httpStatus: 422 });
    }
    expect(await inventoryState()).toEqual(before);
  });

  it('answers 404 for an unknown variant or warehouse, and refuses a malformed key', async () => {
    const { actor, key } = await stockedLocation();
    await expect(
      addStock(actor, randomUUID(), {
        ...key,
        variantId: unknownVariantId,
        quantity: 1,
        reason: 'Count',
      }),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND', httpStatus: 404 });
    await expect(
      removeStock(actor, randomUUID(), {
        ...key,
        warehouseId: unknownWarehouseId,
        quantity: 1,
        reason: 'Count',
      }),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND', httpStatus: 404 });
    await expect(
      addStock(actor, 'short', { ...key, quantity: 1, reason: 'Count' }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await database.inventoryChangeRequest.count()).toBe(0);
  });

  it('accepts physical changes for archived variants and inactive warehouses (owner decision)', async () => {
    for (const statuses of [
      { productStatus: 'ARCHIVED', variantStatus: 'ARCHIVED' },
      { warehouseActive: false },
    ] as const) {
      const { actor, key } = await stockedLocation({ onHandQuantity: 5, ...statuses });
      await addStock(actor, randomUUID(), { ...key, quantity: 2, reason: 'Found during audit' });
      await removeStock(actor, randomUUID(), { ...key, quantity: 7, reason: 'Written off' });
      expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 0 });
    }
  });
});

describe('setting stock to a counted quantity (ADJUSTMENT)', () => {
  it('sets on hand when the expected previous quantity still matches', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10, reservedQuantity: 3 });
    const result = await setStock(actor, randomUUID(), {
      ...key,
      expectedOnHandQuantity: 10,
      newOnHandQuantity: 7,
      reason: 'Cycle count',
    });
    expect(result.movements[0]).toMatchObject({
      movementType: 'ADJUSTMENT',
      quantityDelta: -3,
      onHandBefore: 10,
      onHandAfter: 7,
    });
    const [audit] = await movementAudits();
    expect(audit?.action).toBe('inventory.stock_set');
  });

  it('refuses a stale expected quantity (409 STALE_STOCK) and a new quantity below reserved, leaving nothing behind', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10, reservedQuantity: 3 });
    const before = await inventoryState();
    await expect(
      setStock(actor, randomUUID(), {
        ...key,
        expectedOnHandQuantity: 9,
        newOnHandQuantity: 12,
        reason: 'Count',
      }),
    ).rejects.toMatchObject({
      code: 'STALE_STOCK',
      httpStatus: 409,
      details: { expectedOnHandQuantity: 9, currentOnHandQuantity: 10 },
    });
    await expect(
      setStock(actor, randomUUID(), {
        ...key,
        expectedOnHandQuantity: 10,
        newOnHandQuantity: 2,
        reason: 'Count',
      }),
    ).rejects.toMatchObject({
      code: 'STOCK_BELOW_RESERVED',
    });
    expect(await inventoryState()).toEqual(before);
  });

  it('treats a missing stock row as 0 on hand: expected 0 sets it, any other expected value is stale', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: null });
    await expect(
      setStock(actor, randomUUID(), {
        ...key,
        expectedOnHandQuantity: 4,
        newOnHandQuantity: 9,
        reason: 'Count',
      }),
    ).rejects.toMatchObject({ code: 'STALE_STOCK' });
    expect(await stockLevel(key)).toBeNull();
    await setStock(actor, randomUUID(), {
      ...key,
      expectedOnHandQuantity: 0,
      newOnHandQuantity: 9,
      reason: 'Opening count',
    });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 9 });
  });
});

describe('receiving stock from a supplier (RECEIPT)', () => {
  async function receivingSetup() {
    const location = await stockedLocation({ onHandQuantity: 4, reservedQuantity: 1 });
    const second = await createVariantRow();
    return { ...location, secondVariantId: second.variantId };
  }

  it('records RECEIPT movements only, with the supplier reference, one audit row each', async () => {
    const { actor, key, secondVariantId } = await receivingSetup();
    const input = receiveStockSchema.parse({
      warehouseId: key.warehouseId,
      supplierReference: ' INV-2026-114 ',
      lines: [
        { variantId: key.variantId, quantity: 6 },
        { variantId: secondVariantId, quantity: 12 },
      ],
    });
    const result = await receiveStock(actor, randomUUID(), input);
    expect(result.operation).toBe('RECEIPT');
    expect(result.movements).toHaveLength(2);
    expect(result.movements.every(({ movementType }) => movementType === 'RECEIPT')).toBe(true);
    expect(result.movements.map(({ variantId }) => variantId)).toEqual(
      [key.variantId, secondVariantId].sort(),
    );

    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 1 });
    expect(
      await stockLevel({ variantId: secondVariantId, warehouseId: key.warehouseId }),
    ).toMatchObject({ onHandQuantity: 12 });
    const movements = await database.inventoryMovement.findMany({
      select: { movementType: true, reason: true },
    });
    expect(movements).toEqual([
      { movementType: 'RECEIPT', reason: 'INV-2026-114' },
      { movementType: 'RECEIPT', reason: 'INV-2026-114' },
    ]);
    expect(await database.inventoryMovement.count({ where: { movementType: 'ADJUSTMENT' } })).toBe(
      0,
    );
    const audits = await movementAudits();
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        action: 'inventory.stock_received',
        actorId: actor.staff.staffUserId,
      });
      expect(audit.after).toMatchObject({
        supplierReference: 'INV-2026-114',
        movementType: 'RECEIPT',
      });
    }
  });

  it('accepts receipts into an inactive warehouse and for an archived variant', async () => {
    const inactive = await stockedLocation({ onHandQuantity: 0, warehouseActive: false });
    await receiveStock(
      inactive.actor,
      randomUUID(),
      receiveStockSchema.parse({
        warehouseId: inactive.key.warehouseId,
        supplierReference: 'INV-1',
        lines: [{ variantId: inactive.key.variantId, quantity: 3 }],
      }),
    );
    const archived = await stockedLocation({
      onHandQuantity: 0,
      productStatus: 'ARCHIVED',
      variantStatus: 'ARCHIVED',
    });
    await receiveStock(
      archived.actor,
      randomUUID(),
      receiveStockSchema.parse({
        warehouseId: archived.key.warehouseId,
        supplierReference: 'INV-2',
        lines: [{ variantId: archived.key.variantId, quantity: 3 }],
      }),
    );
    expect(await stockLevel(inactive.key)).toMatchObject({ onHandQuantity: 3 });
    expect(await stockLevel(archived.key)).toMatchObject({ onHandQuantity: 3 });
  });

  it('answers 404 for an unknown variant or warehouse, applying nothing', async () => {
    const { actor, key } = await receivingSetup();
    const before = await inventoryState();
    await expect(
      receiveStock(
        actor,
        randomUUID(),
        receiveStockSchema.parse({
          warehouseId: key.warehouseId,
          supplierReference: 'INV-1',
          lines: [
            { variantId: key.variantId, quantity: 1 },
            { variantId: unknownVariantId, quantity: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND' });
    await expect(
      receiveStock(
        actor,
        randomUUID(),
        receiveStockSchema.parse({
          warehouseId: unknownId,
          supplierReference: 'INV-1',
          lines: [{ variantId: key.variantId, quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND' });
    expect(await inventoryState()).toEqual(before);
  });
});

describe('atomicity: a failure part-way leaves nothing behind', () => {
  it('rolls back a receipt whose second line is refused after the first line changed', async () => {
    const staff = await createStaffMember(['inventory.write']);
    const actor = staffInventoryActor(staff);
    const { key } = await stockedLocation({ onHandQuantity: 5 });
    const second = await createVariantRow();
    // The second line (in variant order) would overflow PostgreSQL's integer; the on-hand ceiling (L44)
    // refuses it after the first line was applied, so the rollback of the first line is what is tested.
    const [firstVariant, lastVariant] = [key.variantId, second.variantId].sort();
    if (firstVariant === undefined || lastVariant === undefined)
      throw new Error('two variants expected');
    if (lastVariant === key.variantId) {
      await database.inventoryLevel.update({
        where: { variantId_warehouseId: key },
        data: { onHandQuantity: nearIntegerLimit },
      });
      await createStockLevelRow({
        variantId: second.variantId,
        warehouseId: key.warehouseId,
        onHandQuantity: 5,
      });
    } else {
      await createStockLevelRow({
        variantId: second.variantId,
        warehouseId: key.warehouseId,
        onHandQuantity: nearIntegerLimit,
      });
    }
    const before = await inventoryState();
    const idempotencyKey = randomUUID();
    const input = receiveStockSchema.parse({
      warehouseId: key.warehouseId,
      supplierReference: 'INV-OVERFLOW',
      lines: [
        { variantId: firstVariant, quantity: 10 },
        { variantId: lastVariant, quantity: 100 },
      ],
    });
    await expect(receiveStock(actor, idempotencyKey, input)).rejects.toMatchObject({
      code: 'ON_HAND_LIMIT_EXCEEDED',
    });
    expect(await inventoryState()).toEqual(before);
    expect(await database.auditLog.count()).toBe(0);
  });

  it('rolls back a receipt when PostgreSQL itself fails on the second line after the first was applied', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 5 });
    const second = await createVariantRow();
    await createStockLevelRow({
      variantId: second.variantId,
      warehouseId: key.warehouseId,
      onHandQuantity: 5,
    });
    const [firstVariant, lastVariant] = [key.variantId, second.variantId].sort();
    if (firstVariant === undefined || lastVariant === undefined)
      throw new Error('two variants expected');
    // A test-only trigger on ecommerce_test makes PostgreSQL raise an error while updating the second
    // line's row (lines run in variant order). It first checks, inside the same transaction, whether the
    // first line's update is already visible, and says so in the error, so the test proves the failure
    // came after the first line changed.
    const idempotencyKey = randomUUID();
    const input = receiveStockSchema.parse({
      warehouseId: key.warehouseId,
      supplierReference: 'INV-DB-FAILURE',
      lines: [
        { variantId: firstVariant, quantity: 10 },
        { variantId: lastVariant, quantity: 10 },
      ],
    });
    assertConnectedDatabaseName(await currentDatabaseName());
    await dropTestOnlyTrigger(); // leftovers of an interrupted earlier run
    let testPassed = false;
    try {
      await database.$executeRawUnsafe(`
        CREATE FUNCTION test_refuse_second_line() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM inventory_levels WHERE variant_id = '${firstVariant}'::uuid
                     AND warehouse_id = '${key.warehouseId}'::uuid AND on_hand_quantity = 15) THEN
            RAISE EXCEPTION 'injected failure: first line already applied';
          END IF;
          RAISE EXCEPTION 'injected failure: first line not applied';
        END $$`);
      await database.$executeRawUnsafe(`
        CREATE TRIGGER test_refuse_second_line BEFORE UPDATE ON inventory_levels FOR EACH ROW
        WHEN (NEW.variant_id = '${lastVariant}'::uuid) EXECUTE FUNCTION test_refuse_second_line()`);
      const before = await inventoryState();
      await expect(receiveStock(actor, idempotencyKey, input)).rejects.toThrow(
        /injected failure: first line already applied/,
      );
      expect(await inventoryState()).toEqual(before);
      expect(await database.inventoryChangeRequest.count()).toBe(0);
      expect(await database.auditLog.count()).toBe(0);
      testPassed = true;
    } finally {
      // Removes whatever was created, even after a partial failure. A cleanup error is raised only when
      // the test itself passed, so it never hides the original failure (the next run cleans up first).
      try {
        await dropTestOnlyTrigger();
      } catch (cleanupError) {
        if (testPassed) throw cleanupError;
      }
    }
    expect(await testOnlyTriggerObjects()).toEqual({ triggers: 0, functions: 0 });
    // With the cause gone, the same key runs as a new request and applies both lines once.
    const retried = await receiveStock(actor, idempotencyKey, input);
    expect(retried.replayed).toBe(false);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 15 });
    expect(
      await stockLevel({ variantId: second.variantId, warehouseId: key.warehouseId }),
    ).toMatchObject({ onHandQuantity: 15 });
  });

  it('leaves no request row after a failure, so the same key can run again once the cause is fixed', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 2, reservedQuantity: 2 });
    const idempotencyKey = randomUUID();
    const removal = { ...key, quantity: 2, reason: 'Damaged' };
    await expect(removeStock(actor, idempotencyKey, removal)).rejects.toMatchObject({
      code: 'STOCK_BELOW_RESERVED',
    });
    expect(await database.inventoryChangeRequest.count()).toBe(0);
    await addStock(actor, randomUUID(), { ...key, quantity: 5, reason: 'Found' });
    const retried = await removeStock(actor, idempotencyKey, removal);
    expect(retried.replayed).toBe(false);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 5 });
  });

  it('never changes orders, shipments, carts or other dependent rows', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10 });
    const before = await dependentRecords();
    await addStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'Count' });
    const after = await dependentRecords();
    for (const table of [
      'carts',
      'cart_items',
      'orders',
      'order_items',
      'reviews',
      'collection_products',
    ]) {
      expect(after[table], table).toEqual(before[table]);
    }
  });
});

describe('permissions and concurrency', () => {
  it('refuses every stock change without inventory.write, changing nothing', async () => {
    const { key } = await stockedLocation({ onHandQuantity: 10 });
    const reader = staffInventoryActor(
      await createStaffMember(['inventory.read', 'warehouses.write']),
    );
    const before = await inventoryState();
    for (const attempt of [
      () => addStock(reader, randomUUID(), { ...key, quantity: 1, reason: 'Count' }),
      () => removeStock(reader, randomUUID(), { ...key, quantity: 1, reason: 'Count' }),
      () =>
        setStock(reader, randomUUID(), {
          ...key,
          expectedOnHandQuantity: 10,
          newOnHandQuantity: 4,
          reason: 'Count',
        }),
      () =>
        receiveStock(
          reader,
          randomUUID(),
          receiveStockSchema.parse({
            warehouseId: key.warehouseId,
            supplierReference: 'INV-1',
            lines: [{ variantId: key.variantId, quantity: 1 }],
          }),
        ),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
    }
    expect(await inventoryState()).toEqual(before);
  });

  it('lets exactly 7 of 20 simultaneous one-unit removals through when 7 are available', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 10, reservedQuantity: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        removeStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'Damaged' }),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(7);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'STOCK_BELOW_RESERVED' });
    }
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 3, reservedQuantity: 3 });
    expect(await database.inventoryMovement.count()).toBe(7);
    expect(await database.inventoryChangeRequest.count()).toBe(7);
    expect(await movementAudits()).toHaveLength(7);
  });

  it('runs simultaneous receipts, additions and removals without deadlock, and the ledger adds up', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: 50, reservedQuantity: 5 });
    const second = await createVariantRow();
    await createStockLevelRow({
      variantId: second.variantId,
      warehouseId: key.warehouseId,
      onHandQuantity: 50,
    });
    const bothLines = (first: number, last: number) =>
      receiveStockSchema.parse({
        warehouseId: key.warehouseId,
        supplierReference: 'INV-MIX',
        lines: [
          { variantId: second.variantId, quantity: first },
          { variantId: key.variantId, quantity: last },
        ],
      });
    const operations = [
      ...Array.from({ length: 6 }, () => () => receiveStock(actor, randomUUID(), bothLines(2, 3))),
      ...Array.from(
        { length: 6 },
        () => () => addStock(actor, randomUUID(), { ...key, quantity: 1, reason: 'Found' }),
      ),
      ...Array.from(
        { length: 6 },
        () => () =>
          removeStock(actor, randomUUID(), {
            variantId: variantIdSchema.parse(second.variantId),
            warehouseId: key.warehouseId,
            quantity: 2,
            reason: 'Damaged',
          }),
      ),
    ];
    const results = await Promise.allSettled(operations.map((operation) => operation()));
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 50 + 6 * 3 + 6 });
    expect(
      await stockLevel({ variantId: second.variantId, warehouseId: key.warehouseId }),
    ).toMatchObject({ onHandQuantity: 50 + 6 * 2 - 6 * 2 });
    for (const variantId of [key.variantId, second.variantId]) {
      const sum = await database.inventoryMovement.aggregate({
        where: { variantId },
        _sum: { quantityDelta: true },
      });
      const level = await stockLevel({ variantId, warehouseId: key.warehouseId });
      expect((level?.onHandQuantity ?? 0) - 50).toBe(sum._sum.quantityDelta);
    }
  });
});
