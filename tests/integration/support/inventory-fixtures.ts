import { randomUUID } from 'node:crypto';

import type { ProductStatus, ProductVariantStatus } from '@/generated/prisma/enums';
import { getDatabase } from '@/lib/db';
import {
  type CustomerId,
  customerIdSchema,
  returnRequestIdSchema,
  shipmentIdSchema,
  staffUserIdSchema,
  variantIdSchema,
  warehouseIdSchema,
} from '@/lib/ids';
import type { StaffContext } from '@/modules/identity/access-control';
import type { PermissionCode } from '@/modules/identity/permissions';
import type { InventoryActor } from '@/modules/inventory/inventory-actor';

import { testMetadata } from './identity-fixtures';

const database = getDatabase();

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

// A real staff_users row (unlike staffWith(), whose id exists nowhere), so foreign keys such as
// inventory_change_requests.staff_user_id and the audit actor point at someone who exists.
export async function createStaffMember(
  permissionCodes: readonly PermissionCode[],
): Promise<StaffContext> {
  const staff = await database.staffUser.create({
    data: {
      fullName: 'Stock Keeper',
      email: `stock.keeper.${uniqueSuffix()}@example.test`,
      passwordHash: 'not-a-real-hash',
    },
    select: { id: true },
  });
  return {
    staffUserId: staffUserIdSchema.parse(staff.id),
    sessionId: randomUUID(),
    permissionCodes: new Set(permissionCodes),
  };
}

export function staffInventoryActor(
  staff: StaffContext,
): Extract<InventoryActor, { kind: 'STAFF' }> {
  return { kind: 'STAFF', staff, metadata: testMetadata() };
}

export async function createCustomerRow(): Promise<CustomerId> {
  const customer = await database.customer.create({
    data: {
      fullName: 'Asha Shopper',
      email: `asha.${uniqueSuffix()}@example.test`,
      phone: '9876500222',
      passwordHash: 'not-a-real-hash',
    },
    select: { id: true },
  });
  return customerIdSchema.parse(customer.id);
}

export async function createWarehouseRow(
  overrides: Partial<{ code: string; priority: number; isActive: boolean }> = {},
) {
  return database.warehouse.create({
    data: {
      code: overrides.code ?? `WH-${uniqueSuffix().toUpperCase()}`,
      name: 'Test Warehouse',
      addressLine1: '1 Test Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      contactName: 'Test Contact',
      contactPhone: '9876500000',
      priority: overrides.priority ?? 1,
      isActive: overrides.isActive ?? true,
    },
    select: { id: true, code: true, isActive: true },
  });
}

// A product with one variant, inserted directly so its statuses can be any combination.
export async function createVariantRow(
  statuses: { productStatus?: ProductStatus; variantStatus?: ProductVariantStatus } = {},
) {
  const suffix = uniqueSuffix();
  const productType = await database.productType.create({
    data: { code: `apparel_${suffix}`, name: 'Apparel' },
    select: { id: true },
  });
  const brand = await database.brand.create({
    data: { name: `Brand ${suffix}`, slug: `brand-${suffix}` },
    select: { id: true },
  });
  const productStatus = statuses.productStatus ?? 'ACTIVE';
  const product = await database.product.create({
    data: {
      productTypeId: productType.id,
      brandId: brand.id,
      name: `Kurta ${suffix}`,
      slug: `kurta-${suffix}`,
      taxRateBasisPoints: 500,
      status: productStatus,
      archivedAt: productStatus === 'ARCHIVED' ? new Date() : null,
    },
    select: { id: true },
  });
  const variant = await database.productVariant.create({
    data: {
      productId: product.id,
      sku: `KURTA-${suffix.toUpperCase()}-M`,
      optionSignature: 'size=M',
      mrpPaise: 99_900,
      pricePaise: 79_900,
      weightGrams: 300,
      lengthMm: 300,
      breadthMm: 250,
      heightMm: 30,
      status: statuses.variantStatus ?? 'ACTIVE',
    },
    select: { id: true, productId: true },
  });
  return { productId: variant.productId, variantId: variant.id };
}

export async function createStockLevelRow(input: {
  variantId: string;
  warehouseId: string;
  onHandQuantity: number;
  reservedQuantity?: number;
  lowStockThreshold?: number;
}) {
  await database.inventoryLevel.create({
    data: {
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      onHandQuantity: input.onHandQuantity,
      reservedQuantity: input.reservedQuantity ?? 0,
      lowStockThreshold: input.lowStockThreshold ?? 0,
    },
  });
}

// An order with one shipment from the given warehouse (amounts are placeholders; pricing is Wave 7).
export async function createShipmentRow(input: { customerId: string; warehouseId: string }) {
  const suffix = uniqueSuffix();
  const order = await database.order.create({
    data: {
      orderNumber: `ORD-T-${suffix.toUpperCase()}`,
      customerId: input.customerId,
      idempotencyKey: `test-order-${suffix}`,
      requestFingerprint: 'f'.repeat(64),
      subtotalPaise: 79_900,
      taxPaise: 3_805,
      totalPaise: 79_900,
      shippingAddress: { city: 'Bengaluru', pincode: '560001' },
    },
    select: { id: true },
  });
  return database.shipment.create({
    data: { orderId: order.id, warehouseId: input.warehouseId },
    select: { id: true, orderId: true, warehouseId: true },
  });
}

// A return request on a new order for the given variants (amounts are placeholders; returns are Wave 12).
// receivingWarehouseId null means the return has not been assigned a warehouse yet.
export async function createReturnRequestRow(input: {
  customerId: string;
  receivingWarehouseId: string | null;
  items: readonly { variantId: string; productId: string; quantity: number }[];
}) {
  const suffix = uniqueSuffix();
  const order = await database.order.create({
    data: {
      orderNumber: `ORD-R-${suffix.toUpperCase()}`,
      customerId: input.customerId,
      idempotencyKey: `test-return-order-${suffix}`,
      requestFingerprint: 'e'.repeat(64),
      subtotalPaise: 79_900,
      taxPaise: 3_805,
      totalPaise: 79_900,
      shippingAddress: { city: 'Bengaluru', pincode: '560001' },
    },
    select: { id: true },
  });
  const returnRequest = await database.returnRequest.create({
    data: {
      returnNumber: `RET-T-${suffix.toUpperCase()}`,
      orderId: order.id,
      customerId: input.customerId,
      requestType: 'RETURN',
      reason: 'Size does not fit',
      receivingWarehouseId: input.receivingWarehouseId,
    },
    select: { id: true },
  });
  for (const item of input.items) {
    const orderItem = await database.orderItem.create({
      data: {
        orderId: order.id,
        variantId: item.variantId,
        productId: item.productId,
        productName: 'Kurta',
        brandName: 'Brand',
        sku: `SKU-${uniqueSuffix()}`,
        quantity: item.quantity,
        mrpPaise: 99_900,
        unitPricePaise: 79_900,
        taxRateBasisPoints: 500,
        taxPaise: 3_805,
        lineTotalPaise: 79_900 * item.quantity,
      },
      select: { id: true },
    });
    await database.returnRequestItem.create({
      data: {
        returnRequestId: returnRequest.id,
        orderItemId: orderItem.id,
        quantity: item.quantity,
      },
    });
  }
  return { returnRequestId: returnRequestIdSchema.parse(returnRequest.id), orderId: order.id };
}

// One variant stocked in one warehouse, plus an inventory manager with real staff and audit identity.
export async function stockedLocation(
  input: {
    onHandQuantity?: number | null;
    reservedQuantity?: number;
    lowStockThreshold?: number;
    productStatus?: ProductStatus;
    variantStatus?: ProductVariantStatus;
    warehouseActive?: boolean;
  } = {},
) {
  const staff = await createStaffMember(['inventory.read', 'inventory.write']);
  const warehouse = await createWarehouseRow({ isActive: input.warehouseActive ?? true });
  const variant = await createVariantRow({
    ...(input.productStatus === undefined ? {} : { productStatus: input.productStatus }),
    ...(input.variantStatus === undefined ? {} : { variantStatus: input.variantStatus }),
  });
  const key = {
    variantId: variantIdSchema.parse(variant.variantId),
    warehouseId: warehouseIdSchema.parse(warehouse.id),
  };
  if (input.onHandQuantity !== null) {
    await createStockLevelRow({
      ...key,
      onHandQuantity: input.onHandQuantity ?? 10,
      reservedQuantity: input.reservedQuantity ?? 0,
      lowStockThreshold: input.lowStockThreshold ?? 0,
    });
  }
  return { staff, actor: staffInventoryActor(staff), key, productId: variant.productId };
}

// Everything a stock operation can write; equal snapshots mean nothing was persisted.
export async function inventoryState() {
  return {
    levels: await database.inventoryLevel.findMany({
      orderBy: [{ variantId: 'asc' }, { warehouseId: 'asc' }],
      select: {
        variantId: true,
        warehouseId: true,
        onHandQuantity: true,
        reservedQuantity: true,
        lowStockThreshold: true,
      },
    }),
    movements: await database.inventoryMovement.count(),
    changeRequests: await database.inventoryChangeRequest.count(),
    inventoryAudits: await database.auditLog.count({
      where: { entityType: { in: ['inventory_movement', 'inventory_level'] } },
    }),
    outbox: await database.searchOutbox.count(),
  };
}

export async function stockLevel(key: { variantId: string; warehouseId: string }) {
  return database.inventoryLevel.findUnique({
    where: { variantId_warehouseId: key },
    select: { onHandQuantity: true, reservedQuantity: true, lowStockThreshold: true },
  });
}

export function customerInventoryActor(
  customerId: CustomerId,
): Extract<InventoryActor, { kind: 'CUSTOMER' }> {
  return { kind: 'CUSTOMER', customerId, metadata: testMetadata() };
}

export function systemInventoryActor(process: string): Extract<InventoryActor, { kind: 'SYSTEM' }> {
  return { kind: 'SYSTEM', process, metadata: { requestId: `system-${uniqueSuffix()}` } };
}

export function reservationLine(
  shipmentId: string,
  key: { variantId: string; warehouseId: string },
  quantity: number,
) {
  return {
    shipmentId: shipmentIdSchema.parse(shipmentId),
    variantId: variantIdSchema.parse(key.variantId),
    warehouseId: warehouseIdSchema.parse(key.warehouseId),
    quantity,
  };
}
