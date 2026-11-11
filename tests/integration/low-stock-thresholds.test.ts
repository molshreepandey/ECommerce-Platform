import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { variantIdSchema, warehouseIdSchema } from '@/lib/ids';
import { setLowStockThreshold } from '@/modules/inventory/low-stock-threshold.service';

import {
  createStaffMember,
  inventoryState,
  staffInventoryActor,
  stockedLocation,
  stockLevel,
} from './support/inventory-fixtures';
import { backendProcessId, waitUntilSomeoneWaitsOn } from './support/lock-probes';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const unknownId = '0195f2a0-0000-7000-8000-000000000999';

function thresholdAudits() {
  return database.auditLog.findMany({
    where: { action: 'inventory.low_stock_threshold_changed' },
    select: { entityType: true, entityId: true, actorId: true, before: true, after: true },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('setting a low-stock threshold', () => {
  it('changes only the threshold: on hand, reserved and the ledger are untouched', async () => {
    const { actor, key } = await stockedLocation({
      onHandQuantity: 9,
      reservedQuantity: 4,
      lowStockThreshold: 2,
    });
    const result = await setLowStockThreshold(actor, { ...key, lowStockThreshold: 6 });
    expect(result).toMatchObject({
      changed: true,
      stockLevel: {
        ...key,
        onHandQuantity: 9,
        reservedQuantity: 4,
        availableQuantity: 5,
        lowStockThreshold: 6,
      },
    });
    expect(await stockLevel(key)).toEqual({
      onHandQuantity: 9,
      reservedQuantity: 4,
      lowStockThreshold: 6,
    });
    expect(await inventoryState()).toMatchObject({ movements: 0, changeRequests: 0, outbox: 0 });
    expect(await thresholdAudits()).toEqual([
      {
        entityType: 'inventory_level',
        entityId: `${key.variantId}/${key.warehouseId}`,
        actorId: actor.staff.staffUserId,
        before: { lowStockThreshold: 2 },
        after: {
          lowStockThreshold: 6,
          onHandQuantity: 9,
          reservedQuantity: 4,
          variantId: key.variantId,
          warehouseId: key.warehouseId,
        },
      },
    ]);
  });

  it('does nothing, and audits nothing, when the threshold is already that value', async () => {
    const { actor, key } = await stockedLocation({ lowStockThreshold: 5 });
    await expect(
      setLowStockThreshold(actor, { ...key, lowStockThreshold: 5 }),
    ).resolves.toMatchObject({ changed: false });
    expect(await thresholdAudits()).toEqual([]);
  });

  it('creates a missing stock row at 0 on hand and 0 reserved for a positive threshold, with no movement', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: null });
    await setLowStockThreshold(actor, { ...key, lowStockThreshold: 4 });
    expect(await stockLevel(key)).toEqual({
      onHandQuantity: 0,
      reservedQuantity: 0,
      lowStockThreshold: 4,
    });
    expect(await database.inventoryMovement.count()).toBe(0);
    const [audit] = await thresholdAudits();
    expect(audit?.before).toEqual({ lowStockThreshold: null });
  });

  it('treats clearing a missing stock row to 0 as no change, creating nothing', async () => {
    const { actor, key } = await stockedLocation({ onHandQuantity: null });
    await expect(setLowStockThreshold(actor, { ...key, lowStockThreshold: 0 })).resolves.toEqual({
      changed: false,
      stockLevel: null,
    });
    expect(await stockLevel(key)).toBeNull();
  });
});

describe('archived products and variants (only clearing to 0)', () => {
  for (const statuses of [
    { productStatus: 'ARCHIVED', variantStatus: 'ACTIVE' },
    { productStatus: 'ACTIVE', variantStatus: 'ARCHIVED' },
    { productStatus: 'ARCHIVED', variantStatus: 'ARCHIVED' },
  ] as const) {
    it(`refuses a positive threshold but allows clearing (product ${statuses.productStatus}, variant ${statuses.variantStatus})`, async () => {
      const { actor, key } = await stockedLocation({
        onHandQuantity: 3,
        lowStockThreshold: 5,
        ...statuses,
      });
      const before = await inventoryState();
      await expect(
        setLowStockThreshold(actor, { ...key, lowStockThreshold: 8 }),
      ).rejects.toMatchObject({
        code: 'THRESHOLD_NOT_ALLOWED',
        httpStatus: 422,
        details: { variantId: key.variantId, ...statuses },
      });
      expect(await inventoryState()).toEqual(before);
      await expect(
        setLowStockThreshold(actor, { ...key, lowStockThreshold: 0 }),
      ).resolves.toMatchObject({ changed: true });
      expect(await stockLevel(key)).toEqual({
        onHandQuantity: 3,
        reservedQuantity: 0,
        lowStockThreshold: 0,
      });
    });
  }

  it('does not create a row when clearing the threshold of an archived variant without stock', async () => {
    const { actor, key } = await stockedLocation({
      onHandQuantity: null,
      variantStatus: 'ARCHIVED',
    });
    await expect(setLowStockThreshold(actor, { ...key, lowStockThreshold: 0 })).resolves.toEqual({
      changed: false,
      stockLevel: null,
    });
    await expect(
      setLowStockThreshold(actor, { ...key, lowStockThreshold: 2 }),
    ).rejects.toMatchObject({ code: 'THRESHOLD_NOT_ALLOWED' });
    expect(await stockLevel(key)).toBeNull();
  });

  it('allows any threshold for an inactive (not archived) variant and a draft product', async () => {
    for (const statuses of [{ variantStatus: 'INACTIVE' }, { productStatus: 'DRAFT' }] as const) {
      const { actor, key } = await stockedLocation(statuses);
      await expect(
        setLowStockThreshold(actor, { ...key, lowStockThreshold: 7 }),
      ).resolves.toMatchObject({ changed: true });
    }
  });

  it('waits for a product being archived and then refuses the positive threshold (no race)', async () => {
    const { actor, key, productId } = await stockedLocation({ lowStockThreshold: 0 });
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<undefined>();
    const archiving = database.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`UPDATE products SET status = 'ARCHIVED', archived_at = now() WHERE id = ${productId}::uuid`;
        ready.resolve(await backendProcessId(transaction));
        await release.promise;
      },
      { timeout: 20_000 },
    );
    const archiver = await ready.promise;
    const change = setLowStockThreshold(actor, { ...key, lowStockThreshold: 6 }).then(
      () => 'changed' as const,
      (error: unknown) => error,
    );
    await waitUntilSomeoneWaitsOn(archiver);
    release.resolve(undefined);
    await archiving;
    expect(await change).toMatchObject({ code: 'THRESHOLD_NOT_ALLOWED' });
    expect(await stockLevel(key)).toMatchObject({ lowStockThreshold: 0 });
  });
});

describe('warehouse rules (separate from product and variant rules)', () => {
  it('allows a threshold in an inactive warehouse', async () => {
    const { actor, key } = await stockedLocation({ warehouseActive: false, onHandQuantity: 2 });
    await expect(
      setLowStockThreshold(actor, { ...key, lowStockThreshold: 5 }),
    ).resolves.toMatchObject({ changed: true });
    expect(await stockLevel(key)).toMatchObject({ lowStockThreshold: 5, onHandQuantity: 2 });
  });

  it('answers 404 for an unknown warehouse or variant', async () => {
    const { actor, key } = await stockedLocation();
    await expect(
      setLowStockThreshold(actor, {
        ...key,
        warehouseId: warehouseIdSchema.parse(unknownId),
        lowStockThreshold: 3,
      }),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND', httpStatus: 404 });
    await expect(
      setLowStockThreshold(actor, {
        ...key,
        variantId: variantIdSchema.parse(unknownId),
        lowStockThreshold: 3,
      }),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_FOUND', httpStatus: 404 });
  });
});

describe('threshold permissions', () => {
  it('refuses a threshold change without inventory.write, changing nothing', async () => {
    const { key } = await stockedLocation({ lowStockThreshold: 1 });
    const reader = staffInventoryActor(
      await createStaffMember(['inventory.read', 'warehouses.write']),
    );
    await expect(
      setLowStockThreshold(reader, { ...key, lowStockThreshold: 9 }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
    expect(await stockLevel(key)).toMatchObject({ lowStockThreshold: 1 });
    expect(await thresholdAudits()).toEqual([]);
  });
});
