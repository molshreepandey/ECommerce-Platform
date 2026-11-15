import { Badge } from '@/components/atoms/Badge';
import type { OrderStatus, PaymentStatus, ShipmentStatus } from '@/generated/prisma/enums';
import { orderStatusAppearance, paymentStatusAppearance, shipmentStatusAppearance } from '@/theme';

export function OrderStatusBadge({ status }: Readonly<{ status: OrderStatus }>) {
  const appearance = orderStatusAppearance[status];
  return <Badge tone={appearance.tone}>{appearance.label}</Badge>;
}

export function ShipmentStatusBadge({ status }: Readonly<{ status: ShipmentStatus }>) {
  const appearance = shipmentStatusAppearance[status];
  return <Badge tone={appearance.tone}>{appearance.label}</Badge>;
}

export function PaymentStatusBadge({
  status,
  paymentMethod,
}: Readonly<{ status: PaymentStatus; paymentMethod: 'COD' | 'ONLINE' }>) {
  const appearance = paymentStatusAppearance[status];
  const prefix = paymentMethod === 'COD' ? 'COD' : 'Online';
  const label =
    paymentMethod === 'ONLINE' && status === 'COLLECTED' ? 'Paid' : appearance.label.toLowerCase();
  return <Badge tone={appearance.tone}>{`${prefix} · ${label}`}</Badge>;
}
