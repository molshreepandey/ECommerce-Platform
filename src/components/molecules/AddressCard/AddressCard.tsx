import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Text } from '@/components/atoms/Text';
import type { AddressCardProps } from './address-card.types';

export function AddressCard({
  address,
  isBusy = false,
  onEdit,
  onSetDefault,
  onRemove,
}: AddressCardProps) {
  const headingId = `address-${address.id}-recipient`;
  return (
    <Card as="li">
      <article aria-labelledby={headingId} className="flex h-full flex-col gap-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <h3 id={headingId} className="text-heading4 text-headings">
            {address.recipientName}
          </h3>
          {address.isDefault ? <Badge tone="success">Default</Badge> : null}
        </div>
        <address className="flex flex-col gap-xs not-italic">
          <Text>{address.addressLine1}</Text>
          {address.addressLine2 === null ? null : <Text>{address.addressLine2}</Text>}
          {address.landmark === null ? null : <Text tone="subtitle">Near {address.landmark}</Text>}
          <Text>
            {address.city}, {address.state} {address.pincode}
          </Text>
          <Text tone="subtitle">Phone {address.phone}</Text>
        </address>
        <div className="mt-auto flex flex-wrap gap-sm">
          <Button
            size="sm"
            appearance="default"
            iconBefore="pencil"
            onClick={onEdit}
            disabled={isBusy}
          >
            Edit
          </Button>
          {address.isDefault ? null : (
            <Button size="sm" appearance="subtle" onClick={onSetDefault} disabled={isBusy}>
              Make default
            </Button>
          )}
          <Button
            size="sm"
            appearance="ghost"
            iconBefore="trash"
            onClick={onRemove}
            disabled={isBusy}
          >
            Remove
          </Button>
        </div>
      </article>
    </Card>
  );
}
