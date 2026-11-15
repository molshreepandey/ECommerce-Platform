import { createHash } from 'node:crypto';

import type { OrderStatus, PaymentAttemptOutcome, PaymentStatus } from '@/generated/prisma/enums';
import { canonicalJson } from '@/lib/canonical-json';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import type { CustomerContext, RequestMetadata } from '@/modules/identity/access-control';
import {
  lockOrder,
  updatePaymentStatusIfCurrent,
} from '@/modules/ordering/order-lifecycle.repository';
import { cancelOrderInTransaction } from '@/modules/ordering/order-lifecycle.service';
import { orderingErrors } from '@/modules/ordering/ordering.errors';

import {
  maximumDeclinedAttempts,
  onlinePaymentWindowMinutes,
  type SubmitPaymentInput,
} from './payment.schema';
import {
  countDeclinedAttempts,
  findAttemptByKey,
  findExpiredUnpaidOnlineOrderIds,
  insertPaymentAttempt,
  lockPaymentOfOrder,
} from './payment.repository';
import {
  chargeSimulatedGateway,
  declineMessages,
  isSimulatedGatewayAvailable,
} from './simulated-gateway';

export interface PaymentAttemptResult {
  outcome: PaymentAttemptOutcome;
  declineCode: string | null;
  message: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  attemptsRemaining: number;
  isReplay: boolean;
}

const paymentErrors = {
  notOnline: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'PAYMENT_NOT_ONLINE',
      message: 'This order is paid on delivery; there is nothing to pay online.',
    }),
  alreadyCollected: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'PAYMENT_ALREADY_COLLECTED',
      message: 'This order is already paid.',
    }),
  closed: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'PAYMENT_CLOSED',
      message: 'This order can no longer be paid. It was cancelled.',
    }),
  expired: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'PAYMENT_EXPIRED',
      message: `Payment was not completed within ${String(onlinePaymentWindowMinutes)} minutes, so the order was cancelled.`,
    }),
  amountMismatch: (amountPaise: number) =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'PAYMENT_AMOUNT_MISMATCH',
      message: 'The payment amount does not match the order total.',
      details: { amountPaise },
    }),
  keyReused: () =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This payment request was already used with different details.',
    }),
};

function paymentWindowEnded(placedAt: Date, now: Date): boolean {
  return now.getTime() - placedAt.getTime() > onlinePaymentWindowMinutes * 60_000;
}

function attemptMessage(outcome: PaymentAttemptOutcome, declineCode: string | null): string {
  if (outcome === 'SUCCEEDED') return 'Payment successful.';
  return declineMessages[declineCode ?? ''] ?? 'The payment was declined.';
}

type AttemptTransactionResult =
  { kind: 'ATTEMPT'; result: PaymentAttemptResult } | { kind: 'EXPIRED' };

// Owner decision 2026-11-14: a simulated online payment for an ONLINE order. One attempt per
// Idempotency-Key (a repeat returns the stored result, never charges twice); at most one success per
// payment (database index); after three declines, or once the 30-minute window has passed, the order is
// cancelled, its stock released and the payment marked FAILED.
export async function submitOnlinePayment(
  customer: CustomerContext,
  orderId: string,
  input: SubmitPaymentInput,
  idempotencyKey: string,
  metadata: RequestMetadata,
): Promise<PaymentAttemptResult> {
  if (!isSimulatedGatewayAvailable()) throw orderingErrors.onlinePaymentUnavailable();
  await enforceRateLimit({ action: 'payment-attempt', identifier: customer.customerId });
  const fingerprint = createHash('sha256').update(canonicalJson(input)).digest('hex');
  const outcome = await getDatabase().$transaction(
    async (transaction): Promise<AttemptTransactionResult> => {
      const order = await lockOrder(transaction, orderId);
      if (order === null || order.customerId !== customer.customerId)
        throw orderingErrors.orderNotFound();
      if (order.paymentMethod !== 'ONLINE') throw paymentErrors.notOnline();
      const payment = await lockPaymentOfOrder(transaction, orderId);
      if (payment === null) throw orderingErrors.orderNotFound();

      const previous = await findAttemptByKey(transaction, payment.id, idempotencyKey);
      if (previous !== null) {
        if (previous.requestFingerprint !== fingerprint) throw paymentErrors.keyReused();
        const declines = await countDeclinedAttempts(transaction, payment.id);
        return {
          kind: 'ATTEMPT',
          result: {
            outcome: previous.outcome,
            declineCode: previous.declineCode,
            message: attemptMessage(previous.outcome, previous.declineCode),
            paymentStatus: payment.status,
            orderStatus: order.status,
            attemptsRemaining: Math.max(0, maximumDeclinedAttempts - declines),
            isReplay: true,
          },
        };
      }
      if (payment.status === 'COLLECTED') throw paymentErrors.alreadyCollected();
      if (payment.status !== 'PENDING' || order.status !== 'PLACED') throw paymentErrors.closed();
      if (paymentWindowEnded(order.placedAt, new Date())) {
        await cancelOrderInTransaction(transaction, {
          orderId,
          actor: {
            kind: 'SYSTEM',
            process: 'online-payment-expiry',
            metadata: { requestId: metadata.requestId },
          },
          reason: `Online payment not completed within ${String(onlinePaymentWindowMinutes)} minutes`,
          paymentOutcome: 'FAILED',
        });
        return { kind: 'EXPIRED' };
      }
      if (input.amountPaise !== payment.amountPaise)
        throw paymentErrors.amountMismatch(payment.amountPaise);

      const charge = chargeSimulatedGateway(input.scenario);
      const declineCode = charge.outcome === 'DECLINED' ? charge.declineCode : null;
      await insertPaymentAttempt(transaction, {
        paymentId: payment.id,
        idempotencyKey,
        requestFingerprint: fingerprint,
        outcome: charge.outcome,
        declineCode,
        providerReference: charge.providerReference,
        amountPaise: payment.amountPaise,
      });
      await recordAuditEvent(transaction, {
        actorType: 'CUSTOMER',
        actorId: customer.customerId,
        action: 'payment.attempted',
        entityType: 'order',
        entityId: orderId,
        after: {
          outcome: charge.outcome,
          declineCode,
          providerReference: charge.providerReference,
        },
        ipAddress: metadata.clientIp,
        requestId: metadata.requestId,
      });
      let paymentStatus: PaymentStatus = 'PENDING';
      let orderStatus: OrderStatus = order.status;
      if (charge.outcome === 'SUCCEEDED') {
        await updatePaymentStatusIfCurrent(
          transaction,
          orderId,
          'PENDING',
          'COLLECTED',
          new Date(),
          charge.providerReference,
        );
        await recordAuditEvent(transaction, {
          actorType: 'CUSTOMER',
          actorId: customer.customerId,
          action: 'payment.status_changed',
          entityType: 'order',
          entityId: orderId,
          before: { paymentStatus: 'PENDING' },
          after: { paymentStatus: 'COLLECTED', paymentMethod: 'ONLINE' },
          ipAddress: metadata.clientIp,
          requestId: metadata.requestId,
        });
        paymentStatus = 'COLLECTED';
      }
      const declines = await countDeclinedAttempts(transaction, payment.id);
      if (charge.outcome === 'DECLINED' && declines >= maximumDeclinedAttempts) {
        await cancelOrderInTransaction(transaction, {
          orderId,
          actor: { kind: 'CUSTOMER', customerId: customer.customerId, metadata },
          reason: `Online payment declined ${String(maximumDeclinedAttempts)} times`,
          paymentOutcome: 'FAILED',
        });
        paymentStatus = 'FAILED';
        orderStatus = 'CANCELLED';
      }
      return {
        kind: 'ATTEMPT',
        result: {
          outcome: charge.outcome,
          declineCode,
          message: attemptMessage(charge.outcome, declineCode),
          paymentStatus,
          orderStatus,
          attemptsRemaining: Math.max(0, maximumDeclinedAttempts - declines),
          isReplay: false,
        },
      };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
  if (outcome.kind === 'EXPIRED') throw paymentErrors.expired();
  return outcome.result;
}

// Cancels online orders whose payment window ended (run after checkout and order-list requests, and by
// `npm run orders:expire-unpaid`). Each order is its own transaction; one that changed meanwhile is skipped.
export async function expireUnpaidOnlineOrders(input: {
  now?: Date;
  limit?: number;
  requestId: string;
}): Promise<number> {
  const now = input.now ?? new Date();
  const database = getDatabase();
  const orders = await findExpiredUnpaidOnlineOrderIds(
    database,
    new Date(now.getTime() - onlinePaymentWindowMinutes * 60_000),
    input.limit ?? 20,
  );
  let expired = 0;
  for (const { id } of orders) {
    try {
      await database.$transaction(async (transaction) => {
        const order = await lockOrder(transaction, id);
        if (order?.status !== 'PLACED') return;
        await cancelOrderInTransaction(transaction, {
          orderId: id,
          actor: {
            kind: 'SYSTEM',
            process: 'online-payment-expiry',
            metadata: { requestId: input.requestId },
          },
          reason: `Online payment not completed within ${String(onlinePaymentWindowMinutes)} minutes`,
          paymentOutcome: 'FAILED',
        });
        expired += 1;
      });
    } catch (error) {
      getLogger().warn({ err: error, orderId: id }, 'unpaid online order could not be expired');
    }
  }
  return expired;
}
