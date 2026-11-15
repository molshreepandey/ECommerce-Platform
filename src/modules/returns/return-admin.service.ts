import { z } from 'zod';

import type { Prisma } from '@/generated/prisma/client';
import type { ReturnRequestStatus } from '@/generated/prisma/enums';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import type { AuditAction, AuditData } from '@/modules/audit/audit.types';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';
import { restockCustomerReturn } from '@/modules/inventory/stock-restock.service';
import { createExchangeOrder } from '@/modules/ordering/exchange-order.service';
import { findWarehouseName } from '@/modules/ordering/order-lifecycle.repository';

import { canMoveReturn, refundablePerUnitPaise } from './return-rules';
import type { DecideReturnInput, RefundInput } from './returns.schema';
import {
  findPaymentStatus,
  insertRefund,
  listReturnRows,
  lockReturnRequest,
  type ReturnDetailRow,
  updateReturnStatusIfCurrent,
} from './returns.repository';

const transactionOptions = { maxWait: 5_000, timeout: 15_000 } as const;

const notFound = () =>
  new DomainError({
    kind: 'NOT_FOUND',
    code: 'RETURN_NOT_FOUND',
    message: 'This return request was not found.',
  });

function invalidStep(from: ReturnRequestStatus, to: ReturnRequestStatus) {
  return new DomainError({
    kind: 'CONFLICT',
    code: 'INVALID_TRANSITION',
    message: 'This change is not allowed in the current status.',
    details: { returnStatus: from, requestedStatus: to },
  });
}

export function listReturns(staff: StaffContext, status: ReturnRequestStatus | null) {
  assertStaffPermission(staff, 'orders.read');
  return listReturnRows(getDatabase(), status);
}

// The maximum refund: what was paid for the returned units after the order's coupon.
export function maximumRefundPaise(request: ReturnDetailRow): number {
  return request.items.reduce(
    (total, item) =>
      total +
      item.quantity *
        refundablePerUnitPaise({
          unitPricePaise: item.orderItem.unitPricePaise,
          subtotalPaise: request.order.subtotalPaise,
          discountPaise: request.order.discountPaise,
        }),
    0,
  );
}

// L60 resolved: every step locks the return request row first (before any inventory lock), so its
// receiving warehouse and quantities cannot change while it is restocked.
async function step(
  staff: StaffContext,
  metadata: RequestMetadata,
  returnRequestId: string,
  to: ReturnRequestStatus,
  work: (
    transaction: DatabaseClient,
    request: ReturnDetailRow,
  ) => Promise<{
    data?: Omit<Prisma.ReturnRequestUncheckedUpdateManyInput, 'status'>;
    audit?: AuditData;
    action?: AuditAction;
  }>,
): Promise<void> {
  assertStaffPermission(staff, 'returns.write');
  await getDatabase().$transaction(async (transaction) => {
    const request = await lockReturnRequest(transaction, returnRequestId);
    if (request === null) throw notFound();
    if (!canMoveReturn(request.status, to, request.requestType))
      throw invalidStep(request.status, to);
    const result = await work(transaction, request);
    if (
      !(await updateReturnStatusIfCurrent(transaction, returnRequestId, request.status, {
        status: to,
        ...result.data,
      }))
    ) {
      throw invalidStep(request.status, to);
    }
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: result.action ?? 'return.status_changed',
      entityType: 'return_request',
      entityId: returnRequestId,
      before: { status: request.status },
      after: { status: to, ...result.audit },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
  }, transactionOptions);
}

export async function decideReturn(
  staff: StaffContext,
  returnRequestId: string,
  input: DecideReturnInput,
  metadata: RequestMetadata,
): Promise<void> {
  const to = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await step(staff, metadata, returnRequestId, to, async (transaction) => {
    if (input.decision === 'REJECT') {
      return {
        data: {
          resolutionNote: input.note,
          decidedByStaffId: staff.staffUserId,
          decidedAt: new Date(),
        },
      };
    }
    if ((await findWarehouseName(transaction, input.receivingWarehouseId)) === null) {
      throw new DomainError({
        kind: 'UNPROCESSABLE',
        code: 'WAREHOUSE_NOT_FOUND',
        message: 'Choose a warehouse to receive the return.',
      });
    }
    return {
      data: {
        receivingWarehouseId: input.receivingWarehouseId,
        resolutionNote: input.note ?? null,
        decidedByStaffId: staff.staffUserId,
        decidedAt: new Date(),
      },
      audit: { receivingWarehouseId: input.receivingWarehouseId },
    };
  });
}

export async function markReturnPickedUp(
  staff: StaffContext,
  returnRequestId: string,
  metadata: RequestMetadata,
) {
  await step(staff, metadata, returnRequestId, 'PICKED_UP', () => Promise.resolve({}));
}

export async function markReturnReceived(
  staff: StaffContext,
  returnRequestId: string,
  metadata: RequestMetadata,
) {
  await step(staff, metadata, returnRequestId, 'RECEIVED', () => Promise.resolve({}));
}

// Restock into the receiving warehouse through the inventory primitive (limited to the returned units).
export async function restockReturn(
  staff: StaffContext,
  returnRequestId: string,
  metadata: RequestMetadata,
) {
  await step(staff, metadata, returnRequestId, 'RESTOCKED', async (transaction, request) => {
    const quantityByVariant = new Map<string, number>();
    for (const item of request.items) {
      quantityByVariant.set(
        item.orderItem.variantId,
        (quantityByVariant.get(item.orderItem.variantId) ?? 0) + item.quantity,
      );
    }
    await restockCustomerReturn(
      transaction,
      { kind: 'STAFF', staff, metadata },
      [...quantityByVariant].map(([variantId, quantity]) => ({
        returnRequestId,
        variantId,
        quantity,
      })),
    );
    return {
      audit: {
        units: [...quantityByVariant.values()].reduce((total, quantity) => total + quantity, 0),
      },
    };
  });
}

// A manual refund (bank transfer or UPI reference), at most what was paid for the returned units.
export async function refundReturn(
  staff: StaffContext,
  returnRequestId: string,
  input: RefundInput,
  metadata: RequestMetadata,
) {
  await step(staff, metadata, returnRequestId, 'REFUNDED', async (transaction, request) => {
    const payment = await findPaymentStatus(transaction, request.orderId);
    if (payment?.status !== 'COLLECTED') {
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'PAYMENT_NOT_COLLECTED',
        message: 'The order was not paid, so nothing can be refunded.',
      });
    }
    const maximum = maximumRefundPaise(request);
    if (input.amountPaise > maximum) {
      throw new DomainError({
        kind: 'UNPROCESSABLE',
        code: 'REFUND_TOO_LARGE',
        message: 'The refund is more than was paid for these items.',
        details: { maximumPaise: maximum },
      });
    }
    await insertRefund(transaction, {
      returnRequestId,
      orderId: request.orderId,
      amountPaise: input.amountPaise,
      refundMethod: input.refundMethod,
      reference: input.reference,
      refundedAt: new Date(),
      recordedByStaffId: staff.staffUserId,
    });
    return {
      action: 'return.refunded',
      audit: { amountPaise: input.amountPaise, refundMethod: input.refundMethod },
    };
  });
}

const shippingAddressSchema = z.record(z.string(), z.string().nullable());

export async function exchangeReturn(
  staff: StaffContext,
  returnRequestId: string,
  metadata: RequestMetadata,
) {
  assertStaffPermission(staff, 'orders.write');
  await step(staff, metadata, returnRequestId, 'EXCHANGED', async (transaction, request) => {
    const quantityByVariant = new Map<string, number>();
    for (const item of request.items) {
      if (item.exchangeVariantId === null) continue;
      quantityByVariant.set(
        item.exchangeVariantId,
        (quantityByVariant.get(item.exchangeVariantId) ?? 0) + item.quantity,
      );
    }
    const lines = [...quantityByVariant].map(([variantId, quantity]) => ({ variantId, quantity }));
    const exchange = await createExchangeOrder(transaction, {
      returnRequestId,
      customerId: request.customerId,
      shippingAddress: shippingAddressSchema.parse(request.order.shippingAddress),
      lines,
      staff,
      metadata,
    });
    return {
      data: { exchangeOrderId: exchange.orderId },
      action: 'return.exchanged',
      audit: { exchangeOrderId: exchange.orderId, exchangeOrderNumber: exchange.orderNumber },
    };
  });
}
