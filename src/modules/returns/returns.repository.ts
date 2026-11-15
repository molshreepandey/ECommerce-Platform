import type { Prisma } from '@/generated/prisma/client';
import type { ReturnRequestStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

// Per order line: what was delivered (and when), and what earlier non-rejected requests already claim.
export function findReturnableLines(database: DatabaseClient, orderId: string) {
  return database.orderItem.findMany({
    where: { orderId },
    select: {
      id: true,
      productId: true,
      productName: true,
      sku: true,
      quantity: true,
      unitPricePaise: true,
      variantId: true,
      shipmentItems: {
        where: { shipment: { status: 'DELIVERED' } },
        select: { quantity: true, shipment: { select: { deliveredAt: true } } },
      },
      returnRequestItems: {
        where: { returnRequest: { status: { not: 'REJECTED' } } },
        select: { quantity: true },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export function findExchangeOptions(database: DatabaseClient, productIds: readonly string[]) {
  return database.productVariant.findMany({
    where: { productId: { in: [...productIds] }, status: 'ACTIVE', product: { status: 'ACTIVE' } },
    select: { id: true, productId: true, sku: true, optionValues: true, pricePaise: true },
    orderBy: [{ sku: 'asc' }],
  });
}

export function countReturnsOfOrder(database: DatabaseClient, orderId: string): Promise<number> {
  return database.returnRequest.count({ where: { orderId } });
}

export function insertReturnRequest(
  database: DatabaseClient,
  data: Prisma.ReturnRequestUncheckedCreateInput,
) {
  return database.returnRequest.create({
    data,
    select: { id: true, returnNumber: true, status: true },
  });
}

export const returnDetailSelect = {
  id: true,
  returnNumber: true,
  requestType: true,
  status: true,
  reason: true,
  resolutionNote: true,
  requestedAt: true,
  decidedAt: true,
  receivingWarehouseId: true,
  exchangeOrderId: true,
  customerId: true,
  orderId: true,
  order: {
    select: { orderNumber: true, subtotalPaise: true, discountPaise: true, shippingAddress: true },
  },
  customer: { select: { fullName: true, email: true } },
  receivingWarehouse: { select: { name: true } },
  exchangeOrder: { select: { id: true, orderNumber: true } },
  refund: { select: { amountPaise: true, refundMethod: true, reference: true, refundedAt: true } },
  items: {
    select: {
      quantity: true,
      exchangeVariantId: true,
      orderItem: {
        select: { id: true, productName: true, sku: true, variantId: true, unitPricePaise: true },
      },
      exchangeVariant: { select: { sku: true } },
    },
    orderBy: { id: 'asc' },
  },
} as const satisfies Prisma.ReturnRequestSelect;

export type ReturnDetailRow = Prisma.ReturnRequestGetPayload<{ select: typeof returnDetailSelect }>;

export async function lockReturnRequest(
  database: DatabaseClient,
  returnRequestId: string,
): Promise<ReturnDetailRow | null> {
  await database.$queryRaw`SELECT id FROM return_requests WHERE id = ${returnRequestId}::uuid FOR UPDATE`;
  return database.returnRequest.findUnique({
    where: { id: returnRequestId },
    select: returnDetailSelect,
  });
}

export function listReturnRows(database: DatabaseClient, status: ReturnRequestStatus | null) {
  return database.returnRequest.findMany({
    where: status === null ? {} : { status },
    select: returnDetailSelect,
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
}

export function listReturnsOfOrder(database: DatabaseClient, orderId: string) {
  return database.returnRequest.findMany({
    where: { orderId },
    select: returnDetailSelect,
    orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
  });
}

export async function updateReturnStatusIfCurrent(
  database: DatabaseClient,
  returnRequestId: string,
  from: ReturnRequestStatus,
  data: Prisma.ReturnRequestUncheckedUpdateManyInput,
): Promise<boolean> {
  const { count } = await database.returnRequest.updateMany({
    where: { id: returnRequestId, status: from },
    data,
  });
  return count === 1;
}

export function insertRefund(database: DatabaseClient, data: Prisma.RefundUncheckedCreateInput) {
  return database.refund.create({ data, select: { id: true } });
}

export function findPaymentStatus(database: DatabaseClient, orderId: string) {
  return database.payment.findUnique({ where: { orderId }, select: { status: true } });
}
