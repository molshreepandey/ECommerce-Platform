import type { Prisma } from '@/generated/prisma/client';
import type { OrderStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export const orderSummarySelect = {
  id: true,
  orderNumber: true,
  status: true,
  paymentMethod: true,
  totalPaise: true,
  placedAt: true,
  payment: { select: { status: true } },
  _count: { select: { items: true } },
} as const satisfies Prisma.OrderSelect;

export type OrderSummaryRow = Prisma.OrderGetPayload<{ select: typeof orderSummarySelect }>;

// Keyset pages on (placed_at DESC, id DESC): orders(customer_id, placed_at DESC) for a customer,
// orders(status, placed_at DESC) or orders(placed_at) for staff (plan §9.4). placed_at has microseconds
// but a JS Date only milliseconds, so the cursor is exact without carrying the time: every row before the
// cursor's millisecond, plus the rows inside that millisecond that PostgreSQL itself sorts after it.
export interface OrderPageCursor {
  placedBefore: Date;
  sameMillisecondIdsAfter: string[];
}

export async function findOrderPageCursor(
  database: DatabaseClient,
  orderId: string,
): Promise<OrderPageCursor | null> {
  const rows = await database.$queryRaw<{ floor: Date; id: string | null }[]>`
    SELECT date_trunc('milliseconds', c.placed_at) AS floor, o.id::text AS id
    FROM orders c
    LEFT JOIN orders o
      ON o.placed_at >= date_trunc('milliseconds', c.placed_at)
     AND (o.placed_at, o.id) < (c.placed_at, c.id)
    WHERE c.id = ${orderId}::uuid`;
  const [first] = rows;
  if (first === undefined) return null;
  return {
    placedBefore: first.floor,
    sameMillisecondIdsAfter: rows.flatMap(({ id }) => (id === null ? [] : [id])),
  };
}

function afterCursor(cursor: OrderPageCursor | null): Prisma.OrderWhereInput {
  if (cursor === null) return {};
  return {
    OR: [{ placedAt: { lt: cursor.placedBefore } }, { id: { in: cursor.sameMillisecondIdsAfter } }],
  };
}

export function listCustomerOrderRows(
  database: DatabaseClient,
  input: {
    customerId: string;
    status: OrderStatus | null;
    cursor: OrderPageCursor | null;
    limit: number;
  },
) {
  return database.order.findMany({
    where: {
      customerId: input.customerId,
      ...(input.status === null ? {} : { status: input.status }),
      ...afterCursor(input.cursor),
    },
    select: orderSummarySelect,
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
  });
}

export interface StaffOrderFilters {
  search: string | null;
  status: OrderStatus | null;
  paymentMethod: 'COD' | 'ONLINE' | null;
  placedFrom: Date | null;
  placedTo: Date | null;
  cursor: OrderPageCursor | null;
  limit: number;
}

// D31: order number, phone, email or AWB. Exact matches on indexed columns, so no scan of every order.
function searchCondition(search: string | null): Prisma.OrderWhereInput {
  if (search === null) return {};
  const term = search.trim();
  return {
    OR: [
      { orderNumber: term.toUpperCase() },
      { customer: { email: term.toLowerCase() } },
      { customer: { phone: term } },
      { shipments: { some: { awbNumber: term.toUpperCase() } } },
    ],
  };
}

export function listStaffOrderRows(database: DatabaseClient, filters: StaffOrderFilters) {
  return database.order.findMany({
    where: {
      ...searchCondition(filters.search),
      ...(filters.status === null ? {} : { status: filters.status }),
      ...(filters.paymentMethod === null ? {} : { paymentMethod: filters.paymentMethod }),
      ...(filters.placedFrom === null && filters.placedTo === null
        ? {}
        : {
            placedAt: {
              ...(filters.placedFrom === null ? {} : { gte: filters.placedFrom }),
              ...(filters.placedTo === null ? {} : { lt: filters.placedTo }),
            },
          }),
      AND: [afterCursor(filters.cursor)],
    },
    select: {
      ...orderSummarySelect,
      customer: { select: { fullName: true, email: true } },
    },
    orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
    take: filters.limit + 1,
  });
}

export function findOrderDetailRow(database: DatabaseClient, orderId: string) {
  return database.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      customerId: true,
      status: true,
      paymentMethod: true,
      subtotalPaise: true,
      discountPaise: true,
      taxPaise: true,
      shippingFeePaise: true,
      codFeePaise: true,
      totalPaise: true,
      currencyCode: true,
      shippingAddress: true,
      couponCode: true,
      placedAt: true,
      metadata: true,
      customer: { select: { id: true, fullName: true, email: true, phone: true, status: true } },
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          brandName: true,
          sku: true,
          optionValues: true,
          imageUrl: true,
          quantity: true,
          mrpPaise: true,
          unitPricePaise: true,
          taxPaise: true,
          lineTotalPaise: true,
          categoryName: true,
          product: { select: { slug: true } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
      shipments: {
        select: {
          id: true,
          status: true,
          awbNumber: true,
          labelUrl: true,
          deliveryAttemptCount: true,
          shippedAt: true,
          deliveredAt: true,
          warehouse: { select: { id: true, name: true, code: true } },
          courierPartner: { select: { name: true, adapterKey: true } },
          items: { select: { orderItemId: true, quantity: true } },
          trackingEvents: {
            select: { id: true, status: true, description: true, location: true, occurredAt: true },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ id: 'asc' }],
      },
      payment: {
        select: {
          id: true,
          paymentMethod: true,
          status: true,
          amountPaise: true,
          collectedAt: true,
          failedAt: true,
          voidedAt: true,
          reference: true,
          attempts: {
            select: {
              id: true,
              outcome: true,
              declineCode: true,
              providerReference: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      },
      statusHistory: {
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          actorType: true,
          reason: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

export type OrderDetailRow = NonNullable<Awaited<ReturnType<typeof findOrderDetailRow>>>;

export function findCustomerOrderNumber(database: DatabaseClient, orderId: string) {
  return database.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
}

export function listOrderAuditRows(
  database: DatabaseClient,
  orderId: string,
  shipmentIds: readonly string[],
) {
  return database.auditLog.findMany({
    where: {
      OR: [
        { entityType: 'order', entityId: orderId },
        ...(shipmentIds.length === 0
          ? []
          : [{ entityType: 'shipment', entityId: { in: [...shipmentIds] } }]),
      ],
    },
    select: {
      id: true,
      actorType: true,
      actorId: true,
      action: true,
      before: true,
      after: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
}
