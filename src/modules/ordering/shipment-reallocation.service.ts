import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';
import { applyReservationChanges } from '@/modules/inventory/reservation.service';

import {
  findShipmentItemsForMove,
  findShipmentOrderId,
  findWarehouseName,
  insertTrackingEvent,
  lockOrder,
  lockShipmentsOfOrder,
  updateShipmentIfCurrent,
} from './order-lifecycle.repository';
import { insertShipmentItems, insertShipments } from './order.repository';
import { orderingErrors } from './ordering.errors';

const refusal = (code: string, message: string, kind: 'CONFLICT' | 'UNPROCESSABLE' = 'CONFLICT') =>
  new DomainError({ kind, code, message });

// D34: a shipment not yet packed moves to another warehouse in one transaction: a new PENDING shipment
// takes its lines, the reservation moves with one release + reserve call (so the new warehouse must have
// the stock, else 409 OUT_OF_STOCK and nothing changes), and the old shipment is cancelled.
export async function reallocateShipment(
  staff: StaffContext,
  shipmentId: string,
  targetWarehouseId: string,
  metadata: RequestMetadata,
): Promise<{ shipmentId: string }> {
  assertStaffPermission(staff, 'orders.write');
  return getDatabase().$transaction(
    async (transaction) => {
      const located = await findShipmentOrderId(transaction, shipmentId);
      if (located === null) throw refusal('SHIPMENT_NOT_FOUND', 'This shipment was not found.');
      const order = await lockOrder(transaction, located.orderId);
      if (order === null) throw orderingErrors.orderNotFound();
      const shipment = (await lockShipmentsOfOrder(transaction, order.id)).find(
        ({ id }) => id === shipmentId,
      );
      if (shipment === undefined) throw orderingErrors.orderNotFound();
      if (shipment.status !== 'PENDING' || order.status === 'CANCELLED') {
        throw refusal(
          'REALLOCATION_NOT_ALLOWED',
          'Only a shipment that is not packed yet can move to another warehouse.',
        );
      }
      if (shipment.warehouseId === targetWarehouseId) {
        throw refusal(
          'SAME_WAREHOUSE',
          'The shipment is already in this warehouse.',
          'UNPROCESSABLE',
        );
      }
      const target = await findWarehouseName(transaction, targetWarehouseId);
      if (target === null)
        throw refusal('WAREHOUSE_NOT_FOUND', 'This warehouse was not found.', 'UNPROCESSABLE');
      if (shipment.courierPartnerId === null)
        throw refusal('REALLOCATION_NOT_ALLOWED', 'This shipment has no courier.');

      const items = await findShipmentItemsForMove(transaction, shipmentId);
      const [moved] = await insertShipments(transaction, [
        {
          orderId: order.id,
          warehouseId: targetWarehouseId,
          courierPartnerId: shipment.courierPartnerId,
        },
      ]);
      if (moved === undefined) throw new Error('The replacement shipment was not created');
      await insertShipmentItems(
        transaction,
        items.map((item) => ({
          shipmentId: moved.id,
          orderItemId: item.orderItemId,
          quantity: item.quantity,
        })),
      );
      await applyReservationChanges(
        transaction,
        { kind: 'STAFF', staff, metadata },
        {
          release: items.map((item) => ({
            shipmentId,
            variantId: item.orderItem.variantId,
            warehouseId: shipment.warehouseId,
            quantity: item.quantity,
          })),
          reserve: items.map((item) => ({
            shipmentId: moved.id,
            variantId: item.orderItem.variantId,
            warehouseId: targetWarehouseId,
            quantity: item.quantity,
          })),
        },
      );
      if (
        !(await updateShipmentIfCurrent(transaction, shipmentId, 'PENDING', {
          status: 'CANCELLED',
          cancelledAt: new Date(),
        }))
      ) {
        throw refusal('INVALID_TRANSITION', 'This change is not allowed in the current status.');
      }
      await insertTrackingEvent(transaction, {
        shipmentId: moved.id,
        providerEventId: `reallocated-${shipmentId}`,
        status: 'PENDING',
        description: `Moved to ${target.name}`,
        location: null,
        occurredAt: new Date(),
      });
      await recordAuditEvent(transaction, {
        actorType: 'STAFF',
        actorId: staff.staffUserId,
        action: 'shipment.reallocated',
        entityType: 'shipment',
        entityId: shipmentId,
        before: { warehouseId: shipment.warehouseId },
        after: { warehouseId: targetWarehouseId, newShipmentId: moved.id, orderId: order.id },
        ipAddress: metadata.clientIp,
        requestId: metadata.requestId,
      });
      return { shipmentId: moved.id };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}
