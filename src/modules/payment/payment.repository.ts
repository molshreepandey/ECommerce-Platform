import type { PaymentAttemptOutcome } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export async function lockPaymentOfOrder(database: DatabaseClient, orderId: string) {
  await database.$queryRaw`SELECT id FROM payments WHERE order_id = ${orderId}::uuid FOR UPDATE`;
  return database.payment.findUnique({
    where: { orderId },
    select: { id: true, status: true, paymentMethod: true, amountPaise: true },
  });
}

export function findAttemptByKey(
  database: DatabaseClient,
  paymentId: string,
  idempotencyKey: string,
) {
  return database.paymentAttempt.findUnique({
    where: { paymentId_idempotencyKey: { paymentId, idempotencyKey } },
    select: {
      id: true,
      requestFingerprint: true,
      outcome: true,
      declineCode: true,
      providerReference: true,
    },
  });
}

export function countDeclinedAttempts(
  database: DatabaseClient,
  paymentId: string,
): Promise<number> {
  return database.paymentAttempt.count({ where: { paymentId, outcome: 'DECLINED' } });
}

export function insertPaymentAttempt(
  database: DatabaseClient,
  attempt: {
    paymentId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    outcome: PaymentAttemptOutcome;
    declineCode: string | null;
    providerReference: string;
    amountPaise: number;
  },
) {
  return database.paymentAttempt.create({ data: attempt, select: { id: true } });
}

export function listPaymentAttempts(database: DatabaseClient, paymentId: string) {
  return database.paymentAttempt.findMany({
    where: { paymentId },
    select: {
      id: true,
      outcome: true,
      declineCode: true,
      providerReference: true,
      amountPaise: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

// A customer's online orders still waiting for payment inside the window (M4: each one holds stock).
export function countOpenUnpaidOnlineOrders(
  database: DatabaseClient,
  customerId: string,
  placedSince: Date,
): Promise<number> {
  return database.order.count({
    where: {
      customerId,
      paymentMethod: 'ONLINE',
      status: 'PLACED',
      placedAt: { gte: placedSince },
      payment: { status: 'PENDING' },
    },
  });
}

// Online orders still waiting for payment after the window (oldest first, bounded).
export function findExpiredUnpaidOnlineOrderIds(
  database: DatabaseClient,
  placedBefore: Date,
  limit: number,
) {
  return database.order.findMany({
    where: {
      paymentMethod: 'ONLINE',
      status: 'PLACED',
      placedAt: { lt: placedBefore },
      payment: { status: 'PENDING' },
    },
    select: { id: true },
    orderBy: [{ placedAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
}
