import type { PaymentMethod, PaymentStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

import { codAmountsByShipment } from './cod-collection';
import { listCodShipmentGoods } from './order-documents.repository';

export interface CodOrder {
  id: string;
  paymentMethod: PaymentMethod;
  totalPaise: number;
  payment: { status: PaymentStatus } | null;
}

// What each shipment's courier collects on delivery: nothing for a prepaid or already collected order,
// otherwise the shipment's share of the order total (one query for all the orders).
export async function codToCollectByShipment(
  database: DatabaseClient,
  orders: readonly CodOrder[],
): Promise<Map<string, number>> {
  const unpaid = new Map(
    orders
      .filter((order) => order.paymentMethod === 'COD' && order.payment?.status !== 'COLLECTED')
      .map((order) => [order.id, order.totalPaise]),
  );
  if (unpaid.size === 0) return new Map();
  const shipments = await listCodShipmentGoods(database, [...unpaid.keys()]);
  const amounts = new Map<string, number>();
  for (const [orderId, totalPaise] of unpaid) {
    const goods = shipments
      .filter((shipment) => shipment.orderId === orderId)
      .map((shipment) => ({
        shipmentId: shipment.id,
        lines: shipment.items.map((item) => ({
          lineTotalPaise: item.orderItem.lineTotalPaise,
          shipmentQuantity: item.quantity,
          orderedQuantity: item.orderItem.quantity,
        })),
      }));
    for (const [shipmentId, amountPaise] of codAmountsByShipment(totalPaise, goods)) {
      amounts.set(shipmentId, amountPaise);
    }
  }
  return amounts;
}
