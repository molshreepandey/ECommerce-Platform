import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import type { ProductStatus, ProductVariantStatus } from '@/generated/prisma/enums';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import type { InventoryActor } from '@/modules/inventory/inventory-actor';
import { lockShipments } from '@/modules/inventory/inventory-locks';
import { LockOrderViolation } from '@/modules/inventory/lock-order';
import {
  applyReservationChanges,
  releaseReservation,
  reserveStock,
} from '@/modules/inventory/reservation.service';
import { lockStockLevels } from '@/modules/inventory/stock-level.repository';

import {
  createCustomerRow,
  createShipmentRow,
  createStaffMember,
  createStockLevelRow,
  createVariantRow,
  createWarehouseRow,
  customerInventoryActor,
  inventoryState,
  reservationLine,
  staffInventoryActor,
  stockedLocation,
  stockLevel,
  systemInventoryActor,
} from './support/inventory-fixtures';
import { backendProcessId, canLock, waitUntilSomeoneWaitsOn } from './support/lock-probes';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
type Line = ReturnType<typeof reservationLine>;

async function reservationSetup(
  input: {
    onHandQuantity?: number | null;
    productStatus?: ProductStatus;
    variantStatus?: ProductVariantStatus;
    warehouseActive?: boolean;
  } = {},
) {
  const location = await stockedLocation({ reservedQuantity: 0, ...input });
  const customerId = await createCustomerRow();
  const shipment = await createShipmentRow({ customerId, warehouseId: location.key.warehouseId });
  return {
    ...location,
    customerId,
    customer: customerInventoryActor(customerId),
    shipmentId: shipment.id,
  };
}

function reserve(actor: InventoryActor, lines: Line[]) {
  return database.$transaction((transaction) => reserveStock(transaction, actor, lines));
}

function release(actor: InventoryActor, lines: Line[]) {
  return database.$transaction((transaction) => releaseReservation(transaction, actor, lines));
}

function movementRows() {
  return database.inventoryMovement.findMany({
    orderBy: { id: 'asc' },
    select: {
      movementType: true,
      quantityDelta: true,
      referenceType: true,
      referenceId: true,
      variantId: true,
      warehouseId: true,
      actorType: true,
      actorId: true,
      reservedAfter: true,
    },
  });
}

function reservationAudits() {
  return database.auditLog.findMany({
    where: { action: { in: ['inventory.stock_reserved', 'inventory.reservation_released'] } },
    select: {
      action: true,
      entityId: true,
      actorType: true,
      actorId: true,
      ipAddress: true,
      requestId: true,
      after: true,
    },
  });
}

const remainingRowsSchema = z.array(z.object({ remaining: z.number() }));

// What each shipment still has reserved per stock row, from the ledger alone.
async function ledgerReservedByStockRow(): Promise<Map<string, number>> {
  const rows = z.array(z.object({ key: z.string(), reserved: z.number() })).parse(
    await database.$queryRaw`
        SELECT variant_id::text || '/' || warehouse_id::text AS key, sum(quantity_delta)::int AS reserved
        FROM inventory_movements WHERE movement_type IN ('RESERVE', 'RELEASE', 'DISPATCH')
        GROUP BY variant_id, warehouse_id`,
  );
  return new Map(rows.map(({ key, reserved }) => [key, reserved]));
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('reserving stock', () => {
  it('reserves for one exact shipment, variant and warehouse, recorded as the customer', async () => {
    const { key, customer, customerId, shipmentId, productId } = await reservationSetup({
      onHandQuantity: 10,
    });
    const shipmentsBefore = await database.shipment.findMany();
    const result = await reserve(customer, [reservationLine(shipmentId, key, 3)]);

    expect(result.movements).toEqual([
      expect.objectContaining({
        ...key,
        movementType: 'RESERVE',
        quantityDelta: 3,
        onHandAfter: 10,
        reservedBefore: 0,
        reservedAfter: 3,
        availableAfter: 7,
      }),
    ]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 3 });
    expect(await movementRows()).toEqual([
      {
        movementType: 'RESERVE',
        quantityDelta: 3,
        referenceType: 'shipment',
        referenceId: shipmentId,
        ...key,
        actorType: 'CUSTOMER',
        actorId: customerId,
        reservedAfter: 3,
      },
    ]);
    const [audit] = await reservationAudits();
    expect(audit).toMatchObject({
      action: 'inventory.stock_reserved',
      entityId: result.movements[0]?.movementId,
      actorType: 'CUSTOMER',
      actorId: customerId,
      ipAddress: customer.metadata.clientIp,
      requestId: customer.metadata.requestId,
      after: { quantityDelta: 3, movementType: 'RESERVE', shipmentId, reservedQuantity: 3 },
    });
    expect(await database.staffUser.count({ where: { id: customerId } })).toBe(0);
    expect(await database.searchOutbox.findMany({ select: { entityId: true } })).toEqual([
      { entityId: productId },
    ]);
    expect(await database.shipment.findMany()).toEqual(shipmentsBefore);
  });

  it('refuses products or variants that are not ACTIVE, changing nothing', async () => {
    for (const statuses of [
      { productStatus: 'DRAFT' },
      { productStatus: 'ARCHIVED' },
      { variantStatus: 'INACTIVE' },
      { variantStatus: 'ARCHIVED' },
    ] as const) {
      await truncateAllTestTables();
      const { key, customer, shipmentId } = await reservationSetup({
        onHandQuantity: 5,
        ...statuses,
      });
      const before = await inventoryState();
      await expect(
        reserve(customer, [reservationLine(shipmentId, key, 1)]),
        JSON.stringify(statuses),
      ).rejects.toMatchObject({
        code: 'VARIANT_NOT_RESERVABLE',
        httpStatus: 422,
      });
      expect(await inventoryState()).toEqual(before);
    }
  });

  it('refuses an inactive warehouse', async () => {
    const { key, customer, shipmentId } = await reservationSetup({
      onHandQuantity: 5,
      warehouseActive: false,
    });
    await expect(reserve(customer, [reservationLine(shipmentId, key, 1)])).rejects.toMatchObject({
      code: 'WAREHOUSE_INACTIVE',
      httpStatus: 422,
    });
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 0 });
  });

  it('refuses a missing shipment, or a shipment from another warehouse', async () => {
    const { key, customer, customerId } = await reservationSetup({ onHandQuantity: 5 });
    await expect(
      reserve(customer, [reservationLine('0195f2a0-0000-7000-8000-000000000999', key, 1)]),
    ).rejects.toMatchObject({
      code: 'RESERVATION_REFERENCE_INVALID',
      details: { reason: 'SHIPMENT_NOT_FOUND' },
    });
    const elsewhere = await createWarehouseRow();
    const otherShipment = await createShipmentRow({ customerId, warehouseId: elsewhere.id });
    await expect(
      reserve(customer, [reservationLine(otherShipment.id, key, 1)]),
    ).rejects.toMatchObject({
      code: 'RESERVATION_REFERENCE_INVALID',
      details: { reason: 'OTHER_WAREHOUSE' },
    });
  });

  it('refuses more than is available (409) and rolls back the caller’s whole transaction', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 4 });
    await expect(
      database.$transaction(async (transaction) => {
        await transaction.warehouse.create({
          data: {
            code: 'WH-CALLER-MARK',
            name: 'Marker',
            addressLine1: '1 Test Street',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '410501',
            contactName: 'Test',
            contactPhone: '9876500000',
            priority: 9,
          },
        });
        await reserveStock(transaction, customer, [reservationLine(shipmentId, key, 5)]);
      }),
    ).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
      httpStatus: 409,
      details: { availableQuantity: 4, requestedQuantity: 5 },
    });
    expect(await database.warehouse.count({ where: { code: 'WH-CALLER-MARK' } })).toBe(0);
    expect(await inventoryState()).toMatchObject({ movements: 0 });
  });

  it('treats a missing stock row as nothing available', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: null });
    await expect(reserve(customer, [reservationLine(shipmentId, key, 1)])).rejects.toMatchObject({
      code: 'OUT_OF_STOCK',
      details: { availableQuantity: 0 },
    });
  });

  it('reserves several lines all or nothing: a later line out of stock undoes the earlier ones', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 10 });
    const second = await createVariantRow();
    const secondKey = { variantId: second.variantId, warehouseId: key.warehouseId };
    await createStockLevelRow({ ...secondKey, onHandQuantity: 1 });
    const before = await inventoryState();
    await expect(
      reserve(customer, [
        reservationLine(shipmentId, key, 2),
        reservationLine(shipmentId, secondKey, 2),
      ]),
    ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(await inventoryState()).toEqual(before);
    const both = await reserve(customer, [
      reservationLine(shipmentId, secondKey, 1),
      reservationLine(shipmentId, key, 2),
    ]);
    expect(both.movements.map(({ variantId }) => variantId)).toEqual(
      [key.variantId, second.variantId].sort(),
    );
  });
});

describe('releasing a reservation', () => {
  it('releases part and then the rest for the exact shipment, recorded as a system process', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 10 });
    await reserve(customer, [reservationLine(shipmentId, key, 4)]);
    const system = systemInventoryActor('reservation-expiry');
    await release(system, [reservationLine(shipmentId, key, 1)]);
    const rest = await release(system, [reservationLine(shipmentId, key, 3)]);
    expect(rest.movements[0]).toMatchObject({
      movementType: 'RELEASE',
      quantityDelta: -3,
      reservedBefore: 3,
      reservedAfter: 0,
    });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0 });

    const releases = (await movementRows()).filter(
      ({ movementType }) => movementType === 'RELEASE',
    );
    expect(
      releases.every(({ actorType, actorId }) => actorType === 'SYSTEM' && actorId === null),
    ).toBe(true);
    const audits = (await reservationAudits()).filter(
      ({ action }) => action === 'inventory.reservation_released',
    );
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(audit).toMatchObject({
        actorType: 'SYSTEM',
        actorId: null,
        ipAddress: null,
        requestId: system.metadata.requestId,
      });
      expect(audit.after).toMatchObject({
        systemProcess: 'reservation-expiry',
        movementType: 'RELEASE',
        shipmentId,
      });
    }
  });

  it('records a staff-initiated release under the real staff member', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 10 });
    await reserve(customer, [reservationLine(shipmentId, key, 2)]);
    const staff = staffInventoryActor(await createStaffMember(['orders.write']));
    await release(staff, [reservationLine(shipmentId, key, 2)]);
    const [releaseRow] = (await movementRows()).filter(
      ({ movementType }) => movementType === 'RELEASE',
    );
    expect(releaseRow).toMatchObject({ actorType: 'STAFF', actorId: staff.staff.staffUserId });
  });

  it('refuses a duplicate or excessive release (409) and changes nothing', async () => {
    const { key, customer, customerId, shipmentId } = await reservationSetup({
      onHandQuantity: 10,
    });
    // A bystander shipment holds units on the same stock row; they must never be taken by this release.
    const bystander = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    await reserve(customer, [reservationLine(bystander.id, key, 5)]);
    await reserve(customer, [reservationLine(shipmentId, key, 2)]);
    await release(customer, [reservationLine(shipmentId, key, 2)]);
    const before = await inventoryState();
    await expect(release(customer, [reservationLine(shipmentId, key, 1)])).rejects.toMatchObject({
      code: 'RESERVATION_EXCEEDED',
      httpStatus: 409,
      details: { shipmentId, remainingReservedQuantity: 0, requestedQuantity: 1 },
    });
    expect(await inventoryState()).toEqual(before);
  });

  it('never frees another shipment’s reservation on the same stock row', async () => {
    const { key, customer, customerId, shipmentId } = await reservationSetup({
      onHandQuantity: 10,
    });
    const other = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    await reserve(customer, [reservationLine(other.id, key, 5)]);
    await expect(release(customer, [reservationLine(shipmentId, key, 1)])).rejects.toMatchObject({
      code: 'RESERVATION_EXCEEDED',
      details: { remainingReservedQuantity: 0 },
    });
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 5 });
  });

  it('allows releases in an inactive warehouse and for archived products or variants', async () => {
    const { key, customer, shipmentId, productId } = await reservationSetup({ onHandQuantity: 10 });
    await reserve(customer, [reservationLine(shipmentId, key, 3)]);
    await database.warehouse.update({ where: { id: key.warehouseId }, data: { isActive: false } });
    await database.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await database.productVariant.update({
      where: { id: key.variantId },
      data: { status: 'ARCHIVED' },
    });
    await release(customer, [reservationLine(shipmentId, key, 3)]);
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 0 });
  });

  it('re-allocates in one call: releases one shipment in one warehouse and reserves another elsewhere', async () => {
    const { key, customer, customerId, shipmentId } = await reservationSetup({ onHandQuantity: 4 });
    await reserve(customer, [reservationLine(shipmentId, key, 2)]);
    const target = await createWarehouseRow();
    const targetKey = { variantId: key.variantId, warehouseId: target.id };
    await createStockLevelRow({ ...targetKey, onHandQuantity: 6 });
    const targetShipment = await createShipmentRow({ customerId, warehouseId: target.id });
    const result = await database.$transaction((transaction) =>
      applyReservationChanges(transaction, customer, {
        release: [reservationLine(shipmentId, key, 2)],
        reserve: [reservationLine(targetShipment.id, targetKey, 2)],
      }),
    );
    expect(result.movements.map(({ movementType }) => movementType).sort()).toEqual([
      'RELEASE',
      'RESERVE',
    ]);
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 0 });
    expect(await stockLevel(targetKey)).toMatchObject({ reservedQuantity: 2 });
  });

  // N1 regression: on one stock row the release must run before the reserve whichever shipment ID
  // sorts first, or a valid re-allocation with nothing else available fails as OUT_OF_STOCK.
  it.each(['sorts before', 'sorts after'] as const)(
    're-allocates on the same stock row with nothing available when the reserving shipment ID %s the releasing one',
    async (order) => {
      const { key, customer, customerId } = await reservationSetup({ onHandQuantity: 4 });
      const [lowId, highId] = [
        (await createShipmentRow({ customerId, warehouseId: key.warehouseId })).id,
        (await createShipmentRow({ customerId, warehouseId: key.warehouseId })).id,
      ].sort((left, right) => left.localeCompare(right));
      if (lowId === undefined || highId === undefined)
        throw new Error('Shipments were not created');
      const [reservingId, releasingId] =
        order === 'sorts before' ? [lowId, highId] : [highId, lowId];
      const unrelated = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
      await reserve(customer, [reservationLine(releasingId, key, 2)]);
      await reserve(customer, [reservationLine(unrelated.id, key, 2)]);
      expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 4, reservedQuantity: 4 });

      const result = await database.$transaction((transaction) =>
        applyReservationChanges(transaction, customer, {
          reserve: [reservationLine(reservingId, key, 2)],
          release: [reservationLine(releasingId, key, 2)],
        }),
      );

      // Release applied first (4 → 2), then the reserve (2 → 4), whatever the shipment ID order.
      const released = result.movements.find(({ movementType }) => movementType === 'RELEASE');
      const reserved = result.movements.find(({ movementType }) => movementType === 'RESERVE');
      expect(result.movements).toHaveLength(2);
      expect(released).toMatchObject({
        ...key,
        quantityDelta: -2,
        onHandBefore: 4,
        onHandAfter: 4,
        reservedBefore: 4,
        reservedAfter: 2,
        availableAfter: 2,
      });
      expect(reserved).toMatchObject({
        ...key,
        quantityDelta: 2,
        onHandBefore: 4,
        onHandAfter: 4,
        reservedBefore: 2,
        reservedAfter: 4,
        availableAfter: 0,
      });
      expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 4, reservedQuantity: 4 });

      const ledgerEntry = {
        referenceType: 'shipment',
        ...key,
        actorType: 'CUSTOMER',
        actorId: customerId,
      };
      const movements = await movementRows();
      expect(movements).toHaveLength(4);
      expect(movements).toEqual(
        expect.arrayContaining([
          {
            ...ledgerEntry,
            movementType: 'RESERVE',
            quantityDelta: 2,
            referenceId: releasingId,
            reservedAfter: 2,
          },
          {
            ...ledgerEntry,
            movementType: 'RESERVE',
            quantityDelta: 2,
            referenceId: unrelated.id,
            reservedAfter: 4,
          },
          {
            ...ledgerEntry,
            movementType: 'RELEASE',
            quantityDelta: -2,
            referenceId: releasingId,
            reservedAfter: 2,
          },
          {
            ...ledgerEntry,
            movementType: 'RESERVE',
            quantityDelta: 2,
            referenceId: reservingId,
            reservedAfter: 4,
          },
        ]),
      );

      const audits = await reservationAudits();
      expect(audits).toHaveLength(4);
      const auditFor = (movementId: string | undefined) =>
        audits.find(({ entityId }) => entityId === movementId);
      expect(auditFor(released?.movementId)).toMatchObject({
        action: 'inventory.reservation_released',
        actorType: 'CUSTOMER',
        actorId: customerId,
        after: {
          movementType: 'RELEASE',
          quantityDelta: -2,
          shipmentId: releasingId,
          onHandQuantity: 4,
          reservedQuantity: 2,
        },
      });
      expect(auditFor(reserved?.movementId)).toMatchObject({
        action: 'inventory.stock_reserved',
        actorType: 'CUSTOMER',
        actorId: customerId,
        after: {
          movementType: 'RESERVE',
          quantityDelta: 2,
          shipmentId: reservingId,
          onHandQuantity: 4,
          reservedQuantity: 4,
        },
      });

      // Per shipment, from the ledger: the unrelated reservation is untouched.
      const remainingFor = async (shipmentId: string) =>
        remainingRowsSchema.parse(
          await database.$queryRaw`
            SELECT coalesce(sum(quantity_delta), 0)::int AS remaining FROM inventory_movements
            WHERE reference_type = 'shipment' AND reference_id = ${shipmentId}::uuid
              AND movement_type IN ('RESERVE', 'RELEASE', 'DISPATCH')`,
        )[0]?.remaining;
      expect(await remainingFor(unrelated.id)).toBe(2);
      expect(await remainingFor(releasingId)).toBe(0);
      expect(await remainingFor(reservingId)).toBe(2);
      expect(await ledgerReservedByStockRow()).toEqual(
        new Map([[`${key.variantId}/${key.warehouseId}`, 4]]),
      );
    },
  );

  it('refuses reserving and releasing the same shipment, variant and warehouse in one call', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 4 });
    await expect(
      database.$transaction((transaction) =>
        applyReservationChanges(transaction, customer, {
          reserve: [reservationLine(shipmentId, key, 1)],
          release: [reservationLine(shipmentId, key, 1)],
        }),
      ),
    ).rejects.toThrow(/Do not reserve and release the same/);
  });
});

describe('lock order: shipment (L0b) first, stock rows (L5) last', () => {
  async function holdWithRawLock(query: Prisma.Sql) {
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<undefined>();
    const done = database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(query);
        ready.resolve(await backendProcessId(transaction));
        await release.promise;
      },
      { timeout: 20_000 },
    );
    return {
      pid: await ready.promise,
      release: () => {
        release.resolve(undefined);
      },
      done,
    };
  }

  const stockRowFree = (key: { variantId: string; warehouseId: string }) =>
    canLock(
      Prisma.sql`SELECT 1 FROM inventory_levels WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid FOR UPDATE NOWAIT`,
    );

  for (const operation of ['reserve', 'release'] as const) {
    it(`${operation}: waits on the shipment before touching the stock row, with no shipment lock from the caller`, async () => {
      const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 10 });
      if (operation === 'release') await reserve(customer, [reservationLine(shipmentId, key, 2)]);
      const holder = await holdWithRawLock(
        Prisma.sql`SELECT id FROM shipments WHERE id = ${shipmentId}::uuid FOR NO KEY UPDATE`,
      );
      const line = [reservationLine(shipmentId, key, 1)];
      let isDone = false;
      // The calling transaction itself takes no shipment lock: the service locks the shipment on its own.
      const call = (
        operation === 'reserve' ? reserve(customer, line) : release(customer, line)
      ).finally(() => {
        isDone = true;
      });
      await waitUntilSomeoneWaitsOn(holder.pid);
      expect(isDone).toBe(false);
      expect(await stockRowFree(key)).toBe(true);
      holder.release();
      await holder.done;
      await expect(call).resolves.toMatchObject({
        movements: [
          expect.objectContaining({
            movementType: operation === 'reserve' ? 'RESERVE' : 'RELEASE',
          }),
        ],
      });
    });
  }

  it('combined call: holds the shipment, waits at the product (L2) and has not touched the stock row', async () => {
    const { key, customer, shipmentId, productId } = await reservationSetup({ onHandQuantity: 10 });
    const holder = await holdWithRawLock(
      Prisma.sql`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`,
    );
    const call = database.$transaction((transaction) =>
      applyReservationChanges(transaction, customer, {
        reserve: [reservationLine(shipmentId, key, 1)],
      }),
    );
    await waitUntilSomeoneWaitsOn(holder.pid);
    expect(
      await canLock(
        Prisma.sql`SELECT 1 FROM shipments WHERE id = ${shipmentId}::uuid FOR UPDATE NOWAIT`,
      ),
    ).toBe(false);
    expect(await stockRowFree(key)).toBe(true);
    holder.release();
    await holder.done;
    await expect(call).resolves.toMatchObject({
      movements: [expect.objectContaining({ movementType: 'RESERVE' })],
    });
  });

  it('works when the caller already holds the shipment lock, through the helper or plain SQL', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 10 });
    await database.$transaction(async (transaction) => {
      await lockShipments(transaction, [shipmentId]);
      await reserveStock(transaction, customer, [reservationLine(shipmentId, key, 1)]);
    });
    await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM shipments WHERE id = ${shipmentId}::uuid FOR NO KEY UPDATE`;
      await reserveStock(transaction, customer, [reservationLine(shipmentId, key, 1)]);
    });
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 2 });
  });

  it('refuses to run after the caller locked a stock row (that would lock L0b after L5)', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 10 });
    await expect(
      database.$transaction(async (transaction: DatabaseClient) => {
        await lockStockLevels(transaction, [key]);
        await reserveStock(transaction, customer, [reservationLine(shipmentId, key, 1)]);
      }),
    ).rejects.toThrow(LockOrderViolation);
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 0 });
  });
});

describe('concurrency', () => {
  it('lets only one of two simultaneous reservations through when stock covers just one', async () => {
    const { key, customer, customerId, shipmentId } = await reservationSetup({ onHandQuantity: 5 });
    const other = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    const results = await Promise.allSettled([
      reserve(customer, [reservationLine(shipmentId, key, 3)]),
      reserve(customer, [reservationLine(other.id, key, 3)]),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(({ status }) => status === 'rejected');
    expect(failed?.status === 'rejected' ? failed.reason : null).toMatchObject({
      code: 'OUT_OF_STOCK',
    });
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 3 });
  });

  it('reserves exactly 7 of 20 simultaneous one-unit reservations against 7 available', async () => {
    const { key, customer, shipmentId } = await reservationSetup({ onHandQuantity: 7 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserve(customer, [reservationLine(shipmentId, key, 1)])),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(7);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 7, reservedQuantity: 7 });
  });

  it('frees a one-unit reservation exactly once when ten releases arrive together', async () => {
    const { key, customer, customerId, shipmentId } = await reservationSetup({ onHandQuantity: 7 });
    const bystander = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    await reserve(customer, [reservationLine(bystander.id, key, 4)]);
    await reserve(customer, [reservationLine(shipmentId, key, 1)]);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => release(customer, [reservationLine(shipmentId, key, 1)])),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'RESERVATION_EXCEEDED' });
    }
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 4 });
    expect(await database.inventoryMovement.count({ where: { movementType: 'RELEASE' } })).toBe(1);
  });

  it('keeps stock consistent when a release races a reservation that needs the freed units', async () => {
    for (let round = 0; round < 5; round += 1) {
      await truncateAllTestTables();
      const { key, customer, customerId, shipmentId } = await reservationSetup({
        onHandQuantity: 5,
      });
      await reserve(customer, [reservationLine(shipmentId, key, 2)]);
      const other = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
      const [released, reserved] = await Promise.allSettled([
        release(customer, [reservationLine(shipmentId, key, 2)]),
        reserve(customer, [reservationLine(other.id, key, 4)]),
      ]);
      expect(released.status).toBe('fulfilled');
      const level = await stockLevel(key);
      if (reserved.status === 'fulfilled') expect(level?.reservedQuantity).toBe(4);
      else {
        expect(reserved.reason).toMatchObject({ code: 'OUT_OF_STOCK' });
        expect(level?.reservedQuantity).toBe(0);
      }
      expect(
        (await ledgerReservedByStockRow()).get(`${key.variantId}/${key.warehouseId}`) ?? 0,
      ).toBe(level?.reservedQuantity);
    }
  });

  it('runs opposite-order multi-line reservations and releases without deadlock', async () => {
    const { key, customer, customerId, shipmentId } = await reservationSetup({
      onHandQuantity: 100,
    });
    const second = await createVariantRow();
    const secondKey = { variantId: second.variantId, warehouseId: key.warehouseId };
    await createStockLevelRow({ ...secondKey, onHandQuantity: 100 });
    const otherShipment = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    const forward = () =>
      reserve(customer, [
        reservationLine(shipmentId, key, 1),
        reservationLine(otherShipment.id, secondKey, 1),
      ]);
    const backward = () =>
      reserve(customer, [
        reservationLine(otherShipment.id, secondKey, 1),
        reservationLine(shipmentId, key, 1),
      ]);
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, index) => (index % 2 === 0 ? forward() : backward())),
    );
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([]);
    const releases = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        index % 2 === 0
          ? release(customer, [
              reservationLine(shipmentId, key, 1),
              reservationLine(otherShipment.id, secondKey, 1),
            ])
          : release(customer, [
              reservationLine(otherShipment.id, secondKey, 1),
              reservationLine(shipmentId, key, 1),
            ]),
      ),
    );
    expect(releases.filter(({ status }) => status === 'rejected')).toEqual([]);
    expect(await stockLevel(key)).toMatchObject({ reservedQuantity: 8 });
    expect(await stockLevel(secondKey)).toMatchObject({ reservedQuantity: 8 });
  });

  it('keeps the ledger equal to the reserved quantities after a concurrent mix', async () => {
    const { key, customer, customerId, shipmentId } = await reservationSetup({
      onHandQuantity: 30,
    });
    const shipments = [
      shipmentId,
      ...(await Promise.all(
        [1, 2].map(
          async () => (await createShipmentRow({ customerId, warehouseId: key.warehouseId })).id,
        ),
      )),
    ];
    await Promise.all(shipments.map((id) => reserve(customer, [reservationLine(id, key, 4)])));
    await Promise.allSettled([
      ...shipments.map((id) => release(customer, [reservationLine(id, key, 3)])),
      ...shipments.map((id) => release(customer, [reservationLine(id, key, 3)])),
      ...shipments.map((id) => reserve(customer, [reservationLine(id, key, 2)])),
    ]);
    const level = await stockLevel(key);
    expect((await ledgerReservedByStockRow()).get(`${key.variantId}/${key.warehouseId}`)).toBe(
      level?.reservedQuantity,
    );
    for (const id of shipments) {
      const [row] = remainingRowsSchema.parse(
        await database.$queryRaw`SELECT coalesce(sum(quantity_delta), 0)::int AS remaining FROM inventory_movements WHERE reference_id = ${id}::uuid`,
      );
      expect(row?.remaining).toBeGreaterThanOrEqual(0);
    }
  });
});
