import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { formatDateTime } from '@/lib/date-format';
import { ShipmentStatusBadge } from './StatusBadges';
import type { OrderShipment } from './order-view.types';

// C33 / C35: one timeline per shipment with the courier, AWB and every tracking event.
export function ShipmentTimeline({
  shipment,
  index,
  shipmentCount,
  showWarehouse = false,
  children,
}: Readonly<{
  shipment: OrderShipment;
  index: number;
  shipmentCount: number;
  showWarehouse?: boolean;
  children?: React.ReactNode;
}>) {
  return (
    <Card as="article">
      <div className="flex flex-col gap-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <Heading level={3} variant="heading5">
            {shipmentCount > 1
              ? `Shipment ${String(index + 1)} of ${String(shipmentCount)}`
              : 'Shipment'}
          </Heading>
          <ShipmentStatusBadge status={shipment.status} />
        </div>
        <Text variant="body3" tone="subtitle">
          {shipment.courierPartner?.name ?? 'Courier to be assigned'}
          {shipment.awbNumber === null ? '' : ` · AWB ${shipment.awbNumber}`}
          {showWarehouse ? ` · from ${shipment.warehouse.name} (${shipment.warehouse.code})` : ''}
          {shipment.deliveryAttemptCount > 0
            ? ` · ${String(shipment.deliveryAttemptCount)} failed ${shipment.deliveryAttemptCount === 1 ? 'attempt' : 'attempts'}`
            : ''}
        </Text>
        {shipment.trackingEvents.length === 0 ? (
          <Text variant="body3" tone="muted">
            Waiting to be packed.
          </Text>
        ) : (
          <ol aria-label="Tracking" className="flex flex-col gap-sm border-l border-lowlight pl-lg">
            {shipment.trackingEvents.map((event) => (
              <li key={event.id} className="flex flex-col">
                <Text variant="body2-medium">{event.description}</Text>
                <Text variant="body3" tone="muted">
                  {formatDateTime(event.occurredAt)}
                  {event.location === null ? '' : ` · ${event.location}`}
                </Text>
              </li>
            ))}
          </ol>
        )}
        {children}
      </div>
    </Card>
  );
}
