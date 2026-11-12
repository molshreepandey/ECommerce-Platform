import { beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import type { InventoryActor } from '@/modules/inventory/inventory-actor';
import {
  remainingReservedForShipments,
  restockableForShipments,
  shipmentStockKey,
} from '@/modules/inventory/inventory-movement.repository';
import { LockOrderViolation } from '@/modules/inventory/lock-order';
import { releaseReservation, reserveStock } from '@/modules/inventory/reservation.service';
import { dispatchReservedStock } from '@/modules/inventory/stock-dispatch.service';
import { lockStockLevels } from '@/modules/inventory/stock-level.repository';
import {
  restockCustomerReturn,
  restockReturnedShipment,
} from '@/modules/inventory/stock-restock.service';

import {
  createCustomerRow,
  createReturnRequestRow,
  createShipmentRow,
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
type ReturnLine = { returnRequestId: string; variantId: string; quantity: number };

const missingId = '0195f2a0-0000-7000-8000-000000000999';

// One variant stocked in one warehouse with one shipment from it that has `reservedQuantity` reserved.
async function shipmentSetup(
  input: { onHandQuantity?: number; reservedQuantity?: number; warehouseActive?: boolean } = {},
) {
  const location = await stockedLocation({
    onHandQuantity: input.onHandQuantity ?? 10,
    ...(input.warehouseActive === undefined ? {} : { warehouseActive: input.warehouseActive }),
  });
  const customerId = await createCustomerRow();
  const shipment = await createShipmentRow({ customerId, warehouseId: location.key.warehouseId });
  const customer = customerInventoryActor(customerId);
  const reservedQuantity = input.reservedQuantity ?? 0;
  if (reservedQuantity > 0) {
    await database.$transaction((transaction) =>
      reserveStock(transaction, customer, [
        reservationLine(shipment.id, location.key, reservedQuantity),
      ]),
    );
  }
  return { ...location, customerId, customer, shipmentId: shipment.id };
}

function dispatch(actor: InventoryActor, lines: Line[]) {
  return database.$transaction((transaction) => dispatchReservedStock(transaction, actor, lines));
}

function restockShipment(actor: InventoryActor, lines: Line[]) {
  return database.$transaction((transaction) => restockReturnedShipment(transaction, actor, lines));
}

function restockReturn(actor: InventoryActor, lines: ReturnLine[]) {
  return database.$transaction((transaction) => restockCustomerReturn(transaction, actor, lines));
}

function release(actor: InventoryActor, lines: Line[]) {
  return database.$transaction((transaction) => releaseReservation(transaction, actor, lines));
}

function auditsFor(action: string) {
  return database.auditLog.findMany({
    where: { action },
    select: {
      entityType: true,
      entityId: true,
      actorType: true,
      actorId: true,
      before: true,
      after: true,
    },
  });
}

function movementsOfType(movementType: 'DISPATCH' | 'RTO_RESTOCK' | 'RETURN_RESTOCK') {
  return database.inventoryMovement.findMany({
    where: { movementType },
    orderBy: { id: 'asc' },
    select: {
      variantId: true,
      warehouseId: true,
      quantityDelta: true,
      onHandAfter: true,
      reservedAfter: true,
      referenceType: true,
      referenceId: true,
      actorType: true,
      actorId: true,
      reason: true,
    },
  });
}

const markerWarehouse = {
  code: 'WH-CALLER-MARK',
  name: 'Marker',
  addressLine1: '1 Test Street',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '410501',
  contactName: 'Test',
  contactPhone: '9876500000',
  priority: 9,
};

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('dispatching reserved stock', () => {
  it('lowers on hand and reserved together, with one DISPATCH movement and audit row', async () => {
    const { key, actor, staff, shipmentId } = await shipmentSetup({ reservedQuantity: 3 });
    const outboxBefore = await database.searchOutbox.count();
    const result = await dispatch(actor, [reservationLine(shipmentId, key, 3)]);

    expect(result.movements).toEqual([
      expect.objectContaining({
        ...key,
        movementType: 'DISPATCH',
        quantityDelta: -3,
        onHandBefore: 10,
        onHandAfter: 7,
        reservedBefore: 3,
        reservedAfter: 0,
        availableAfter: 7,
        reason: null,
      }),
    ]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 7, reservedQuantity: 0 });
    expect(await movementsOfType('DISPATCH')).toEqual([
      {
        ...key,
        quantityDelta: -3,
        onHandAfter: 7,
        reservedAfter: 0,
        referenceType: 'shipment',
        referenceId: shipmentId,
        actorType: 'STAFF',
        actorId: staff.staffUserId,
        reason: null,
      },
    ]);
    expect(await auditsFor('inventory.stock_dispatched')).toEqual([
      {
        entityType: 'inventory_movement',
        entityId: result.movements[0]?.movementId,
        actorType: 'STAFF',
        actorId: staff.staffUserId,
        before: { onHandQuantity: 10, reservedQuantity: 3 },
        after: {
          onHandQuantity: 7,
          reservedQuantity: 0,
          quantityDelta: -3,
          movementType: 'DISPATCH',
          ...key,
          shipmentId,
        },
      },
    ]);
    // Available stock did not change, so nothing is queued for search.
    expect(await database.searchOutbox.count()).toBe(outboxBefore);
  });

  it('dispatches part, then the rest, and refuses more than the shipment still has reserved', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 5 });
    await dispatch(actor, [reservationLine(shipmentId, key, 2)]);
    const before = await inventoryState();
    await expect(dispatch(actor, [reservationLine(shipmentId, key, 4)])).rejects.toMatchObject({
      code: 'RESERVATION_EXCEEDED',
      httpStatus: 409,
      details: { shipmentId, remainingReservedQuantity: 3, requestedQuantity: 4 },
    });
    expect(await inventoryState()).toEqual(before);
    await dispatch(actor, [reservationLine(shipmentId, key, 3)]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 });
    await expect(dispatch(actor, [reservationLine(shipmentId, key, 1)])).rejects.toMatchObject({
      code: 'RESERVATION_EXCEEDED',
      details: { remainingReservedQuantity: 0 },
    });
  });

  it('never dispatches units reserved for another shipment on the same stock row', async () => {
    const { key, actor, customer, customerId, shipmentId } = await shipmentSetup();
    const other = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    await database.$transaction((transaction) =>
      reserveStock(transaction, customer, [reservationLine(other.id, key, 4)]),
    );
    await expect(dispatch(actor, [reservationLine(shipmentId, key, 1)])).rejects.toMatchObject({
      code: 'RESERVATION_EXCEEDED',
      details: { remainingReservedQuantity: 0 },
    });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 4 });
  });

  it('refuses a missing shipment, a shipment from another warehouse, or a missing stock row', async () => {
    const { key, actor, customerId } = await shipmentSetup();
    await expect(dispatch(actor, [reservationLine(missingId, key, 1)])).rejects.toMatchObject({
      code: 'RESERVATION_REFERENCE_INVALID',
      httpStatus: 422,
      details: { reason: 'SHIPMENT_NOT_FOUND' },
    });
    const elsewhere = await createWarehouseRow();
    const otherShipment = await createShipmentRow({ customerId, warehouseId: elsewhere.id });
    await expect(
      dispatch(actor, [reservationLine(otherShipment.id, key, 1)]),
    ).rejects.toMatchObject({
      code: 'RESERVATION_REFERENCE_INVALID',
      details: { reason: 'OTHER_WAREHOUSE' },
    });
    const unstocked = await createVariantRow();
    await expect(
      dispatch(actor, [
        reservationLine(otherShipment.id, { ...unstocked, warehouseId: elsewhere.id }, 1),
      ]),
    ).rejects.toMatchObject({ code: 'RESERVATION_EXCEEDED' });
  });

  it('dispatches from an inactive warehouse and for archived products and variants', async () => {
    const { key, actor, productId, shipmentId } = await shipmentSetup({ reservedQuantity: 2 });
    await database.warehouse.update({ where: { id: key.warehouseId }, data: { isActive: false } });
    await database.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await database.productVariant.update({
      where: { id: key.variantId },
      data: { status: 'ARCHIVED' },
    });
    await dispatch(actor, [reservationLine(shipmentId, key, 2)]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 8, reservedQuantity: 0 });
  });

  it('is all or nothing and rolls back the caller’s whole transaction', async () => {
    const { key, actor, customer, shipmentId } = await shipmentSetup({ reservedQuantity: 2 });
    const second = await createVariantRow();
    const secondKey = { variantId: second.variantId, warehouseId: key.warehouseId };
    await createStockLevelRow({ ...secondKey, onHandQuantity: 5 });
    await database.$transaction((transaction) =>
      reserveStock(transaction, customer, [reservationLine(shipmentId, secondKey, 1)]),
    );
    const before = await inventoryState();
    await expect(
      database.$transaction(async (transaction) => {
        await transaction.warehouse.create({ data: markerWarehouse });
        await dispatchReservedStock(transaction, actor, [
          reservationLine(shipmentId, key, 2),
          reservationLine(shipmentId, secondKey, 2),
        ]);
      }),
    ).rejects.toMatchObject({ code: 'RESERVATION_EXCEEDED' });
    expect(await database.warehouse.count({ where: { code: markerWarehouse.code } })).toBe(0);
    expect(await inventoryState()).toEqual(before);
  });

  it('chains before-values when one call dispatches two shipments from the same stock row', async () => {
    const { key, actor, customer, customerId, shipmentId } = await shipmentSetup({
      reservedQuantity: 2,
    });
    const other = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    await database.$transaction((transaction) =>
      reserveStock(transaction, customer, [reservationLine(other.id, key, 3)]),
    );
    await dispatch(actor, [reservationLine(other.id, key, 3), reservationLine(shipmentId, key, 2)]);
    // Lines on one stock row are applied in shipment-id order; each audit starts where the last ended.
    const [firstId, secondId] = [shipmentId, other.id].sort();
    const quantityOf = (id: string | undefined) => (id === shipmentId ? 2 : 3);
    const audits = await auditsFor('inventory.stock_dispatched');
    const auditOf = (id: string | undefined) =>
      audits.find(({ after }) => (after as { shipmentId?: unknown } | null)?.shipmentId === id);
    const firstOnHandAfter = 10 - quantityOf(firstId);
    const firstReservedAfter = 5 - quantityOf(firstId);
    expect(auditOf(firstId)?.before).toEqual({ onHandQuantity: 10, reservedQuantity: 5 });
    expect(auditOf(firstId)?.after).toMatchObject({
      onHandQuantity: firstOnHandAfter,
      reservedQuantity: firstReservedAfter,
    });
    expect(auditOf(secondId)?.before).toEqual({
      onHandQuantity: firstOnHandAfter,
      reservedQuantity: firstReservedAfter,
    });
    expect(auditOf(secondId)?.after).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 });
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 5, reservedQuantity: 0 });
  });

  it('checks every line before changing any, so a caller that catches the refusal commits nothing', async () => {
    const { key, actor, customer, shipmentId } = await shipmentSetup({ reservedQuantity: 2 });
    const second = await createVariantRow();
    const secondKey = { variantId: second.variantId, warehouseId: key.warehouseId };
    await createStockLevelRow({ ...secondKey, onHandQuantity: 5 });
    await database.$transaction((transaction) =>
      reserveStock(transaction, customer, [reservationLine(shipmentId, secondKey, 1)]),
    );
    const before = await inventoryState();
    const refusal = await database.$transaction(async (transaction) => {
      try {
        await dispatchReservedStock(transaction, actor, [
          reservationLine(shipmentId, key, 2),
          reservationLine(shipmentId, secondKey, 2),
        ]);
        return null;
      } catch (error) {
        return error;
      }
    });
    expect(refusal).toMatchObject({ code: 'RESERVATION_EXCEEDED' });
    expect(await inventoryState()).toEqual(before);
  });

  it('accepts ids in upper case and validates its lines', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 2 });
    const upperCaseKey = {
      variantId: key.variantId.toUpperCase(),
      warehouseId: key.warehouseId.toUpperCase(),
    };
    const result = await dispatch(actor, [
      reservationLine(shipmentId.toUpperCase(), upperCaseKey, 1),
    ]);
    expect(result.movements).toEqual([expect.objectContaining({ ...key, quantityDelta: -1 })]);
    await expect(dispatch(actor, [])).rejects.toBeInstanceOf(ZodError);
    await expect(
      dispatch(actor, [reservationLine(shipmentId, key, 1), reservationLine(shipmentId, key, 1)]),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(dispatch(actor, [reservationLine(shipmentId, key, 0)])).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it('counts dispatched units: afterwards only what is still reserved can be released', async () => {
    const { key, actor, customer, shipmentId } = await shipmentSetup({ reservedQuantity: 5 });
    await dispatch(actor, [reservationLine(shipmentId, key, 3)]);
    await expect(release(customer, [reservationLine(shipmentId, key, 3)])).rejects.toMatchObject({
      code: 'RESERVATION_EXCEEDED',
      details: { remainingReservedQuantity: 2 },
    });
    await release(customer, [reservationLine(shipmentId, key, 2)]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 7, reservedQuantity: 0 });
  });
});

describe('restocking a shipment returned to origin', () => {
  it('puts dispatched units back on hand at the shipment’s warehouse, recorded and queued for search', async () => {
    const { key, actor, productId, shipmentId } = await shipmentSetup({ reservedQuantity: 3 });
    await dispatch(actor, [reservationLine(shipmentId, key, 3)]);
    const system = systemInventoryActor('courier-rto');
    const outboxBefore = await database.searchOutbox.count();
    const result = await restockShipment(system, [reservationLine(shipmentId, key, 3)]);

    expect(result.movements).toEqual([
      expect.objectContaining({
        ...key,
        movementType: 'RTO_RESTOCK',
        quantityDelta: 3,
        onHandBefore: 7,
        onHandAfter: 10,
        reservedBefore: 0,
        reservedAfter: 0,
      }),
    ]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0 });
    expect(await movementsOfType('RTO_RESTOCK')).toEqual([
      {
        ...key,
        quantityDelta: 3,
        onHandAfter: 10,
        reservedAfter: 0,
        referenceType: 'shipment',
        referenceId: shipmentId,
        actorType: 'SYSTEM',
        actorId: null,
        reason: null,
      },
    ]);
    expect(await auditsFor('inventory.shipment_restocked')).toEqual([
      {
        entityType: 'inventory_movement',
        entityId: result.movements[0]?.movementId,
        actorType: 'SYSTEM',
        actorId: null,
        before: { onHandQuantity: 7, reservedQuantity: 0 },
        after: {
          onHandQuantity: 10,
          reservedQuantity: 0,
          quantityDelta: 3,
          movementType: 'RTO_RESTOCK',
          ...key,
          shipmentId,
          systemProcess: 'courier-rto',
        },
      },
    ]);
    const outbox = await database.searchOutbox.findMany({ select: { entityId: true } });
    expect(outbox).toHaveLength(outboxBefore + 1);
    expect(outbox.at(-1)).toEqual({ entityId: productId });
  });

  it('restocks at most what was dispatched and not yet restocked, so a duplicate changes nothing', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 3 });
    await expect(
      restockShipment(actor, [reservationLine(shipmentId, key, 1)]),
    ).rejects.toMatchObject({
      code: 'RESTOCK_EXCEEDED',
      httpStatus: 409,
      details: { referenceType: 'shipment', restockableQuantity: 0, requestedQuantity: 1 },
    });
    await dispatch(actor, [reservationLine(shipmentId, key, 3)]);
    await restockShipment(actor, [reservationLine(shipmentId, key, 2)]);
    await restockShipment(actor, [reservationLine(shipmentId, key, 1)]);
    const before = await inventoryState();
    await expect(
      restockShipment(actor, [reservationLine(shipmentId, key, 1)]),
    ).rejects.toMatchObject({
      code: 'RESTOCK_EXCEEDED',
      details: { referenceId: shipmentId, restockableQuantity: 0 },
    });
    expect(await inventoryState()).toEqual(before);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0 });
  });

  it('only restocks to the shipment’s own warehouse', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 1 });
    await dispatch(actor, [reservationLine(shipmentId, key, 1)]);
    const elsewhere = await createWarehouseRow();
    await createStockLevelRow({
      variantId: key.variantId,
      warehouseId: elsewhere.id,
      onHandQuantity: 0,
    });
    await expect(
      restockShipment(actor, [
        reservationLine(shipmentId, { variantId: key.variantId, warehouseId: elsewhere.id }, 1),
      ]),
    ).rejects.toMatchObject({
      code: 'RESERVATION_REFERENCE_INVALID',
      details: { reason: 'OTHER_WAREHOUSE' },
    });
  });

  it('restocks into an inactive warehouse and for archived products and variants', async () => {
    const { key, actor, productId, shipmentId } = await shipmentSetup({ reservedQuantity: 2 });
    await dispatch(actor, [reservationLine(shipmentId, key, 2)]);
    await database.warehouse.update({ where: { id: key.warehouseId }, data: { isActive: false } });
    await database.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await restockShipment(actor, [reservationLine(shipmentId, key, 2)]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10 });
  });

  it('keeps the on-hand ceiling of 1,000,000', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 1 });
    await dispatch(actor, [reservationLine(shipmentId, key, 1)]);
    await database.inventoryLevel.update({
      where: { variantId_warehouseId: key },
      data: { onHandQuantity: 1_000_000 },
    });
    await expect(
      restockShipment(actor, [reservationLine(shipmentId, key, 1)]),
    ).rejects.toMatchObject({
      code: 'ON_HAND_LIMIT_EXCEEDED',
      httpStatus: 422,
      details: { onHandQuantity: 1_000_000, requestedOnHandQuantity: 1_000_001 },
    });
  });

  it('adds up lines on one stock row for the ceiling and changes nothing when the sum is over it', async () => {
    const { key, actor, customer, customerId, shipmentId } = await shipmentSetup({
      reservedQuantity: 1,
    });
    const other = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    await database.$transaction((transaction) =>
      reserveStock(transaction, customer, [reservationLine(other.id, key, 1)]),
    );
    await dispatch(actor, [reservationLine(shipmentId, key, 1), reservationLine(other.id, key, 1)]);
    await database.inventoryLevel.update({
      where: { variantId_warehouseId: key },
      data: { onHandQuantity: 999_999 },
    });
    const before = await inventoryState();
    const refusal = await database.$transaction(async (transaction) => {
      try {
        await restockReturnedShipment(transaction, actor, [
          reservationLine(shipmentId, key, 1),
          reservationLine(other.id, key, 1),
        ]);
        return null;
      } catch (error) {
        return error;
      }
    });
    expect(refusal).toMatchObject({
      code: 'ON_HAND_LIMIT_EXCEEDED',
      details: { onHandQuantity: 1_000_000, requestedOnHandQuantity: 1_000_001 },
    });
    expect(await inventoryState()).toEqual(before);
    await restockShipment(actor, [reservationLine(shipmentId, key, 1)]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 1_000_000 });
  });

  it('accepts ids in upper case', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 1 });
    await dispatch(actor, [reservationLine(shipmentId, key, 1)]);
    const result = await restockShipment(actor, [
      reservationLine(
        shipmentId.toUpperCase(),
        { variantId: key.variantId.toUpperCase(), warehouseId: key.warehouseId.toUpperCase() },
        1,
      ),
    ]);
    expect(result.movements).toEqual([expect.objectContaining({ ...key, quantityDelta: 1 })]);
  });
});

describe('restocking a customer return', () => {
  async function returnSetup(input: { receivingWarehouse?: 'stocked' | 'new' | 'none' } = {}) {
    const location = await stockedLocation({ onHandQuantity: 4 });
    const customerId = await createCustomerRow();
    const warehouseId =
      input.receivingWarehouse === 'none'
        ? null
        : input.receivingWarehouse === 'new'
          ? (await createWarehouseRow()).id
          : location.key.warehouseId;
    const returnRequest = await createReturnRequestRow({
      customerId,
      receivingWarehouseId: warehouseId,
      items: [
        { variantId: location.key.variantId, productId: location.productId, quantity: 1 },
        { variantId: location.key.variantId, productId: location.productId, quantity: 2 },
      ],
    });
    return { ...location, customerId, warehouseId, ...returnRequest };
  }

  it('puts returned units on hand at the receiving warehouse, recorded and queued for search', async () => {
    const { key, actor, staff, productId, returnRequestId } = await returnSetup();
    const outboxBefore = await database.searchOutbox.count();
    const result = await restockReturn(actor, [
      { returnRequestId, variantId: key.variantId, quantity: 3 },
    ]);
    expect(result.movements).toEqual([
      expect.objectContaining({
        ...key,
        movementType: 'RETURN_RESTOCK',
        quantityDelta: 3,
        onHandBefore: 4,
        onHandAfter: 7,
      }),
    ]);
    expect(await movementsOfType('RETURN_RESTOCK')).toEqual([
      {
        ...key,
        quantityDelta: 3,
        onHandAfter: 7,
        reservedAfter: 0,
        referenceType: 'return_request',
        referenceId: returnRequestId,
        actorType: 'STAFF',
        actorId: staff.staffUserId,
        reason: null,
      },
    ]);
    expect(await auditsFor('inventory.return_restocked')).toEqual([
      {
        entityType: 'inventory_movement',
        entityId: result.movements[0]?.movementId,
        actorType: 'STAFF',
        actorId: staff.staffUserId,
        before: { onHandQuantity: 4, reservedQuantity: 0 },
        after: {
          onHandQuantity: 7,
          reservedQuantity: 0,
          quantityDelta: 3,
          movementType: 'RETURN_RESTOCK',
          ...key,
          returnRequestId,
        },
      },
    ]);
    const outbox = await database.searchOutbox.findMany({ select: { entityId: true } });
    expect(outbox).toHaveLength(outboxBefore + 1);
    expect(outbox.at(-1)).toEqual({ entityId: productId });
  });

  it('creates the stock row when the receiving warehouse never held the variant', async () => {
    const { key, actor, warehouseId, returnRequestId } = await returnSetup({
      receivingWarehouse: 'new',
    });
    if (warehouseId === null) throw new Error('expected a receiving warehouse');
    await restockReturn(actor, [{ returnRequestId, variantId: key.variantId, quantity: 1 }]);
    expect(await stockLevel({ variantId: key.variantId, warehouseId })).toMatchObject({
      onHandQuantity: 1,
      reservedQuantity: 0,
    });
  });

  it('restocks at most what the return lists for the variant, and nothing for other variants', async () => {
    const { key, actor, returnRequestId } = await returnSetup();
    await restockReturn(actor, [{ returnRequestId, variantId: key.variantId, quantity: 2 }]);
    const before = await inventoryState();
    await expect(
      restockReturn(actor, [{ returnRequestId, variantId: key.variantId, quantity: 2 }]),
    ).rejects.toMatchObject({
      code: 'RESTOCK_EXCEEDED',
      httpStatus: 409,
      details: {
        referenceType: 'return_request',
        referenceId: returnRequestId,
        restockableQuantity: 1,
        requestedQuantity: 2,
      },
    });
    const other = await createVariantRow();
    await expect(
      restockReturn(actor, [{ returnRequestId, variantId: other.variantId, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'RESTOCK_EXCEEDED', details: { restockableQuantity: 0 } });
    expect(await inventoryState()).toEqual(before);
  });

  it('counts restocks in every warehouse, so changing the receiving warehouse never resets the limit', async () => {
    const { key, actor, returnRequestId } = await returnSetup();
    await restockReturn(actor, [{ returnRequestId, variantId: key.variantId, quantity: 2 }]);
    const second = await createWarehouseRow();
    await database.returnRequest.update({
      where: { id: returnRequestId },
      data: { receivingWarehouseId: second.id },
    });
    await expect(
      restockReturn(actor, [{ returnRequestId, variantId: key.variantId, quantity: 2 }]),
    ).rejects.toMatchObject({
      code: 'RESTOCK_EXCEEDED',
      details: { warehouseId: second.id, restockableQuantity: 1, requestedQuantity: 2 },
    });
    await restockReturn(actor, [{ returnRequestId, variantId: key.variantId, quantity: 1 }]);
    expect(await stockLevel({ variantId: key.variantId, warehouseId: second.id })).toMatchObject({
      onHandQuantity: 1,
    });
  });

  it('restocks into an inactive warehouse and for archived products, with ids in upper case', async () => {
    const { key, actor, productId, returnRequestId } = await returnSetup();
    await database.warehouse.update({ where: { id: key.warehouseId }, data: { isActive: false } });
    await database.product.update({
      where: { id: productId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await restockReturn(actor, [
      {
        returnRequestId: returnRequestId.toUpperCase(),
        variantId: key.variantId.toUpperCase(),
        quantity: 3,
      },
    ]);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 7 });
  });

  it('refuses a variant that does not exist with 409, creating no stock row', async () => {
    const { actor, returnRequestId } = await returnSetup();
    const before = await inventoryState();
    await expect(
      restockReturn(actor, [{ returnRequestId, variantId: missingId, quantity: 1 }]),
    ).rejects.toMatchObject({ code: 'RESTOCK_EXCEEDED', details: { restockableQuantity: 0 } });
    expect(await inventoryState()).toEqual(before);
  });

  it('refuses a missing return request or one without a receiving warehouse', async () => {
    const { key, actor, returnRequestId } = await returnSetup({ receivingWarehouse: 'none' });
    await expect(
      restockReturn(actor, [{ returnRequestId, variantId: key.variantId, quantity: 1 }]),
    ).rejects.toMatchObject({
      code: 'RESTOCK_REFERENCE_INVALID',
      httpStatus: 422,
      details: { returnRequestId, reason: 'NO_RECEIVING_WAREHOUSE' },
    });
    await expect(
      restockReturn(actor, [{ returnRequestId: missingId, variantId: key.variantId, quantity: 1 }]),
    ).rejects.toMatchObject({
      code: 'RESTOCK_REFERENCE_INVALID',
      details: { reason: 'RETURN_REQUEST_NOT_FOUND' },
    });
    await expect(
      restockReturn(actor, [
        { returnRequestId, variantId: key.variantId, quantity: 1 },
        { returnRequestId, variantId: key.variantId, quantity: 1 },
      ]),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe('lock order: shipment (L0b) first, stock rows (L5) last', () => {
  async function holdShipmentLock(shipmentId: string) {
    const ready = Promise.withResolvers<number>();
    const release = Promise.withResolvers<undefined>();
    const done = database.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM shipments WHERE id = ${shipmentId}::uuid FOR NO KEY UPDATE`;
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

  for (const operation of ['dispatch', 'restock'] as const) {
    it(`${operation}: waits on the shipment before touching the stock row`, async () => {
      const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 2 });
      if (operation === 'restock') await dispatch(actor, [reservationLine(shipmentId, key, 2)]);
      const holder = await holdShipmentLock(shipmentId);
      const lines = [reservationLine(shipmentId, key, 1)];
      let isDone = false;
      const call = (
        operation === 'dispatch' ? dispatch(actor, lines) : restockShipment(actor, lines)
      ).finally(() => {
        isDone = true;
      });
      await waitUntilSomeoneWaitsOn(holder.pid);
      expect(isDone).toBe(false);
      expect(
        await canLock(
          Prisma.sql`SELECT 1 FROM inventory_levels WHERE variant_id = ${key.variantId}::uuid AND warehouse_id = ${key.warehouseId}::uuid FOR UPDATE NOWAIT`,
        ),
      ).toBe(true);
      holder.release();
      await holder.done;
      await expect(call).resolves.toMatchObject({
        movements: [
          expect.objectContaining({
            movementType: operation === 'dispatch' ? 'DISPATCH' : 'RTO_RESTOCK',
          }),
        ],
      });
    });
  }

  it('refuses to run after the caller locked a stock row (that would lock L0b after L5)', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 1 });
    await expect(
      database.$transaction(async (transaction: DatabaseClient) => {
        await lockStockLevels(transaction, [key]);
        await dispatchReservedStock(transaction, actor, [reservationLine(shipmentId, key, 1)]);
      }),
    ).rejects.toThrow(LockOrderViolation);
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 1 });
  });
});

describe('concurrency', () => {
  it('dispatches a reservation exactly once when ten identical dispatches arrive together', async () => {
    const { key, actor, customer, customerId, shipmentId } = await shipmentSetup({
      reservedQuantity: 2,
    });
    const bystander = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
    await database.$transaction((transaction) =>
      reserveStock(transaction, customer, [reservationLine(bystander.id, key, 3)]),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => dispatch(actor, [reservationLine(shipmentId, key, 2)])),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'RESERVATION_EXCEEDED' });
    }
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 8, reservedQuantity: 3 });
    expect(await database.inventoryMovement.count({ where: { movementType: 'DISPATCH' } })).toBe(1);
  });

  it('lets exactly one of a dispatch and a release take the same reserved units', async () => {
    for (let round = 0; round < 5; round += 1) {
      await truncateAllTestTables();
      const { key, actor, customer, customerId, shipmentId } = await shipmentSetup({
        onHandQuantity: 6,
        reservedQuantity: 2,
      });
      const bystander = await createShipmentRow({ customerId, warehouseId: key.warehouseId });
      await database.$transaction((transaction) =>
        reserveStock(transaction, customer, [reservationLine(bystander.id, key, 3)]),
      );
      const [dispatched, released] = await Promise.allSettled([
        dispatch(actor, [reservationLine(shipmentId, key, 2)]),
        release(customer, [reservationLine(shipmentId, key, 2)]),
      ]);
      expect([dispatched.status, released.status].sort()).toEqual(['fulfilled', 'rejected']);
      const loser = [dispatched, released].find(({ status }) => status === 'rejected');
      expect(loser?.status === 'rejected' ? loser.reason : null).toMatchObject({
        code: 'RESERVATION_EXCEEDED',
      });
      expect(await stockLevel(key)).toMatchObject({
        onHandQuantity: dispatched.status === 'fulfilled' ? 4 : 6,
        reservedQuantity: 3,
      });
    }
  });

  it('restocks exactly the dispatched 3 units when ten one-unit RTO restocks arrive together', async () => {
    const { key, actor, shipmentId } = await shipmentSetup({ reservedQuantity: 3 });
    await dispatch(actor, [reservationLine(shipmentId, key, 3)]);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        restockShipment(actor, [reservationLine(shipmentId, key, 1)]),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(3);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'RESTOCK_EXCEEDED' });
    }
    expect(await stockLevel(key)).toMatchObject({ onHandQuantity: 10, reservedQuantity: 0 });
  });

  it('restocks exactly the 3 returned units when ten one-unit return restocks arrive together', async () => {
    const location = await stockedLocation({ onHandQuantity: 0 });
    const customerId = await createCustomerRow();
    const { returnRequestId } = await createReturnRequestRow({
      customerId,
      receivingWarehouseId: location.key.warehouseId,
      items: [{ variantId: location.key.variantId, productId: location.productId, quantity: 3 }],
    });
    const actor = staffInventoryActor(location.staff);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        restockReturn(actor, [{ returnRequestId, variantId: location.key.variantId, quantity: 1 }]),
      ),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(3);
    for (const result of results) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'RESTOCK_EXCEEDED' });
    }
    expect(await stockLevel(location.key)).toMatchObject({ onHandQuantity: 3 });
    expect(
      await database.inventoryMovement.count({ where: { movementType: 'RETURN_RESTOCK' } }),
    ).toBe(3);
  });

  it('keeps every stock row equal to its ledger after a concurrent mix of all shipment operations', async () => {
    const { key, actor, customer, customerId, shipmentId } = await shipmentSetup({
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
    await Promise.all(
      shipments.map((id) =>
        database.$transaction((transaction) =>
          reserveStock(transaction, customer, [reservationLine(id, key, 4)]),
        ),
      ),
    );
    const outcomes = await Promise.allSettled([
      ...shipments.map((id) => dispatch(actor, [reservationLine(id, key, 3)])),
      ...shipments.map((id) => release(customer, [reservationLine(id, key, 2)])),
      ...shipments.map((id) => restockShipment(actor, [reservationLine(id, key, 2)])),
      ...shipments.map((id) => dispatch(actor, [reservationLine(id, key, 1)])),
    ]);
    const level = await stockLevel(key);
    const ledger = await database.inventoryMovement.groupBy({
      by: ['movementType'],
      where: key,
      _sum: { quantityDelta: true },
    });
    const sumOf = (types: readonly string[]) =>
      ledger
        .filter(({ movementType }) => types.includes(movementType))
        .reduce((total, row) => total + (row._sum.quantityDelta ?? 0), 0);
    // Opening stock (30) has no movement here; every later change does.
    expect(level?.reservedQuantity).toBe(sumOf(['RESERVE', 'RELEASE', 'DISPATCH']));
    expect(level?.onHandQuantity).toBe(30 + sumOf(['DISPATCH', 'RTO_RESTOCK']));
    expect(sumOf(['DISPATCH'])).toBeLessThan(0);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(['RESERVATION_EXCEEDED', 'RESTOCK_EXCEEDED']).toContain(
          (outcome.reason as { code?: unknown }).code,
        );
      }
    }
    const keys = shipments.map((id) => ({ shipmentId: id, ...key }));
    const remaining = await remainingReservedForShipments(database, keys);
    const restockable = await restockableForShipments(database, keys);
    for (const shipmentKey of keys) {
      expect(remaining.get(shipmentStockKey(shipmentKey))).toBeGreaterThanOrEqual(0);
      expect(restockable.get(shipmentStockKey(shipmentKey))).toBeGreaterThanOrEqual(0);
    }
  });
});
