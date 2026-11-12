import { Badge, type BadgeTone } from '@/components/atoms/Badge';
import { Text } from '@/components/atoms/Text';
import {
  formatDateTime,
  formatQuantity,
  formatQuantityChange,
  movementTypeLabel,
} from './inventory-format';

export type MovementView = Readonly<{
  movementId: string;
  sku: string | null;
  productName: string | null;
  warehouseCode: string | null;
  movementType: string;
  quantityDelta: number;
  onHandBefore: number;
  onHandAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  referenceType: string | null;
  referenceId: string | null;
  actorType: string;
  reason: string | null;
  recordedAt: Date;
}>;

const referenceLabels: Readonly<Record<string, string>> = {
  inventory_change_request: 'Staff stock change',
  shipment: 'Shipment',
  return_request: 'Return request',
};

function deltaTone(quantityDelta: number): BadgeTone {
  if (quantityDelta > 0) return 'success';
  if (quantityDelta < 0) return 'danger';
  return 'neutral';
}

// The ledger, newest first. Every row says what changed, by how much, why, by whom and when.
export function MovementList({ movements }: Readonly<{ movements: readonly MovementView[] }>) {
  return (
    <ol aria-label="Stock movements" className="flex flex-col gap-sm">
      {movements.map((movement) => (
        <li
          key={movement.movementId}
          className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <div className="flex flex-wrap items-center gap-xs">
              <Badge tone="info">{movementTypeLabel(movement.movementType)}</Badge>
              <Text variant="body2-medium">{movement.sku ?? 'Unknown variant'}</Text>
              <Text variant="body3" tone="muted">
                {movement.productName ?? ''} · {movement.warehouseCode ?? 'unknown warehouse'}
              </Text>
            </div>
            <Badge tone={deltaTone(movement.quantityDelta)}>
              {formatQuantityChange(movement.quantityDelta)}
            </Badge>
          </div>
          <Text variant="body3" tone="subtitle">
            On hand {formatQuantity(movement.onHandBefore)} → {formatQuantity(movement.onHandAfter)}{' '}
            · reserved {formatQuantity(movement.reservedBefore)} →{' '}
            {formatQuantity(movement.reservedAfter)}
          </Text>
          {movement.reason === null ? null : (
            <Text variant="body3">
              <span className="text-subtitle">Reason:</span> {movement.reason}
            </Text>
          )}
          <Text variant="body4" tone="muted">
            <time dateTime={movement.recordedAt.toISOString()}>
              {formatDateTime(movement.recordedAt)}
            </time>{' '}
            · {movement.actorType.toLowerCase()}
            {movement.referenceType === null
              ? ''
              : ` · ${referenceLabels[movement.referenceType] ?? movement.referenceType} ${movement.referenceId?.slice(0, 8) ?? ''}`}
          </Text>
        </li>
      ))}
    </ol>
  );
}
