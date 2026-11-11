import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { createWarehouseSchema, updateWarehouseSchema } from '@/modules/inventory/inventory.schema';
import { lockStockLevels } from '@/modules/inventory/stock-level.repository';
import { lockWarehousesForShare } from '@/modules/inventory/warehouse.repository';
import {
  changeWarehouseStatus,
  createWarehouse,
  getWarehouse,
  listWarehouses,
  updateWarehouse,
} from '@/modules/inventory/warehouse.service';

import { dependentRecords } from './support/dependent-records';
import {
  createCustomerRow,
  createShipmentRow,
  createStaffMember,
  createStockLevelRow,
  createVariantRow,
  staffInventoryActor,
} from './support/inventory-fixtures';
import { backendProcessId, waitUntilSomeoneWaitsOn, whileLocked } from './support/lock-probes';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

const pune = {
  code: 'wh-pune',
  name: 'Pune Fulfilment Centre',
  addressLine1: '12 Chakan Industrial Area',
  city: 'Pune',
  state: 'Maharashtra',
  pincode: '410501',
  contactName: 'Asha Rao',
  contactPhone: '9876511004',
  priority: 4,
};

async function inventoryManager() {
  return staffInventoryActor(
    await createStaffMember(['inventory.read', 'inventory.write', 'warehouses.write']),
  );
}

function warehouseAudits() {
  return database.auditLog.findMany({
    where: { entityType: 'warehouse' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('creating and reading warehouses', () => {
  it('creates a warehouse with an upper-case code and audits it as the real staff member', async () => {
    const actor = await inventoryManager();
    const warehouse = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    expect(warehouse).toMatchObject({
      code: 'WH-PUNE',
      isActive: true,
      priority: 4,
      addressLine2: null,
    });

    const [audit] = await warehouseAudits();
    expect(audit).toMatchObject({
      action: 'warehouse.created',
      entityId: warehouse.id,
      actorType: 'STAFF',
      actorId: actor.staff.staffUserId,
      ipAddress: actor.metadata.clientIp,
      requestId: actor.metadata.requestId,
    });
    expect(audit?.after).toMatchObject({
      code: 'WH-PUNE',
      name: 'Pune Fulfilment Centre',
      isActive: true,
    });
    expect(await database.staffUser.count({ where: { id: actor.staff.staffUserId } })).toBe(1);
  });

  it('gives exactly one of ten simultaneous creates with the same code the warehouse (409 for the rest)', async () => {
    const actor = await inventoryManager();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => createWarehouse(actor, createWarehouseSchema.parse(pune))),
    );
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'WAREHOUSE_CODE_TAKEN', httpStatus: 409 });
      }
    }
    expect(await database.warehouse.count()).toBe(1);
    expect(await warehouseAudits()).toHaveLength(1);
  });

  it('lists warehouses by priority then code, and answers 404 for an unknown one', async () => {
    const actor = await inventoryManager();
    for (const [code, priority] of [
      ['WH-C', 2],
      ['WH-B', 1],
      ['WH-A', 2],
    ] as const) {
      await createWarehouse(actor, createWarehouseSchema.parse({ ...pune, code, priority }));
    }
    const listed = await listWarehouses(actor.staff);
    expect(listed.map(({ code }) => code)).toEqual(['WH-B', 'WH-A', 'WH-C']);
    const [first] = listed;
    if (first === undefined) throw new Error('warehouses expected');
    await expect(getWarehouse(actor.staff, first.id)).resolves.toMatchObject({ code: 'WH-B' });
    await expect(
      getWarehouse(actor.staff, '0195f2a0-0000-7000-8000-000000000999'),
    ).rejects.toMatchObject({
      code: 'WAREHOUSE_NOT_FOUND',
      httpStatus: 404,
    });
  });
});

describe('editing warehouses (last save wins, every save audited)', () => {
  it('writes only the submitted fields and audits only what changed', async () => {
    const actor = await inventoryManager();
    const created = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    const updated = await updateWarehouse(
      actor,
      created.id,
      updateWarehouseSchema.parse({ name: 'Pune Hub', priority: 4 }),
    );
    expect(updated).toEqual({ ...created, name: 'Pune Hub' });
    const audits = await warehouseAudits();
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({
      action: 'warehouse.updated',
      before: { name: 'Pune Fulfilment Centre' },
      after: { name: 'Pune Hub' },
    });
  });

  it('does nothing, and audits nothing, when the submitted values are already current', async () => {
    const actor = await inventoryManager();
    const created = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    await expect(
      updateWarehouse(
        actor,
        created.id,
        updateWarehouseSchema.parse({ city: 'Pune', priority: 4 }),
      ),
    ).resolves.toEqual(created);
    expect(await warehouseAudits()).toHaveLength(1);
  });

  it('keeps the later of two edits to the same field, with both audited', async () => {
    const actor = await inventoryManager();
    const other = await inventoryManager();
    const created = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    await updateWarehouse(
      actor,
      created.id,
      updateWarehouseSchema.parse({ contactName: 'Ravi Kumar' }),
    );
    await updateWarehouse(
      other,
      created.id,
      updateWarehouseSchema.parse({ contactName: 'Meera Shah' }),
    );
    expect((await getWarehouse(actor.staff, created.id)).contactName).toBe('Meera Shah');
    const edits = (await warehouseAudits()).filter(({ action }) => action === 'warehouse.updated');
    expect(edits.map(({ actorId, before, after }) => ({ actorId, before, after }))).toEqual([
      {
        actorId: actor.staff.staffUserId,
        before: { contactName: 'Asha Rao' },
        after: { contactName: 'Ravi Kumar' },
      },
      {
        actorId: other.staff.staffUserId,
        before: { contactName: 'Ravi Kumar' },
        after: { contactName: 'Meera Shah' },
      },
    ]);
  });

  it('keeps both of two simultaneous edits to different fields', async () => {
    const actor = await inventoryManager();
    const created = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    await Promise.all([
      updateWarehouse(actor, created.id, updateWarehouseSchema.parse({ name: 'Pune Hub' })),
      updateWarehouse(actor, created.id, updateWarehouseSchema.parse({ priority: 9 })),
    ]);
    expect(await getWarehouse(actor.staff, created.id)).toMatchObject({
      name: 'Pune Hub',
      priority: 9,
    });
  });

  it('serialises ten simultaneous edits of one field: each audit row starts where the previous ended', async () => {
    const actor = await inventoryManager();
    const created = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    const names = Array.from({ length: 10 }, (_, index) => `Pune Hub ${String(index)}`);
    await Promise.all(
      names.map((name) =>
        updateWarehouse(actor, created.id, updateWarehouseSchema.parse({ name })),
      ),
    );
    const edits = (await warehouseAudits()).filter(({ action }) => action === 'warehouse.updated');
    expect(edits).toHaveLength(10);
    const nameOf = (data: unknown) => z.object({ name: z.string() }).parse(data).name;
    // Audit timestamps are transaction start times, so follow the before → after links instead of the
    // row order: a lost update would leave an edit whose "before" no other edit produced.
    const editByBefore = new Map(edits.map(({ before, after }) => [nameOf(before), nameOf(after)]));
    expect(editByBefore.size).toBe(10);
    let current = 'Pune Fulfilment Centre';
    for (let step = 0; step < 10; step += 1) {
      const next = editByBefore.get(current);
      if (next === undefined) throw new Error(`no edit starts from ${current}`);
      current = next;
    }
    expect(new Set([...editByBefore.values()])).toEqual(new Set(names));
    expect((await getWarehouse(actor.staff, created.id)).name).toBe(current);
  });

  it('answers 404 for an unknown warehouse', async () => {
    const actor = await inventoryManager();
    await expect(
      updateWarehouse(
        actor,
        '0195f2a0-0000-7000-8000-000000000999',
        updateWarehouseSchema.parse({ name: 'Nope' }),
      ),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND', httpStatus: 404 });
  });
});

describe('activating and deactivating warehouses', () => {
  async function stockedWarehouse() {
    const actor = await inventoryManager();
    const warehouse = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    const first = await createVariantRow();
    const second = await createVariantRow();
    await createStockLevelRow({
      variantId: first.variantId,
      warehouseId: warehouse.id,
      onHandQuantity: 10,
      reservedQuantity: 3,
    });
    await createStockLevelRow({
      variantId: second.variantId,
      warehouseId: warehouse.id,
      onHandQuantity: 4,
      reservedQuantity: 1,
    });
    await createShipmentRow({ customerId: await createCustomerRow(), warehouseId: warehouse.id });
    return { actor, warehouse, productIds: [first.productId, second.productId].sort() };
  }

  it('deactivates without releasing or changing any stock, keeps reservations and queues reindexing', async () => {
    const { actor, warehouse, productIds } = await stockedWarehouse();
    const before = await dependentRecords();
    const shipmentsBefore = await database.shipment.findMany({ orderBy: { id: 'asc' } });
    await database.searchOutbox.deleteMany();

    const deactivated = await changeWarehouseStatus(actor, warehouse.id, { isActive: false });
    expect(deactivated.isActive).toBe(false);
    expect(await dependentRecords()).toEqual(before);
    expect(await database.shipment.findMany({ orderBy: { id: 'asc' } })).toEqual(shipmentsBefore);
    expect(
      await database.inventoryLevel.aggregate({
        where: { warehouseId: warehouse.id },
        _sum: { onHandQuantity: true, reservedQuantity: true },
      }),
    ).toMatchObject({ _sum: { onHandQuantity: 14, reservedQuantity: 4 } });

    const statusAudit = (await warehouseAudits()).find(
      ({ action }) => action === 'warehouse.status_changed',
    );
    expect(statusAudit).toMatchObject({
      before: { isActive: true },
      after: { isActive: false, reservedUnitsKept: 4 },
    });
    const queued = await database.searchOutbox.findMany({
      select: { entityType: true, entityId: true },
    });
    expect(queued.map(({ entityId }) => entityId).sort()).toEqual(productIds);
    expect(queued.every(({ entityType }) => entityType === 'product')).toBe(true);
  });

  it('treats a repeated deactivation as no change, and reactivates', async () => {
    const { actor, warehouse } = await stockedWarehouse();
    await changeWarehouseStatus(actor, warehouse.id, { isActive: false });
    await changeWarehouseStatus(actor, warehouse.id, { isActive: false });
    const reactivated = await changeWarehouseStatus(actor, warehouse.id, { isActive: true });
    expect(reactivated.isActive).toBe(true);
    const statusAudits = (await warehouseAudits()).filter(
      ({ action }) => action === 'warehouse.status_changed',
    );
    expect(statusAudits.map(({ after }) => after)).toEqual([
      { isActive: false, reservedUnitsKept: 4 },
      { isActive: true, reservedUnitsKept: 4 },
    ]);
  });

  it('never waits on stock rows: a status change finishes while a stock row is locked', async () => {
    const { actor, warehouse } = await stockedWarehouse();
    const [level] = await database.inventoryLevel.findMany({
      where: { warehouseId: warehouse.id },
      take: 1,
    });
    if (level === undefined) throw new Error('stock row expected');
    const changed = await whileLocked(
      (transaction) =>
        lockStockLevels(transaction, [{ variantId: level.variantId, warehouseId: warehouse.id }]),
      () => changeWarehouseStatus(actor, warehouse.id, { isActive: false }),
    );
    expect(changed.isActive).toBe(false);
  });

  it('waits for a reservation holding the warehouse, then deactivates (L4 serialises them)', async () => {
    const { actor, warehouse } = await stockedWarehouse();
    // Hold the share lock a reservation takes, and watch the deactivation wait behind it.
    const release = Promise.withResolvers<undefined>();
    const holderReady = Promise.withResolvers<number>();
    const holding = database.$transaction(
      async (transaction) => {
        await lockWarehousesForShare(transaction, [warehouse.id]);
        holderReady.resolve(await backendProcessId(transaction));
        await release.promise;
      },
      { timeout: 20_000 },
    );
    const holderPid = await holderReady.promise;
    let isDone = false;
    const deactivation = changeWarehouseStatus(actor, warehouse.id, { isActive: false }).finally(
      () => {
        isDone = true;
      },
    );
    await waitUntilSomeoneWaitsOn(holderPid);
    expect(isDone).toBe(false);
    release.resolve(undefined);
    await holding;
    await expect(deactivation).resolves.toMatchObject({ isActive: false });
  });
});

describe('warehouse permissions', () => {
  it('refuses every write without warehouses.write and changes nothing', async () => {
    const actor = await inventoryManager();
    const created = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    const readOnly = staffInventoryActor(
      await createStaffMember(['inventory.read', 'inventory.write']),
    );
    for (const attempt of [
      () => createWarehouse(readOnly, createWarehouseSchema.parse({ ...pune, code: 'WH-NEW' })),
      () => updateWarehouse(readOnly, created.id, updateWarehouseSchema.parse({ name: 'Nope' })),
      () => changeWarehouseStatus(readOnly, created.id, { isActive: false }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
    }
    expect(await database.warehouse.findMany()).toHaveLength(1);
    expect(await getWarehouse(actor.staff, created.id)).toEqual(created);
    expect(await warehouseAudits()).toHaveLength(1);
  });

  it('refuses reads without inventory.read', async () => {
    const actor = await inventoryManager();
    const created = await createWarehouse(actor, createWarehouseSchema.parse(pune));
    const outsider = await createStaffMember(['orders.read']);
    await expect(listWarehouses(outsider)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(getWarehouse(outsider, created.id)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});
