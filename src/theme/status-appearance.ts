import type { OrderStatus, PaymentStatus, ShipmentStatus } from '@/generated/prisma/enums';
import type { StatusAppearance } from './theme.types';

export const orderStatusAppearance: Readonly<Record<OrderStatus, StatusAppearance>> = {
  PLACED: { label: 'Placed', tone: 'info' },
  CONFIRMED: { label: 'Confirmed', tone: 'info' },
  PROCESSING: { label: 'Processing', tone: 'info' },
  PARTIALLY_SHIPPED: { label: 'Partially shipped', tone: 'warning' },
  SHIPPED: { label: 'Shipped', tone: 'info' },
  PARTIALLY_DELIVERED: { label: 'Partially delivered', tone: 'warning' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  RTO: { label: 'Returned to origin', tone: 'danger' },
};

export const shipmentStatusAppearance: Readonly<Record<ShipmentStatus, StatusAppearance>> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  PACKED: { label: 'Packed', tone: 'info' },
  AWB_PENDING: { label: 'AWB pending', tone: 'warning' },
  READY_TO_SHIP: { label: 'Ready to ship', tone: 'info' },
  SHIPPED: { label: 'Shipped', tone: 'info' },
  OUT_FOR_DELIVERY: { label: 'Out for delivery', tone: 'info' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  DELIVERY_FAILED: { label: 'Delivery failed', tone: 'danger' },
  RTO_INITIATED: { label: 'RTO initiated', tone: 'warning' },
  RTO_RECEIVED: { label: 'RTO received', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export const paymentStatusAppearance: Readonly<Record<PaymentStatus, StatusAppearance>> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  COLLECTED: { label: 'Collected', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  VOIDED: { label: 'Voided', tone: 'neutral' },
};
