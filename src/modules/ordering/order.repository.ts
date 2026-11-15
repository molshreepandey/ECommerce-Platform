import type { ActorType, OrderStatus, PaymentMethod } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export function findOrderByIdempotencyKey(
  database: DatabaseClient,
  customerId: string,
  idempotencyKey: string,
) {
  return database.order.findUnique({
    where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
    select: { id: true, orderNumber: true, requestFingerprint: true, paymentMethod: true },
  });
}

export async function nextOrderNumber(database: DatabaseClient): Promise<string> {
  const [row] = await database.$queryRaw<
    { value: bigint }[]
  >`SELECT nextval('order_number_seq') AS value`;
  if (row === undefined) throw new Error('order_number_seq returned no value');
  return `ORD-${row.value.toString()}`;
}

export interface NewOrder {
  orderNumber: string;
  customerId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  paymentMethod: PaymentMethod;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  shippingFeePaise: number;
  codFeePaise: number;
  totalPaise: number;
  shippingAddress: Record<string, string | null>;
  couponCode: string | null;
  metadata: Record<string, string | number | null>;
}

// ON CONFLICT DO NOTHING: a duplicate request that raced past the first check waits on the unique index
// and then gets null (the other one committed) instead of aborting this transaction.
export async function insertOrderIfNew(
  database: DatabaseClient,
  order: NewOrder,
): Promise<{ id: string; placedAt: Date } | null> {
  const rows = await database.$queryRaw<{ id: string; placed_at: Date }[]>`
    INSERT INTO orders (
      order_number, customer_id, idempotency_key, request_fingerprint, status, payment_method,
      subtotal_paise, discount_paise, tax_paise, shipping_fee_paise, cod_fee_paise, total_paise,
      currency_code, shipping_address, coupon_code, metadata
    ) VALUES (
      ${order.orderNumber}, ${order.customerId}::uuid, ${order.idempotencyKey},
      ${order.requestFingerprint}, 'PLACED'::"OrderStatus", ${order.paymentMethod}::"PaymentMethod",
      ${order.subtotalPaise}, ${order.discountPaise}, ${order.taxPaise}, ${order.shippingFeePaise},
      ${order.codFeePaise}, ${order.totalPaise}, 'INR', ${JSON.stringify(order.shippingAddress)}::jsonb,
      ${order.couponCode}, ${JSON.stringify(order.metadata)}::jsonb
    )
    ON CONFLICT (customer_id, idempotency_key) DO NOTHING
    RETURNING id, placed_at`;
  const [row] = rows;
  return row === undefined ? null : { id: row.id, placedAt: row.placed_at };
}

export interface NewOrderItem {
  variantId: string;
  productId: string;
  productName: string;
  brandName: string;
  sku: string;
  optionValues: Record<string, string>;
  imageUrl: string | null;
  quantity: number;
  mrpPaise: number;
  unitPricePaise: number;
  taxRateBasisPoints: number;
  taxPaise: number;
  lineTotalPaise: number;
  weightGrams: number;
  lengthMm: number;
  breadthMm: number;
  heightMm: number;
  categoryId: string | null;
  categoryPath: string | null;
  categoryName: string | null;
  productGroupId: string | null;
}

export function insertOrderItems(
  database: DatabaseClient,
  orderId: string,
  items: readonly NewOrderItem[],
) {
  return database.orderItem.createManyAndReturn({
    data: items.map((item) => ({ ...item, orderId })),
    select: { id: true, variantId: true },
  });
}

export function insertShipments(
  database: DatabaseClient,
  shipments: readonly { orderId: string; warehouseId: string; courierPartnerId: string }[],
) {
  return database.shipment.createManyAndReturn({
    data: [...shipments],
    select: { id: true, warehouseId: true },
  });
}

export async function insertShipmentItems(
  database: DatabaseClient,
  items: readonly { shipmentId: string; orderItemId: string; quantity: number }[],
): Promise<void> {
  await database.shipmentItem.createMany({ data: [...items] });
}

export function insertPayment(
  database: DatabaseClient,
  payment: { orderId: string; paymentMethod: PaymentMethod; amountPaise: number },
) {
  return database.payment.create({ data: payment, select: { id: true } });
}

export async function insertStatusHistory(
  database: DatabaseClient,
  entry: {
    orderId: string;
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    actorType: ActorType;
    actorId: string | null;
    reason: string | null;
  },
): Promise<void> {
  await database.orderStatusHistory.create({ data: entry, select: { id: true } });
}
