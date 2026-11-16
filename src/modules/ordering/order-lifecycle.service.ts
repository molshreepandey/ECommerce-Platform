import { randomUUID } from 'node:crypto';

import type { OrderStatus, PaymentStatus, ShipmentStatus } from '@/generated/prisma/enums';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { customerIdSchema } from '@/lib/ids';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import type { AuditAction, AuditData } from '@/modules/audit/audit.types';
import {
  assertStaffPermission,
  type CustomerContext,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';
import type { InventoryActor } from '@/modules/inventory/inventory-actor';
import { applyReservationChanges } from '@/modules/inventory/reservation.service';
import { dispatchReservedStock } from '@/modules/inventory/stock-dispatch.service';
import { restockReturnedShipment } from '@/modules/inventory/stock-restock.service';
import { recordOrderNotification } from '@/modules/notifications/notification.service';
import { releaseCouponRedemption } from '@/modules/pricing/coupon.repository';

import {
  findPaymentForOrder,
  findShipmentOrderId,
  findShipmentStockLines,
  type LockedOrder,
  type LockedShipment,
  lockOrder,
  lockShipmentsOfOrder,
  insertTrackingEvent,
  updateOrderStatusIfCurrent,
  updatePaymentStatusIfCurrent,
  updateShipmentIfCurrent,
} from './order-lifecycle.repository';
import { insertStatusHistory } from './order.repository';
import {
  canMoveOrder,
  canMoveShipment,
  orderCanBeCancelled,
  orderStatusFromShipments,
} from './order-state';
import { orderingErrors } from './ordering.errors';

export type OrderActor =
  | { kind: 'CUSTOMER'; customerId: string; metadata: RequestMetadata }
  | { kind: 'STAFF'; staff: StaffContext; metadata: RequestMetadata }
  | { kind: 'COURIER'; courierPartnerId: string; metadata: { requestId: string } }
  | { kind: 'SYSTEM'; process: string; metadata: { requestId: string } };

const lifecycleTransactionOptions = { maxWait: 5_000, timeout: 15_000 } as const;

function actorColumns(actor: OrderActor) {
  switch (actor.kind) {
    case 'CUSTOMER':
      return { actorType: 'CUSTOMER' as const, actorId: actor.customerId };
    case 'STAFF':
      return { actorType: 'STAFF' as const, actorId: actor.staff.staffUserId };
    case 'COURIER':
      return { actorType: 'COURIER' as const, actorId: actor.courierPartnerId };
    case 'SYSTEM':
      return { actorType: 'SYSTEM' as const, actorId: null };
  }
}

function inventoryActorFor(actor: OrderActor): InventoryActor {
  switch (actor.kind) {
    case 'CUSTOMER':
      return {
        kind: 'CUSTOMER',
        customerId: customerIdSchema.parse(actor.customerId),
        metadata: actor.metadata,
      };
    case 'STAFF':
      return { kind: 'STAFF', staff: actor.staff, metadata: actor.metadata };
    case 'COURIER':
      return {
        kind: 'SYSTEM',
        process: `courier-webhook:${actor.courierPartnerId}`,
        metadata: actor.metadata,
      };
    case 'SYSTEM':
      return { kind: 'SYSTEM', process: actor.process, metadata: actor.metadata };
  }
}

async function audit(
  transaction: DatabaseClient,
  actor: OrderActor,
  event: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    before?: AuditData;
    after?: AuditData;
  },
): Promise<void> {
  await recordAuditEvent(transaction, {
    ...actorColumns(actor),
    ...event,
    ipAddress: 'clientIp' in actor.metadata ? actor.metadata.clientIp : null,
    requestId: actor.metadata.requestId,
  });
}

export function invalidTransition(details: Record<string, string>) {
  return new DomainError({
    kind: 'CONFLICT',
    code: 'INVALID_TRANSITION',
    message: 'This change is not allowed in the current status.',
    details,
  });
}

async function changeOrderStatus(
  transaction: DatabaseClient,
  order: LockedOrder,
  to: OrderStatus,
  actor: OrderActor,
  reason: string | null,
): Promise<void> {
  if (!(await updateOrderStatusIfCurrent(transaction, order.id, order.status, to))) {
    throw invalidTransition({ orderStatus: order.status, requestedStatus: to });
  }
  await insertStatusHistory(transaction, {
    orderId: order.id,
    fromStatus: order.status,
    toStatus: to,
    ...actorColumns(actor),
    reason,
  });
  await audit(transaction, actor, {
    action: to === 'CANCELLED' ? 'order.cancelled' : 'order.status_changed',
    entityType: 'order',
    entityId: order.id,
    before: { status: order.status },
    after: { status: to, ...(reason === null ? {} : { reason }) },
  });
}

async function changePaymentStatus(
  transaction: DatabaseClient,
  order: LockedOrder,
  from: PaymentStatus,
  to: PaymentStatus,
  actor: OrderActor,
): Promise<void> {
  if (!(await updatePaymentStatusIfCurrent(transaction, order.id, from, to, new Date()))) return;
  await audit(transaction, actor, {
    action: 'payment.status_changed',
    entityType: 'order',
    entityId: order.id,
    before: { paymentStatus: from },
    after: { paymentStatus: to, paymentMethod: order.paymentMethod },
  });
}

async function lockOrderWithShipments(
  transaction: DatabaseClient,
  orderId: string,
): Promise<{ order: LockedOrder; shipments: LockedShipment[] }> {
  const order = await lockOrder(transaction, orderId);
  if (order === null) throw orderingErrors.orderNotFound();
  return { order, shipments: await lockShipmentsOfOrder(transaction, orderId) };
}

// C34 / plan §7: whole order, only while nothing has shipped. Reservations are released, shipments and
// the order cancelled, and a pending payment voided (or failed, when payment failure is the cause). A
// collected online payment stays collected and is marked for a manual refund (audit `payment.refund_due`).
export async function cancelOrderInTransaction(
  transaction: DatabaseClient,
  input: {
    orderId: string;
    actor: OrderActor;
    reason: string;
    paymentOutcome: 'VOIDED' | 'FAILED';
  },
): Promise<{
  order: LockedOrder;
  cancelledAwbNumbers: { awbNumber: string; courierPartnerId: string }[];
}> {
  const { order, shipments } = await lockOrderWithShipments(transaction, input.orderId);
  if (
    !orderCanBeCancelled(
      order.status,
      shipments.map(({ status }) => status),
    )
  ) {
    throw new DomainError({
      kind: 'CONFLICT',
      code: 'CANCEL_NOT_ALLOWED',
      message: 'This order can no longer be cancelled: it has shipped or is already closed.',
      details: { orderStatus: order.status },
    });
  }
  // Coupon before stock, the same lock order as checkout (L63: the use is given back).
  const releasedCouponId = await releaseCouponRedemption(transaction, order.id);
  if (releasedCouponId !== null) {
    await audit(transaction, input.actor, {
      action: 'coupon.usage_returned',
      entityType: 'coupon',
      entityId: releasedCouponId,
      after: { orderId: order.id, reason: 'order_cancelled' },
    });
  }
  // Only live shipments still hold stock: a shipment moved to another warehouse was cancelled and released
  // its reservation then, and releasing it again would exceed what it holds (RESERVATION_EXCEEDED).
  const liveShipments = shipments.filter(({ status }) => status !== 'CANCELLED');
  const release = await findShipmentStockLines(
    transaction,
    liveShipments.map(({ id }) => id),
  );
  if (release.length > 0) {
    await applyReservationChanges(transaction, inventoryActorFor(input.actor), { release });
  }
  const now = new Date();
  for (const shipment of liveShipments) {
    if (
      !(await updateShipmentIfCurrent(transaction, shipment.id, shipment.status, {
        status: 'CANCELLED',
        cancelledAt: now,
      }))
    ) {
      throw invalidTransition({ shipmentStatus: shipment.status, requestedStatus: 'CANCELLED' });
    }
  }
  await changeOrderStatus(transaction, order, 'CANCELLED', input.actor, input.reason);
  const payment = await findPaymentForOrder(transaction, order.id);
  if (payment?.status === 'PENDING') {
    await changePaymentStatus(transaction, order, 'PENDING', input.paymentOutcome, input.actor);
  } else if (payment?.status === 'COLLECTED' && payment.amountPaise > 0) {
    // L62: refunds of cancelled prepaid orders are made by hand; this marker (in the audit log) is the
    // record that the amount is owed back to the customer.
    await audit(transaction, input.actor, {
      action: 'payment.refund_due',
      entityType: 'order',
      entityId: order.id,
      after: {
        paymentId: payment.id,
        amountPaise: payment.amountPaise,
        paymentMethod: payment.paymentMethod,
        reason: 'order_cancelled',
      },
    });
  }
  return {
    order,
    cancelledAwbNumbers: shipments.flatMap((shipment) =>
      shipment.awbNumber === null || shipment.courierPartnerId === null
        ? []
        : [{ awbNumber: shipment.awbNumber, courierPartnerId: shipment.courierPartnerId }],
    ),
  };
}

async function cancelOrder(input: {
  orderId: string;
  actor: OrderActor;
  reason: string;
  assertAllowed: (order: LockedOrder) => void;
}): Promise<void> {
  const result = await getDatabase().$transaction(async (transaction) => {
    const order = await lockOrder(transaction, input.orderId);
    if (order === null) throw orderingErrors.orderNotFound();
    input.assertAllowed(order);
    return cancelOrderInTransaction(transaction, {
      orderId: input.orderId,
      actor: input.actor,
      reason: input.reason,
      paymentOutcome: 'VOIDED',
    });
  }, lifecycleTransactionOptions);
  await cancelCourierShipments(result.cancelledAwbNumbers);
}

// After commit (plan §8: courier calls never run inside a transaction). The demo adapter has nothing to
// call; a real adapter's failure would be logged for a retry, never undo the cancellation.
async function cancelCourierShipments(
  awbNumbers: readonly { awbNumber: string; courierPartnerId: string }[],
): Promise<void> {
  if (awbNumbers.length === 0) return;
  const { cancelCourierAwbs } = await import('@/modules/fulfilment/courier-shipment.service');
  await cancelCourierAwbs(awbNumbers);
}

export async function cancelOrderByCustomer(
  customer: CustomerContext,
  orderId: string,
  reason: string,
  metadata: RequestMetadata,
): Promise<void> {
  await cancelOrder({
    orderId,
    actor: { kind: 'CUSTOMER', customerId: customer.customerId, metadata },
    reason,
    assertAllowed: (order) => {
      if (order.customerId !== customer.customerId) throw orderingErrors.orderNotFound();
    },
  });
}

export async function cancelOrderByStaff(
  staff: StaffContext,
  orderId: string,
  reason: string,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'orders.write');
  await cancelOrder({
    orderId,
    actor: { kind: 'STAFF', staff, metadata },
    reason,
    assertAllowed: () => undefined,
  });
}

// D33: an online order is confirmed only once its payment is collected.
export async function confirmOrder(
  staff: StaffContext,
  orderId: string,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'orders.write');
  await getDatabase().$transaction(async (transaction) => {
    const order = await lockOrder(transaction, orderId);
    if (order === null) throw orderingErrors.orderNotFound();
    if (!canMoveOrder(order.status, 'CONFIRMED')) {
      throw invalidTransition({ orderStatus: order.status, requestedStatus: 'CONFIRMED' });
    }
    if (order.paymentMethod === 'ONLINE') {
      const payment = await findPaymentForOrder(transaction, orderId);
      if (payment?.status !== 'COLLECTED') {
        throw new DomainError({
          kind: 'CONFLICT',
          code: 'PAYMENT_NOT_COLLECTED',
          message: 'This order is paid online and the payment is not complete yet.',
        });
      }
    }
    await changeOrderStatus(
      transaction,
      order,
      'CONFIRMED',
      { kind: 'STAFF', staff, metadata },
      null,
    );
  });
}

export interface ShipmentChange {
  to: ShipmentStatus;
  description: string;
  location?: string | null;
  providerEventId?: string;
  occurredAt?: Date;
  awbNumber?: string;
  providerShipmentId?: string;
  labelUrl?: string;
}

// PARTIALLY_SHIPPED: in a split order the remaining packages are packed after the first one ships.
const pickupAllowedOrderStatuses: ReadonlySet<OrderStatus> = new Set([
  'CONFIRMED',
  'PROCESSING',
  'PARTIALLY_SHIPPED',
]);

function timestampsFor(change: ShipmentChange, shipment: LockedShipment, at: Date) {
  switch (change.to) {
    case 'PACKED':
      return { packedAt: at };
    case 'SHIPPED':
      return { shippedAt: at };
    case 'DELIVERED':
      return { deliveredAt: at };
    case 'CANCELLED':
      return { cancelledAt: at };
    case 'RTO_RECEIVED':
      return { rtoReceivedAt: at };
    case 'DELIVERY_FAILED':
      return { deliveryAttemptCount: shipment.deliveryAttemptCount + 1 };
    case 'PENDING':
    case 'AWB_PENDING':
    case 'READY_TO_SHIP':
    case 'OUT_FOR_DELIVERY':
    case 'RTO_INITIATED':
      return {};
  }
}

// One shipment step inside the caller's transaction: guarded update, stock effect (dispatch on SHIPPED,
// restock on RTO_RECEIVED), tracking event, audit, then the order roll-up and the COD payment rules
// (delivered → COLLECTED, RTO → FAILED) in the same transaction (plan §7, §9.3).
export async function applyShipmentChange(
  transaction: DatabaseClient,
  input: { shipmentId: string; change: ShipmentChange; actor: OrderActor },
): Promise<{ order: LockedOrder; shipment: LockedShipment }> {
  const located = await findShipmentOrderId(transaction, input.shipmentId);
  if (located === null) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'SHIPMENT_NOT_FOUND',
      message: 'This shipment was not found.',
    });
  }
  const { order, shipments } = await lockOrderWithShipments(transaction, located.orderId);
  const shipment = shipments.find(({ id }) => id === input.shipmentId);
  if (shipment === undefined) throw orderingErrors.orderNotFound();
  const { to } = input.change;
  if (!canMoveShipment(shipment.status, to)) {
    throw invalidTransition({ shipmentStatus: shipment.status, requestedStatus: to });
  }
  if (to === 'PACKED' && !pickupAllowedOrderStatuses.has(order.status)) {
    throw new DomainError({
      kind: 'CONFLICT',
      code: 'ORDER_NOT_CONFIRMED',
      message: 'Confirm the order before packing its shipments.',
      details: { orderStatus: order.status },
    });
  }
  const at = input.change.occurredAt ?? new Date();
  const stockLines =
    to === 'SHIPPED' || to === 'RTO_RECEIVED'
      ? await findShipmentStockLines(transaction, [shipment.id])
      : [];
  if (to === 'SHIPPED')
    await dispatchReservedStock(transaction, inventoryActorFor(input.actor), stockLines);
  if (to === 'RTO_RECEIVED') {
    await restockReturnedShipment(transaction, inventoryActorFor(input.actor), stockLines);
  }
  const updated = await updateShipmentIfCurrent(transaction, shipment.id, shipment.status, {
    status: to,
    ...timestampsFor(input.change, shipment, at),
    ...(input.change.awbNumber === undefined ? {} : { awbNumber: input.change.awbNumber }),
    ...(input.change.providerShipmentId === undefined
      ? {}
      : { providerShipmentId: input.change.providerShipmentId }),
    ...(input.change.labelUrl === undefined ? {} : { labelUrl: input.change.labelUrl }),
  });
  if (!updated) throw invalidTransition({ shipmentStatus: shipment.status, requestedStatus: to });
  await insertTrackingEvent(transaction, {
    shipmentId: shipment.id,
    providerEventId: input.change.providerEventId ?? `manual-${randomUUID()}`,
    status: to,
    description: input.change.description,
    location: input.change.location ?? null,
    occurredAt: at,
  });
  await audit(transaction, input.actor, {
    action: 'shipment.status_changed',
    entityType: 'shipment',
    entityId: shipment.id,
    before: { status: shipment.status },
    after: {
      status: to,
      orderId: order.id,
      ...(input.change.awbNumber === undefined ? {} : { awbNumber: input.change.awbNumber }),
    },
  });
  if (to === 'SHIPPED' || to === 'DELIVERED') {
    await recordOrderNotification(transaction, {
      event: to === 'SHIPPED' ? 'SHIPMENT_SHIPPED' : 'SHIPMENT_DELIVERED',
      order,
      awbNumber: shipment.awbNumber,
    });
  }
  const nextStatuses = shipments.map((item) => (item.id === shipment.id ? to : item.status));
  const nextOrderStatus = orderStatusFromShipments(order.status, nextStatuses);
  if (nextOrderStatus !== order.status) {
    await changeOrderStatus(transaction, order, nextOrderStatus, input.actor, null);
    const payment = await findPaymentForOrder(transaction, order.id);
    if (payment?.status === 'PENDING' && order.paymentMethod === 'COD') {
      if (nextOrderStatus === 'DELIVERED') {
        await changePaymentStatus(transaction, order, 'PENDING', 'COLLECTED', input.actor);
      }
      if (nextOrderStatus === 'RTO') {
        await changePaymentStatus(transaction, order, 'PENDING', 'FAILED', input.actor);
      }
    } else if (
      payment?.status === 'COLLECTED' &&
      payment.amountPaise > 0 &&
      nextOrderStatus === 'RTO'
    ) {
      // A prepaid order that came back undelivered: the payment is owed back (L62, refunded by hand).
      await audit(transaction, input.actor, {
        action: 'payment.refund_due',
        entityType: 'order',
        entityId: order.id,
        after: {
          paymentId: payment.id,
          amountPaise: payment.amountPaise,
          paymentMethod: payment.paymentMethod,
          reason: 'returned_to_origin',
        },
      });
    }
  }
  return { order, shipment };
}

export async function changeShipmentByStaff(
  staff: StaffContext,
  shipmentId: string,
  change: ShipmentChange,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'orders.write');
  await getDatabase().$transaction(
    (transaction) =>
      applyShipmentChange(transaction, {
        shipmentId,
        change,
        actor: { kind: 'STAFF', staff, metadata },
      }),
    lifecycleTransactionOptions,
  );
}
