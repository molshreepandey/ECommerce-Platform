import { randomInt, randomUUID } from 'node:crypto';

import { getDatabase } from '@/lib/db';
import { customerIdSchema } from '@/lib/ids';
import type { CustomerContext, StaffContext } from '@/modules/identity/access-control';
import type { PermissionCode } from '@/modules/identity/permissions';
import { placeOrder } from '@/modules/ordering/checkout.service';
import { quoteCheckout } from '@/modules/ordering/checkout.service';
import { addToCustomerCart } from '@/modules/cart/cart.service';

import { testMetadata } from './identity-fixtures';
import {
  createStaffMember,
  createStockLevelRow,
  createVariantRow,
  createWarehouseRow,
} from './inventory-fixtures';

const database = getDatabase();

export const servicedPincode = '411001';
export const unservicedPincode = '999999';

function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export function idempotencyKey(): string {
  return `test-key-${randomUUID()}`;
}

// A signed-in customer with one default delivery address.
export async function createShopper(pincode = servicedPincode): Promise<{
  customer: CustomerContext;
  addressId: string;
}> {
  // Own phone number per shopper: customers.phone is unique and tests create several shoppers.
  const customer = await database.customer.create({
    data: {
      fullName: 'Asha Shopper',
      email: `shopper.${uniqueSuffix()}@example.test`,
      phone: `9${String(randomInt(100_000_000, 1_000_000_000))}`,
      passwordHash: 'not-a-real-hash',
    },
    select: { id: true },
  });
  const customerId = customer.id;
  const address = await database.customerAddress.create({
    data: {
      customerId,
      recipientName: 'Asha Shopper',
      phone: '9876500222',
      addressLine1: '12 MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode,
      isDefault: true,
    },
    select: { id: true },
  });
  return {
    customer: { customerId: customerIdSchema.parse(customerId), sessionId: randomUUID() },
    addressId: address.id,
  };
}

export async function createCourier(
  input: {
    pincodes?: readonly string[];
    supportsCod?: boolean;
    codAvailable?: boolean;
    maxCodValuePaise?: number | null;
    priority?: number;
  } = {},
) {
  const courier = await database.courierPartner.create({
    data: {
      code: `courier-${uniqueSuffix()}`,
      name: 'Test Express',
      adapterKey: 'demo_courier',
      priority: input.priority ?? 1,
      supportsCod: input.supportsCod ?? true,
    },
    select: { id: true, code: true },
  });
  for (const pincode of input.pincodes ?? [servicedPincode]) {
    await database.courierServiceablePincode.create({
      data: {
        courierPartnerId: courier.id,
        pincode,
        codAvailable: input.codAvailable ?? true,
        maxCodValuePaise: input.maxCodValuePaise === undefined ? 2_000_000 : input.maxCodValuePaise,
        etaDays: 3,
      },
    });
  }
  return courier;
}

// One sellable variant (₹799 price, ₹999 MRP, 5% GST) stocked in the given warehouses.
export async function stockedVariant(
  stock: readonly { priority: number; onHandQuantity: number }[],
) {
  const variant = await createVariantRow();
  const warehouseIds: string[] = [];
  for (const location of stock) {
    const warehouse = await createWarehouseRow({ priority: location.priority });
    await createStockLevelRow({
      variantId: variant.variantId,
      warehouseId: warehouse.id,
      onHandQuantity: location.onHandQuantity,
    });
    warehouseIds.push(warehouse.id);
  }
  return { ...variant, warehouseIds };
}

export async function stockTotals(variantId: string) {
  const levels = await database.inventoryLevel.findMany({
    where: { variantId },
    select: { warehouseId: true, onHandQuantity: true, reservedQuantity: true },
    orderBy: { warehouseId: 'asc' },
  });
  return {
    levels,
    onHand: levels.reduce((total, level) => total + level.onHandQuantity, 0),
    reserved: levels.reduce((total, level) => total + level.reservedQuantity, 0),
  };
}

export async function orderStaff(
  permissions: readonly PermissionCode[] = ['orders.read', 'orders.write'],
): Promise<StaffContext> {
  return createStaffMember(permissions);
}

// Adds the items, quotes the total like the checkout page, and places the order.
export async function checkoutWith(input: {
  customer: CustomerContext;
  addressId: string;
  lines: readonly { variantId: string; quantity: number }[];
  paymentMethod?: 'COD' | 'ONLINE';
  key?: string;
}) {
  for (const line of input.lines) await addToCustomerCart(input.customer, line);
  const paymentMethod = input.paymentMethod ?? 'COD';
  const quote = await quoteCheckout(input.customer, { addressId: input.addressId, paymentMethod });
  return placeOrder(
    input.customer,
    { addressId: input.addressId, paymentMethod, expectedTotalPaise: quote.breakdown.totalPaise },
    input.key ?? idempotencyKey(),
    testMetadata(),
  );
}

export function orderWithRelations(orderId: string) {
  return database.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      totalPaise: true,
      paymentMethod: true,
      payment: { select: { status: true, amountPaise: true } },
      shipments: {
        select: { id: true, status: true, warehouseId: true, awbNumber: true },
        orderBy: { id: 'asc' },
      },
      items: { select: { quantity: true, weightGrams: true, categoryName: true } },
      statusHistory: { select: { toStatus: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
}
