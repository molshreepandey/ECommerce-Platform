import { DomainError } from '@/lib/errors';
import { getDatabase } from '@/lib/db';
import { getLogger } from '@/lib/logger';
import { findCourierPartnerAdapters } from '@/modules/fulfilment/courier.repository';
import { requestCourierAwb } from '@/modules/fulfilment/courier-shipment.service';
import {
  buildDemoWebhook,
  demoCourierAdapterKey,
  nextDemoScan,
} from '@/modules/fulfilment/demo-courier';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';

import { processCourierWebhook } from './courier-webhook.service';
import { findShipmentForScan } from './order-lifecycle.repository';
import { applyShipmentChange, type ShipmentChange } from './order-lifecycle.service';

const shipmentActionDescriptions = {
  pack: { to: 'PACKED', description: 'Packed at the warehouse' },
  ship: { to: 'SHIPPED', description: 'Handed over to the courier' },
  'out-for-delivery': { to: 'OUT_FOR_DELIVERY', description: 'Out for delivery' },
  deliver: { to: 'DELIVERED', description: 'Delivered to the customer' },
  'mark-failed': { to: 'DELIVERY_FAILED', description: 'Delivery attempt failed' },
  reattempt: { to: 'OUT_FOR_DELIVERY', description: 'Delivery re-attempted' },
  'initiate-rto': { to: 'RTO_INITIATED', description: 'Returning to origin' },
  'receive-rto': { to: 'RTO_RECEIVED', description: 'Returned to the warehouse and restocked' },
} as const satisfies Record<string, Pick<ShipmentChange, 'to' | 'description'>>;

export type ShipmentAction = keyof typeof shipmentActionDescriptions;

export function isShipmentAction(value: string): value is ShipmentAction {
  return value in shipmentActionDescriptions;
}

// D33 / D36 manual steps (pack, ship, deliver, NDR, RTO); each runs through the shipment state machine.
export async function runShipmentAction(
  staff: StaffContext,
  shipmentId: string,
  action: ShipmentAction,
  reason: string | null,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'orders.write');
  const step = shipmentActionDescriptions[action];
  await getDatabase().$transaction(
    (transaction) =>
      applyShipmentChange(transaction, {
        shipmentId,
        change: {
          to: step.to,
          description: reason === null ? step.description : `${step.description}: ${reason}`,
        },
        actor: { kind: 'STAFF', staff, metadata },
      }),
    { maxWait: 5_000, timeout: 15_000 },
  );
}

const courierUnavailable = () =>
  new DomainError({
    kind: 'UNAVAILABLE',
    code: 'COURIER_UNAVAILABLE',
    message: 'The courier did not create the shipment. The shipment is back to packed; try again.',
  });

// Plan §8: AWB_PENDING is recorded first, the courier is called outside any transaction, then the result
// is saved (READY_TO_SHIP with AWB and label) or the shipment goes back to PACKED.
export async function createShipmentAwb(
  staff: StaffContext,
  shipmentId: string,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'orders.write');
  const actor = { kind: 'STAFF' as const, staff, metadata };
  const database = getDatabase();
  const { order, shipment } = await database.$transaction((transaction) =>
    applyShipmentChange(transaction, {
      shipmentId,
      change: { to: 'AWB_PENDING', description: 'Shipment requested from the courier' },
      actor,
    }),
  );
  try {
    if (shipment.courierPartnerId === null || order.shippingPincode === null) {
      throw new Error('Shipment has no courier or delivery pincode');
    }
    const created = await requestCourierAwb({
      courierPartnerId: shipment.courierPartnerId,
      shipmentId,
      orderNumber: order.orderNumber,
      pincode: order.shippingPincode,
    });
    await database.$transaction((transaction) =>
      applyShipmentChange(transaction, {
        shipmentId,
        change: {
          to: 'READY_TO_SHIP',
          description: `AWB ${created.awbNumber} created`,
          awbNumber: created.awbNumber,
          providerShipmentId: created.providerShipmentId,
          labelUrl: `/api/admin/shipments/${shipmentId}/label`,
        },
        actor,
      }),
    );
  } catch (error) {
    getLogger().warn({ err: error, shipmentId }, 'courier shipment creation failed');
    await database.$transaction((transaction) =>
      applyShipmentChange(transaction, {
        shipmentId,
        change: { to: 'PACKED', description: 'Courier shipment request failed' },
        actor,
      }),
    );
    throw courierUnavailable();
  }
}

// The demo's "simulate next scan" button (plan §8): builds the next signed demo_courier event and sends
// it through the same webhook processing as the real webhook route.
export async function simulateNextScan(
  staff: StaffContext,
  shipmentId: string,
  outcome: 'DELIVERED' | 'DELIVERY_FAILED',
  requestId: string,
): Promise<{ status: string }> {
  assertStaffPermission(staff, 'orders.write');
  const shipment = await findShipmentForScan(getDatabase(), shipmentId);
  if (shipment === null) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'SHIPMENT_NOT_FOUND',
      message: 'This shipment was not found.',
    });
  }
  const nextStatus = nextDemoScan(shipment.status, outcome);
  const [partner] =
    shipment.courierPartnerId === null
      ? []
      : await findCourierPartnerAdapters(getDatabase(), [shipment.courierPartnerId]);
  if (
    nextStatus === null ||
    shipment.awbNumber === null ||
    partner?.adapterKey !== demoCourierAdapterKey
  ) {
    throw new DomainError({
      kind: 'CONFLICT',
      code: 'NO_NEXT_SCAN',
      message: 'There is no next courier scan for this shipment.',
      details: { shipmentStatus: shipment.status },
    });
  }
  const webhook = buildDemoWebhook({
    partnerCode: partner.code,
    awbNumber: shipment.awbNumber,
    status: nextStatus,
    location: shipment.warehouse.city,
    now: new Date(),
  });
  const result = await processCourierWebhook({
    providerCode: partner.code,
    rawBody: webhook.rawBody,
    signatureHeader: webhook.signatureHeader,
    requestId,
  });
  const failed = result.events.find((event) => event.result === 'FAILED');
  if (failed !== undefined) {
    throw new DomainError({
      kind: 'CONFLICT',
      code: 'SCAN_NOT_APPLIED',
      message: failed.message ?? 'The courier scan could not be applied.',
    });
  }
  return { status: nextStatus };
}
