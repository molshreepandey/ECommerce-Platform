import { getDatabase, isUniqueViolation, uniqueViolationConstraintName } from '@/lib/db';
import type { AuditData } from '@/modules/audit/audit.types';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';
import { enqueueProductsStockedInWarehouse } from '@/modules/search/search-outbox.repository';

import type { StaffInventoryActor } from './inventory-actor';
import { recordInventoryEvents } from './inventory-audit';
import { inventoryErrors } from './inventory.errors';
import type {
  ChangeWarehouseStatusInput,
  CreateWarehouseInput,
  UpdateWarehouseInput,
} from './inventory.schema';
import {
  findWarehouse,
  insertWarehouse,
  listWarehouseRows,
  lockWarehouseForWrite,
  reservedUnitsInWarehouse,
  updateWarehouseRow,
  type WarehouseFields,
  type WarehouseRow,
} from './warehouse.repository';

const editableFields = [
  'name',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'pincode',
  'contactName',
  'contactPhone',
  'priority',
] as const satisfies readonly (keyof WarehouseFields)[];

function warehouseAuditData(warehouse: WarehouseRow): AuditData {
  return {
    code: warehouse.code,
    name: warehouse.name,
    addressLine1: warehouse.addressLine1,
    addressLine2: warehouse.addressLine2,
    city: warehouse.city,
    state: warehouse.state,
    pincode: warehouse.pincode,
    contactName: warehouse.contactName,
    contactPhone: warehouse.contactPhone,
    priority: warehouse.priority,
    isActive: warehouse.isActive,
  };
}

// The submitted fields whose value really changes; undefined means "not submitted".
function changedFields(
  current: WarehouseRow,
  input: UpdateWarehouseInput,
): Partial<WarehouseFields> {
  const changes: Partial<WarehouseFields> = {};
  const consider = <Field extends (typeof editableFields)[number]>(
    field: Field,
    value: WarehouseFields[Field] | undefined,
  ) => {
    if (value !== undefined && value !== current[field]) changes[field] = value;
  };
  for (const field of editableFields) consider(field, input[field]);
  return changes;
}

function pick(warehouse: WarehouseRow, fields: readonly string[]): AuditData {
  const data = warehouseAuditData(warehouse);
  return Object.fromEntries(fields.map((field) => [field, data[field] ?? null]));
}

export async function listWarehouses(staff: StaffContext): Promise<WarehouseRow[]> {
  assertStaffPermission(staff, 'inventory.read');
  return await listWarehouseRows(getDatabase());
}

export async function getWarehouse(
  staff: StaffContext,
  warehouseId: string,
): Promise<WarehouseRow> {
  assertStaffPermission(staff, 'inventory.read');
  const warehouse = await findWarehouse(getDatabase(), warehouseId);
  if (warehouse === null) throw inventoryErrors.warehouseNotFound();
  return warehouse;
}

export async function createWarehouse(
  actor: StaffInventoryActor,
  input: CreateWarehouseInput,
): Promise<WarehouseRow> {
  assertStaffPermission(actor.staff, 'warehouses.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const warehouse = await insertWarehouse(transaction, {
        ...input,
        addressLine2: input.addressLine2 ?? null,
      });
      await recordInventoryEvents(transaction, actor, [
        {
          action: 'warehouse.created',
          entityType: 'warehouse',
          entityId: warehouse.id,
          after: warehouseAuditData(warehouse),
        },
      ]);
      return warehouse;
    });
  } catch (error) {
    if (
      isUniqueViolation(error) &&
      uniqueViolationConstraintName(error) === 'warehouses_code_key'
    ) {
      throw inventoryErrors.warehouseCodeTaken();
    }
    throw error;
  }
}

// Last save wins (owner decision, TD-019): only the submitted fields are written, so concurrent edits of
// different fields both survive, while concurrent edits of the same field keep the later one. Both are
// audited with their before and after values.
export async function updateWarehouse(
  actor: StaffInventoryActor,
  warehouseId: string,
  input: UpdateWarehouseInput,
): Promise<WarehouseRow> {
  assertStaffPermission(actor.staff, 'warehouses.write');
  return await getDatabase().$transaction(async (transaction) => {
    const before = await lockWarehouseForWrite(transaction, warehouseId);
    if (before === null) throw inventoryErrors.warehouseNotFound();
    const changes = changedFields(before, input);
    const fields = Object.keys(changes);
    if (fields.length === 0) return before;
    const after = await updateWarehouseRow(transaction, warehouseId, changes);
    await recordInventoryEvents(transaction, actor, [
      {
        action: 'warehouse.updated',
        entityType: 'warehouse',
        entityId: warehouseId,
        before: pick(before, fields),
        after: pick(after, fields),
      },
    ]);
    return after;
  });
}

// Deactivating stops new reservations there; it never releases or changes stock, and existing
// reservations stay until they are released or dispatched. Changing to the current status does nothing.
export async function changeWarehouseStatus(
  actor: StaffInventoryActor,
  warehouseId: string,
  input: ChangeWarehouseStatusInput,
): Promise<WarehouseRow> {
  assertStaffPermission(actor.staff, 'warehouses.write');
  return await getDatabase().$transaction(async (transaction) => {
    const before = await lockWarehouseForWrite(transaction, warehouseId);
    if (before === null) throw inventoryErrors.warehouseNotFound();
    if (before.isActive === input.isActive) return before;
    const after = await updateWarehouseRow(transaction, warehouseId, { isActive: input.isActive });
    const reservedUnitsKept = await reservedUnitsInWarehouse(transaction, warehouseId);
    await recordInventoryEvents(transaction, actor, [
      {
        action: 'warehouse.status_changed',
        entityType: 'warehouse',
        entityId: warehouseId,
        before: { isActive: before.isActive },
        after: { isActive: after.isActive, reservedUnitsKept },
      },
    ]);
    await enqueueProductsStockedInWarehouse(transaction, warehouseId);
    return after;
  });
}
