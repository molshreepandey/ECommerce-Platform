import type { DatabaseClient } from '@/lib/db';

import { inventoryErrors } from './inventory.errors';
import { lockShipments } from './inventory-locks';

// L0b. Locks every referenced shipment (even if the caller already holds it; re-locking never waits) and
// checks that it exists and that each line's warehouse is the shipment's own warehouse.
export async function lockAndCheckShipments(
  transaction: DatabaseClient,
  lines: readonly { shipmentId: string; warehouseId: string }[],
): Promise<void> {
  const shipments = new Map(
    (
      await lockShipments(
        transaction,
        lines.map(({ shipmentId }) => shipmentId),
      )
    ).map((shipment) => [shipment.id, shipment]),
  );
  for (const line of lines) {
    const shipment = shipments.get(line.shipmentId);
    if (shipment === undefined) {
      throw inventoryErrors.reservationReferenceInvalid({
        shipmentId: line.shipmentId,
        reason: 'SHIPMENT_NOT_FOUND',
      });
    }
    if (shipment.warehouseId !== line.warehouseId) {
      throw inventoryErrors.reservationReferenceInvalid({
        shipmentId: line.shipmentId,
        reason: 'OTHER_WAREHOUSE',
      });
    }
  }
}
