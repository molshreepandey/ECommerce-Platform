import type { OrderStatus, ShipmentStatus } from '@/generated/prisma/enums';

// Plan §9.3. Every status change goes through these tables and a guarded UPDATE … WHERE status = <from>.
export const shipmentTransitions: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  PENDING: ['PACKED', 'CANCELLED'],
  PACKED: ['AWB_PENDING', 'CANCELLED'],
  AWB_PENDING: ['READY_TO_SHIP', 'PACKED'],
  READY_TO_SHIP: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'RTO_INITIATED'],
  RTO_INITIATED: ['RTO_RECEIVED'],
  RTO_RECEIVED: [],
  DELIVERED: [],
  CANCELLED: [],
};

// Manual order transitions; the rest of the order status follows its shipments (orderStatusFromShipments).
export const orderTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED'],
  PARTIALLY_SHIPPED: ['SHIPPED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'RTO'],
  SHIPPED: ['PARTIALLY_DELIVERED', 'DELIVERED', 'RTO'],
  PARTIALLY_DELIVERED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  RTO: [],
};

export function canMoveShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return shipmentTransitions[from].includes(to);
}

export function canMoveOrder(from: OrderStatus, to: OrderStatus): boolean {
  return orderTransitions[from].includes(to);
}

const shippedOrLater: ReadonlySet<ShipmentStatus> = new Set([
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RTO_INITIATED',
  'RTO_RECEIVED',
]);
const returnedToOrigin: ReadonlySet<ShipmentStatus> = new Set(['RTO_INITIATED', 'RTO_RECEIVED']);

export function isShippedOrLater(status: ShipmentStatus): boolean {
  return shippedOrLater.has(status);
}

// Cancellation is whole-order only and only while nothing has shipped (plan §9.3).
export function orderCanBeCancelled(
  orderStatus: OrderStatus,
  shipmentStatuses: readonly ShipmentStatus[],
): boolean {
  return (
    (orderStatus === 'PLACED' || orderStatus === 'CONFIRMED' || orderStatus === 'PROCESSING') &&
    !shipmentStatuses.some(isShippedOrLater)
  );
}

// The order status implied by its live (not cancelled) shipments, recomputed in the same transaction as any
// shipment change. Before anything ships, packing moves a confirmed order to PROCESSING.
export function orderStatusFromShipments(
  current: OrderStatus,
  shipmentStatuses: readonly ShipmentStatus[],
): OrderStatus {
  const live = shipmentStatuses.filter((status) => status !== 'CANCELLED');
  if (live.length === 0) return current;
  const delivered = live.filter((status) => status === 'DELIVERED').length;
  const shipped = live.filter(isShippedOrLater).length;
  const returned = live.filter((status) => returnedToOrigin.has(status)).length;
  if (delivered === live.length) return 'DELIVERED';
  if (returned === live.length) return 'RTO';
  if (delivered > 0 && shipped === live.length) return 'PARTIALLY_DELIVERED';
  if (shipped === live.length) return 'SHIPPED';
  if (shipped > 0) return 'PARTIALLY_SHIPPED';
  if (current === 'CONFIRMED' && live.some((status) => status !== 'PENDING')) return 'PROCESSING';
  return current;
}
