import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import { getDatabase } from '@/lib/db';
import {
  insertChangeRequestIfNew,
  findChangeRequest,
} from '@/modules/inventory/change-request.repository';
import {
  insertMovements,
  listMovementPage,
  movementsForChangeRequest,
  type NewMovement,
  remainingReservedForShipment,
} from '@/modules/inventory/inventory-movement.repository';
import {
  lockProductsForShare,
  lockShipments,
  lockVariantsForShare,
} from '@/modules/inventory/inventory-locks';
import { LockOrderViolation } from '@/modules/inventory/lock-order';
import {
  changeOnHand,
  findStockLevels,
  insertMissingStockLevels,
  lockStockLevels,
  releaseQuantity,
  reserveQuantity,
  setLowStockThresholdValue,
  setOnHandIfUnchanged,
} from '@/modules/inventory/stock-level.repository';
import {
  lockWarehouseForWrite,
  lockWarehousesForShare,
} from '@/modules/inventory/warehouse.repository';

import {
  createCustomerRow,
  createShipmentRow,
  createStaffMember,
  createStockLevelRow,
  createVariantRow,
  createWarehouseRow,
} from './support/inventory-fixtures';
import { canLock, whileLocked } from './support/lock-probes';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

function rowLockProbe(
  table: 'shipments' | 'products' | 'product_variants' | 'warehouses',
  id: string,
) {
  const lockedTable = Prisma.raw(table);
  return {
    update: () =>
      canLock(Prisma.sql`SELECT 1 FROM ${lockedTable} WHERE id = ${id}::uuid FOR UPDATE NOWAIT`),
    noKeyUpdate: () =>
      canLock(
        Prisma.sql`SELECT 1 FROM ${lockedTable} WHERE id = ${id}::uuid FOR NO KEY UPDATE NOWAIT`,
      ),
    share: () =>
      canLock(Prisma.sql`SELECT 1 FROM ${lockedTable} WHERE id = ${id}::uuid FOR SHARE NOWAIT`),
    keyShare: () =>
      canLock(Prisma.sql`SELECT 1 FROM ${lockedTable} WHERE id = ${id}::uuid FOR KEY SHARE NOWAIT`),
  };
}

function stockLevelProbe(variantId: string, warehouseId: string) {
  return () =>
    canLock(
      Prisma.sql`SELECT 1 FROM inventory_levels WHERE variant_id = ${variantId}::uuid AND warehouse_id = ${warehouseId}::uuid FOR KEY SHARE NOWAIT`,
    );
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('lock helpers take the planned lock mode', () => {
  it('locks shipments FOR NO KEY UPDATE: other writers wait, foreign-key checks do not', async () => {
    const warehouse = await createWarehouseRow();
    const shipment = await createShipmentRow({
      customerId: await createCustomerRow(),
      warehouseId: warehouse.id,
    });
    const probe = rowLockProbe('shipments', shipment.id);
    const result = await whileLocked(
      (transaction) => lockShipments(transaction, [shipment.id]),
      async () => ({
        update: await probe.update(),
        share: await probe.share(),
        keyShare: await probe.keyShare(),
      }),
    );
    expect(result).toEqual({ update: false, share: false, keyShare: true });
  });

  it('locks products and variants FOR SHARE: other readers share, writers wait', async () => {
    const { productId, variantId } = await createVariantRow();
    const productProbe = rowLockProbe('products', productId);
    const variantProbe = rowLockProbe('product_variants', variantId);
    const result = await whileLocked(
      async (transaction) => {
        await lockProductsForShare(transaction, [productId]);
        await lockVariantsForShare(transaction, [variantId]);
      },
      async () => ({
        productShare: await productProbe.share(),
        productUpdate: await productProbe.update(),
        variantShare: await variantProbe.share(),
        variantNoKeyUpdate: await variantProbe.noKeyUpdate(),
      }),
    );
    expect(result).toEqual({
      productShare: true,
      productUpdate: false,
      variantShare: true,
      variantNoKeyUpdate: false,
    });
  });

  it('locks warehouses FOR SHARE for reservations and FOR NO KEY UPDATE for edits', async () => {
    const shared = await createWarehouseRow();
    const edited = await createWarehouseRow();
    const sharedProbe = rowLockProbe('warehouses', shared.id);
    const editedProbe = rowLockProbe('warehouses', edited.id);
    const [first, second] = [shared.id, edited.id].sort();
    if (first === undefined || second === undefined) throw new Error('two warehouses expected');
    const result = await whileLocked(
      async (transaction) => {
        // Same level, ascending ids: the share lock and the write lock both obey the order.
        if (first === shared.id) {
          await lockWarehousesForShare(transaction, [shared.id]);
          await lockWarehouseForWrite(transaction, edited.id);
        } else {
          await lockWarehouseForWrite(transaction, edited.id);
          await lockWarehousesForShare(transaction, [shared.id]);
        }
      },
      async () => ({
        sharedShare: await sharedProbe.share(),
        sharedNoKeyUpdate: await sharedProbe.noKeyUpdate(),
        editedKeyShare: await editedProbe.keyShare(),
        editedShare: await editedProbe.share(),
      }),
    );
    expect(result).toEqual({
      sharedShare: true,
      sharedNoKeyUpdate: false,
      editedKeyShare: true,
      editedShare: false,
    });
  });

  it('locks stock rows FOR UPDATE and returns them in (variant, warehouse) order', async () => {
    const warehouseIds = (await Promise.all([1, 2, 3].map(() => createWarehouseRow())))
      .map(({ id }) => id)
      .sort();
    const { variantId } = await createVariantRow();
    for (const warehouseId of warehouseIds)
      await createStockLevelRow({ variantId, warehouseId, onHandQuantity: 5 });
    const [firstWarehouse] = warehouseIds;
    if (firstWarehouse === undefined) throw new Error('warehouses expected');
    const result = await whileLocked(
      async (transaction) => {
        const rows = await lockStockLevels(
          transaction,
          [...warehouseIds].reverse().map((warehouseId) => ({ variantId, warehouseId })),
        );
        expect(rows.map((row) => row.warehouseId)).toEqual(warehouseIds);
      },
      () => stockLevelProbe(variantId, firstWarehouse)(),
    );
    expect(result).toBe(false);
  });

  it('returns locked shipments, products and warehouses sorted by id', async () => {
    const warehouses = await Promise.all([1, 2, 3].map(() => createWarehouseRow()));
    const ids = warehouses.map(({ id }) => id);
    await database.$transaction(async (transaction) => {
      const rows = await lockWarehousesForShare(transaction, [...ids].reverse());
      expect(rows.map(({ id }) => id)).toEqual([...ids].sort());
    });
  });
});

describe('lock order is enforced before any SQL runs', () => {
  it('refuses a higher level after a lower one, and rolls the transaction back', async () => {
    const { productId } = await createVariantRow();
    const warehouse = await createWarehouseRow();
    await expect(
      database.$transaction(async (transaction) => {
        await lockWarehousesForShare(transaction, [warehouse.id]);
        await lockProductsForShare(transaction, [productId]);
      }),
    ).rejects.toThrow(LockOrderViolation);
  });

  it('refuses a shipment lock after a stock-row lock (L0b must come first)', async () => {
    const warehouse = await createWarehouseRow();
    const shipment = await createShipmentRow({
      customerId: await createCustomerRow(),
      warehouseId: warehouse.id,
    });
    const { variantId } = await createVariantRow();
    await createStockLevelRow({ variantId, warehouseId: warehouse.id, onHandQuantity: 4 });
    await expect(
      database.$transaction(async (transaction) => {
        await lockStockLevels(transaction, [{ variantId, warehouseId: warehouse.id }]);
        await lockShipments(transaction, [shipment.id]);
      }),
    ).rejects.toThrow(/Cannot lock SHIPMENTS after STOCK_LEVELS/);
  });

  it('refuses a key that sorts before one already held at the same level', async () => {
    const ids = (await Promise.all([1, 2].map(() => createWarehouseRow())))
      .map(({ id }) => id)
      .sort();
    const [lower, higher] = ids;
    if (lower === undefined || higher === undefined) throw new Error('two warehouses expected');
    await expect(
      database.$transaction(async (transaction) => {
        await lockWarehousesForShare(transaction, [higher]);
        await lockWarehousesForShare(transaction, [lower]);
      }),
    ).rejects.toThrow(/ascending order/);
  });

  it('accepts the whole hierarchy top to bottom in one transaction', async () => {
    const warehouse = await createWarehouseRow();
    const shipment = await createShipmentRow({
      customerId: await createCustomerRow(),
      warehouseId: warehouse.id,
    });
    const { productId, variantId } = await createVariantRow();
    await createStockLevelRow({ variantId, warehouseId: warehouse.id, onHandQuantity: 4 });
    const staff = await createStaffMember(['inventory.write']);
    await expect(
      database.$transaction(async (transaction) => {
        await lockShipments(transaction, [shipment.id]);
        await insertChangeRequestIfNew(transaction, {
          staffUserId: staff.staffUserId,
          idempotencyKey: randomUUID(),
          requestFingerprint: 'a'.repeat(64),
        });
        await lockProductsForShare(transaction, [productId]);
        await lockVariantsForShare(transaction, [variantId]);
        await lockWarehousesForShare(transaction, [warehouse.id]);
        await lockStockLevels(transaction, [{ variantId, warehouseId: warehouse.id }]);
        return 'done';
      }),
    ).resolves.toBe('done');
  });

  it('refuses to lock outside a transaction, where the lock would end at once', async () => {
    const warehouse = await createWarehouseRow();
    await expect(lockWarehousesForShare(database, [warehouse.id])).rejects.toThrow(
      /inside a transaction/,
    );
  });

  it('refuses a guarded stock update on a row the transaction has not locked', async () => {
    const warehouse = await createWarehouseRow();
    const { variantId } = await createVariantRow();
    await createStockLevelRow({ variantId, warehouseId: warehouse.id, onHandQuantity: 4 });
    await expect(
      database.$transaction((transaction) =>
        changeOnHand(transaction, { variantId, warehouseId: warehouse.id }, 1),
      ),
    ).rejects.toThrow(/must be locked before it is changed/);
    const [level] = await findStockLevels(database, [{ variantId, warehouseId: warehouse.id }]);
    expect(level?.onHandQuantity).toBe(4);
  });
});

describe('stock-level repository', () => {
  async function stockedLocation(onHandQuantity: number, reservedQuantity = 0) {
    const warehouse = await createWarehouseRow();
    const { variantId } = await createVariantRow();
    await createStockLevelRow({
      variantId,
      warehouseId: warehouse.id,
      onHandQuantity,
      reservedQuantity,
      lowStockThreshold: 3,
    });
    return { variantId, warehouseId: warehouse.id };
  }

  it('creates only the missing rows, at 0 on hand and 0 reserved', async () => {
    const existing = await stockedLocation(7, 2);
    const otherWarehouse = await createWarehouseRow();
    const missing = { variantId: existing.variantId, warehouseId: otherWarehouse.id };
    await database.$transaction((transaction) =>
      insertMissingStockLevels(transaction, [missing, existing]),
    );
    const rows = await findStockLevels(database, [existing, missing]);
    expect(rows.find((row) => row.warehouseId === existing.warehouseId)).toMatchObject({
      onHandQuantity: 7,
      reservedQuantity: 2,
    });
    expect(rows.find((row) => row.warehouseId === missing.warehouseId)).toMatchObject({
      onHandQuantity: 0,
      reservedQuantity: 0,
      lowStockThreshold: 0,
    });
  });

  it('changes on hand, but never below the reserved quantity', async () => {
    const key = await stockedLocation(10, 4);
    const results = await database.$transaction(async (transaction) => {
      await lockStockLevels(transaction, [key]);
      return {
        added: await changeOnHand(transaction, key, 5),
        tooFar: await changeOnHand(transaction, key, -12),
        removed: await changeOnHand(transaction, key, -11),
      };
    });
    expect(results.added).toMatchObject({
      onHandQuantity: 15,
      reservedQuantity: 4,
      availableQuantity: 11,
    });
    expect(results.tooFar).toBeNull();
    expect(results.removed).toMatchObject({
      onHandQuantity: 4,
      reservedQuantity: 4,
      availableQuantity: 0,
    });
  });

  it('sets on hand only when it still equals the expected value and stays at or above reserved', async () => {
    const key = await stockedLocation(10, 4);
    const results = await database.$transaction(async (transaction) => {
      await lockStockLevels(transaction, [key]);
      return {
        stale: await setOnHandIfUnchanged(transaction, key, {
          expectedOnHandQuantity: 9,
          newOnHandQuantity: 12,
        }),
        belowReserved: await setOnHandIfUnchanged(transaction, key, {
          expectedOnHandQuantity: 10,
          newOnHandQuantity: 3,
        }),
        set: await setOnHandIfUnchanged(transaction, key, {
          expectedOnHandQuantity: 10,
          newOnHandQuantity: 6,
        }),
      };
    });
    expect(results.stale).toBeNull();
    expect(results.belowReserved).toBeNull();
    expect(results.set).toMatchObject({ onHandQuantity: 6, reservedQuantity: 4 });
  });

  it('reserves only what is available and releases only what is reserved', async () => {
    const key = await stockedLocation(5, 1);
    const results = await database.$transaction(async (transaction) => {
      await lockStockLevels(transaction, [key]);
      return {
        tooMuch: await reserveQuantity(transaction, key, 5),
        reserved: await reserveQuantity(transaction, key, 4),
        overRelease: await releaseQuantity(transaction, key, 6),
        released: await releaseQuantity(transaction, key, 2),
      };
    });
    expect(results.tooMuch).toBeNull();
    expect(results.reserved).toMatchObject({
      onHandQuantity: 5,
      reservedQuantity: 5,
      availableQuantity: 0,
    });
    expect(results.overRelease).toBeNull();
    expect(results.released).toMatchObject({ onHandQuantity: 5, reservedQuantity: 3 });
  });

  it('changes the low-stock threshold without touching on hand or reserved', async () => {
    const key = await stockedLocation(8, 2);
    const updated = await database.$transaction(async (transaction) => {
      await lockStockLevels(transaction, [key]);
      return setLowStockThresholdValue(transaction, key, 9);
    });
    expect(updated).toMatchObject({ onHandQuantity: 8, reservedQuantity: 2, lowStockThreshold: 9 });
  });
});

describe('movement and change-request repositories', () => {
  async function ledgerLocation() {
    const warehouse = await createWarehouseRow();
    const otherWarehouse = await createWarehouseRow();
    const { variantId } = await createVariantRow();
    const customerId = await createCustomerRow();
    const shipment = await createShipmentRow({ customerId, warehouseId: warehouse.id });
    const otherShipment = await createShipmentRow({ customerId, warehouseId: warehouse.id });
    return {
      location: { variantId, warehouseId: warehouse.id },
      variantId,
      otherWarehouseId: otherWarehouse.id,
      shipment,
      otherShipment,
    };
  }

  function movement(
    overrides: Partial<NewMovement> & Pick<NewMovement, 'variantId' | 'warehouseId'>,
  ): NewMovement {
    return {
      movementType: 'RESERVE',
      quantityDelta: 1,
      onHandAfter: 20,
      reservedAfter: 1,
      referenceType: null,
      referenceId: null,
      actorType: 'SYSTEM',
      actorId: null,
      reason: null,
      ...overrides,
    };
  }

  it('sums what is still reserved for one exact shipment, variant and warehouse', async () => {
    const at = await ledgerLocation();
    const forShipment = { referenceType: 'shipment', referenceId: at.shipment.id };
    await database.$transaction((transaction) =>
      insertMovements(transaction, [
        movement({
          ...at.location,
          ...forShipment,
          movementType: 'RESERVE',
          quantityDelta: 5,
          reservedAfter: 5,
        }),
        movement({
          ...at.location,
          ...forShipment,
          movementType: 'RELEASE',
          quantityDelta: -1,
          reservedAfter: 4,
        }),
        movement({
          ...at.location,
          ...forShipment,
          movementType: 'DISPATCH',
          quantityDelta: -2,
          onHandAfter: 18,
          reservedAfter: 2,
        }),
        movement({
          ...at.location,
          ...forShipment,
          movementType: 'RTO_RESTOCK',
          quantityDelta: 2,
          onHandAfter: 20,
          reservedAfter: 2,
        }),
        movement({
          ...at.location,
          referenceType: 'shipment',
          referenceId: at.otherShipment.id,
          quantityDelta: 7,
          reservedAfter: 9,
        }),
        movement({
          variantId: at.variantId,
          warehouseId: at.otherWarehouseId,
          ...forShipment,
          quantityDelta: 3,
          reservedAfter: 3,
        }),
      ]),
    );
    const remaining = await remainingReservedForShipment(database, {
      shipmentId: at.shipment.id,
      variantId: at.variantId,
      warehouseId: at.location.warehouseId,
    });
    expect(remaining).toBe(2);
  });

  it('pages the ledger newest first with no row skipped or repeated, even with identical timestamps', async () => {
    const at = await ledgerLocation();
    // Eight rows in the same microsecond and four around it: the cursor must keep microseconds.
    for (const [index, createdAt] of [
      ...Array.from({ length: 8 }, () => '2026-10-01 10:00:00.123456+00'),
      '2026-10-01 10:00:00.123457+00',
      '2026-10-01 10:00:00.123455+00',
      '2026-10-02 08:00:00+00',
      '2026-09-30 08:00:00+00',
    ].entries()) {
      await database.$executeRaw`
        INSERT INTO inventory_movements (variant_id, warehouse_id, movement_type, quantity_delta,
          on_hand_after, reserved_after, reason, actor_type, created_at)
        VALUES (${at.variantId}::uuid, ${at.location.warehouseId}::uuid, 'ADJUSTMENT', ${index + 1}::int,
          ${index + 1}::int, 0, 'Count', 'SYSTEM', ${createdAt}::timestamptz)`;
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listMovementPage(database, { filters: {}, cursor, limit: 5 });
      seen.push(...result.movements.map(({ id }) => id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    const expectedOrder = z
      .array(z.object({ id: z.string() }))
      .parse(
        await database.$queryRaw`SELECT id::text AS id FROM inventory_movements ORDER BY created_at DESC, id DESC`,
      )
      .map(({ id }) => id);
    expect(seen).toEqual(expectedOrder);
    expect(new Set(seen).size).toBe(12);

    const filtered = await listMovementPage(database, {
      filters: {
        movementType: 'ADJUSTMENT',
        createdFrom: new Date('2026-10-01T00:00:00Z'),
        createdTo: new Date('2026-10-02T00:00:00Z'),
      },
      cursor: undefined,
      limit: 50,
    });
    expect(filtered.movements).toHaveLength(10);
    expect(filtered.nextCursor).toBeNull();
  });

  it('records a change request once per staff member and key, and finds its movements', async () => {
    const at = await ledgerLocation();
    const staff = await createStaffMember(['inventory.write']);
    const request = {
      staffUserId: staff.staffUserId,
      idempotencyKey: randomUUID(),
      requestFingerprint: 'b'.repeat(64),
    };
    const requestId = await database.$transaction((transaction) =>
      insertChangeRequestIfNew(transaction, request),
    );
    expect(requestId).not.toBeNull();
    expect(
      await database.$transaction((transaction) => insertChangeRequestIfNew(transaction, request)),
    ).toBeNull();
    expect(await findChangeRequest(database, request)).toEqual({
      id: requestId,
      requestFingerprint: 'b'.repeat(64),
    });

    await database.$transaction((transaction) =>
      insertMovements(transaction, [
        movement({
          ...at.location,
          movementType: 'RECEIPT',
          quantityDelta: 6,
          onHandAfter: 6,
          reservedAfter: 0,
          reason: 'INV-1',
          referenceType: 'inventory_change_request',
          referenceId: requestId,
        }),
      ]),
    );
    const replay = await movementsForChangeRequest(database, requestId ?? '');
    expect(
      replay.map(({ movementType, quantityDelta }) => ({ movementType, quantityDelta })),
    ).toEqual([{ movementType: 'RECEIPT', quantityDelta: 6 }]);
  });

  it('refuses to record a change request after stock rows are locked (L1 comes first)', async () => {
    const at = await ledgerLocation();
    await createStockLevelRow({ ...at.location, onHandQuantity: 1 });
    const staff = await createStaffMember(['inventory.write']);
    await expect(
      database.$transaction(async (transaction) => {
        await lockStockLevels(transaction, [at.location]);
        await insertChangeRequestIfNew(transaction, {
          staffUserId: staff.staffUserId,
          idempotencyKey: randomUUID(),
          requestFingerprint: 'c'.repeat(64),
        });
      }),
    ).rejects.toThrow(LockOrderViolation);
    expect(await database.inventoryChangeRequest.count()).toBe(0);
  });
});
