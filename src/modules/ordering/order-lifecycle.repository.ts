import type {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ShipmentStatus,
} from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export interface LockedOrder {
  id: string;
  orderNumber: string;
  customerId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  totalPaise: number;
  shippingPincode: string | null;
  shippingPhone: string | null;
  placedAt: Date;
}

// L0a (TD-019): the order row first, before its shipments and before any inventory lock.
export async function lockOrder(
  database: DatabaseClient,
  orderId: string,
): Promise<LockedOrder | null> {
  const [row] = await database.$queryRaw<
    {
      id: string;
      order_number: string;
      customer_id: string;
      status: OrderStatus;
      payment_method: PaymentMethod;
      total_paise: number;
      pincode: string | null;
      phone: string | null;
      placed_at: Date;
    }[]
  >`
    SELECT id, order_number, customer_id, status, payment_method, total_paise,
           shipping_address->>'pincode' AS pincode, shipping_address->>'phone' AS phone, placed_at
    FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return row === undefined
    ? null
    : {
        id: row.id,
        orderNumber: row.order_number,
        customerId: row.customer_id,
        status: row.status,
        paymentMethod: row.payment_method,
        totalPaise: row.total_paise,
        shippingPincode: row.pincode,
        shippingPhone: row.phone,
        placedAt: row.placed_at,
      };
}

export interface LockedShipment {
  id: string;
  warehouseId: string;
  status: ShipmentStatus;
  courierPartnerId: string | null;
  awbNumber: string | null;
  deliveryAttemptCount: number;
}

// L0b: every shipment of the order, in id order.
export async function lockShipmentsOfOrder(
  database: DatabaseClient,
  orderId: string,
): Promise<LockedShipment[]> {
  const rows = await database.$queryRaw<
    {
      id: string;
      warehouse_id: string;
      status: ShipmentStatus;
      courier_partner_id: string | null;
      awb_number: string | null;
      delivery_attempt_count: number;
    }[]
  >`
    SELECT id, warehouse_id, status, courier_partner_id, awb_number, delivery_attempt_count
    FROM shipments WHERE order_id = ${orderId}::uuid ORDER BY id FOR NO KEY UPDATE`;
  return rows.map((row) => ({
    id: row.id,
    warehouseId: row.warehouse_id,
    status: row.status,
    courierPartnerId: row.courier_partner_id,
    awbNumber: row.awb_number,
    deliveryAttemptCount: row.delivery_attempt_count,
  }));
}

export function findShipmentOrderId(database: DatabaseClient, shipmentId: string) {
  return database.shipment.findUnique({ where: { id: shipmentId }, select: { orderId: true } });
}

export function findShipmentByAwb(database: DatabaseClient, awbNumber: string) {
  return database.shipment.findUnique({
    where: { awbNumber },
    select: { id: true, orderId: true, courierPartnerId: true },
  });
}

// The stock lines of shipments: variant from the order line, warehouse from the shipment.
export async function findShipmentStockLines(
  database: DatabaseClient,
  shipmentIds: readonly string[],
): Promise<{ shipmentId: string; variantId: string; warehouseId: string; quantity: number }[]> {
  if (shipmentIds.length === 0) return [];
  const rows = await database.shipmentItem.findMany({
    where: { shipmentId: { in: [...shipmentIds] } },
    select: {
      shipmentId: true,
      quantity: true,
      orderItem: { select: { variantId: true } },
      shipment: { select: { warehouseId: true } },
    },
  });
  return rows.map((row) => ({
    shipmentId: row.shipmentId,
    variantId: row.orderItem.variantId,
    warehouseId: row.shipment.warehouseId,
    quantity: row.quantity,
  }));
}

export async function updateOrderStatusIfCurrent(
  database: DatabaseClient,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
): Promise<boolean> {
  const { count } = await database.order.updateMany({
    where: { id: orderId, status: from },
    data: { status: to },
  });
  return count === 1;
}

export async function updateShipmentIfCurrent(
  database: DatabaseClient,
  shipmentId: string,
  from: ShipmentStatus,
  data: {
    status: ShipmentStatus;
    awbNumber?: string;
    providerShipmentId?: string;
    labelUrl?: string;
    packedAt?: Date;
    shippedAt?: Date;
    deliveredAt?: Date;
    cancelledAt?: Date;
    rtoReceivedAt?: Date;
    deliveryAttemptCount?: number;
  },
): Promise<boolean> {
  const { count } = await database.shipment.updateMany({
    where: { id: shipmentId, status: from },
    data,
  });
  return count === 1;
}

export function findPaymentForOrder(database: DatabaseClient, orderId: string) {
  return database.payment.findUnique({
    where: { orderId },
    select: { id: true, status: true, paymentMethod: true, amountPaise: true },
  });
}

export async function updatePaymentStatusIfCurrent(
  database: DatabaseClient,
  orderId: string,
  from: PaymentStatus,
  to: PaymentStatus,
  at: Date,
  reference?: string,
): Promise<boolean> {
  const { count } = await database.payment.updateMany({
    where: { orderId, status: from },
    data: {
      status: to,
      ...(to === 'COLLECTED' ? { collectedAt: at } : {}),
      ...(to === 'FAILED' ? { failedAt: at } : {}),
      ...(to === 'VOIDED' ? { voidedAt: at } : {}),
      ...(reference === undefined ? {} : { reference }),
    },
  });
  return count === 1;
}

export async function insertTrackingEvent(
  database: DatabaseClient,
  event: {
    shipmentId: string;
    providerEventId: string;
    status: ShipmentStatus;
    description: string;
    location: string | null;
    occurredAt: Date;
  },
): Promise<void> {
  await database.shipmentTrackingEvent.createMany({ data: [event], skipDuplicates: true });
}

export function findCourierAdapterKey(database: DatabaseClient, courierPartnerId: string) {
  return database.courierPartner.findUnique({
    where: { id: courierPartnerId },
    select: { adapterKey: true, code: true },
  });
}

export function findShipmentForScan(database: DatabaseClient, shipmentId: string) {
  return database.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      status: true,
      awbNumber: true,
      courierPartnerId: true,
      warehouse: { select: { city: true } },
    },
  });
}

export function findShipmentLabelRow(database: DatabaseClient, shipmentId: string) {
  return database.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      awbNumber: true,
      status: true,
      courierPartner: { select: { name: true } },
      warehouse: { select: { name: true, city: true, pincode: true } },
      items: { select: { quantity: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          paymentMethod: true,
          totalPaise: true,
          shippingAddress: true,
          payment: { select: { status: true } },
        },
      },
    },
  });
}

export function findPackingSlipRow(database: DatabaseClient, shipmentId: string) {
  return database.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      awbNumber: true,
      warehouse: { select: { name: true, code: true } },
      items: {
        select: {
          quantity: true,
          orderItem: { select: { productName: true, sku: true, optionValues: true } },
        },
        orderBy: { id: 'asc' },
      },
      order: { select: { orderNumber: true, placedAt: true, shippingAddress: true } },
    },
  });
}

// D35: shipments handed to the courier from one warehouse during one IST day.
export function listManifestRows(
  database: DatabaseClient,
  warehouseId: string,
  from: Date,
  to: Date,
) {
  return database.shipment.findMany({
    where: { warehouseId, shippedAt: { gte: from, lt: to } },
    select: {
      id: true,
      awbNumber: true,
      status: true,
      shippedAt: true,
      courierPartner: { select: { name: true } },
      items: { select: { quantity: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          paymentMethod: true,
          totalPaise: true,
          shippingAddress: true,
          payment: { select: { status: true } },
        },
      },
    },
    orderBy: [{ shippedAt: 'asc' }, { id: 'asc' }],
  });
}

export function findShipmentItemsForMove(database: DatabaseClient, shipmentId: string) {
  return database.shipmentItem.findMany({
    where: { shipmentId },
    select: { orderItemId: true, quantity: true, orderItem: { select: { variantId: true } } },
    orderBy: { id: 'asc' },
  });
}

export function findWarehouseName(database: DatabaseClient, warehouseId: string) {
  return database.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, name: true },
  });
}

export function listOrdersForBulk(database: DatabaseClient, orderIds: readonly string[]) {
  return database.order.findMany({
    where: { id: { in: [...orderIds] } },
    select: {
      id: true,
      orderNumber: true,
      shipments: { select: { id: true, status: true }, orderBy: { id: 'asc' } },
    },
  });
}
