import Image from 'next/image';
import { Icon } from '@/components/atoms/Icon';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { formatPaise } from '@/lib/money';
import type { OrderItem } from './order-view.types';

function optionText(optionValues: unknown): string {
  if (typeof optionValues !== 'object' || optionValues === null) return '';
  return Object.values(optionValues)
    .filter((value) => typeof value === 'string')
    .join(' · ');
}

// Order lines from their snapshot (plan §9.1 rule 6): later catalogue edits never change them.
export function OrderItemsList({
  items,
  linkToProduct = true,
  itemActions = {},
}: Readonly<{
  items: readonly OrderItem[];
  linkToProduct?: boolean;
  itemActions?: Readonly<Record<string, React.ReactNode>>;
}>) {
  return (
    <ul aria-label="Items" className="flex flex-col">
      {items.map((item) => {
        const options = optionText(item.optionValues);
        return (
          <li key={item.id} className="flex gap-md border-b border-strokes py-md last:border-b-0">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-default bg-strokes">
              {item.imageUrl === null ? (
                <div className="flex h-full items-center justify-center text-grey">
                  <Icon name="image" size="sm" />
                </div>
              ) : (
                <Image
                  src={item.imageUrl}
                  alt={item.productName}
                  fill
                  sizes="64px"
                  className="object-cover"
                  unoptimized
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-xs">
              <Text variant="body3" tone="subtitle">
                {item.brandName}
              </Text>
              {linkToProduct ? (
                <Link
                  href={`/products/${item.product.slug}`}
                  appearance="plain"
                  variant="body2-medium"
                >
                  {item.productName}
                </Link>
              ) : (
                <Text variant="body2-medium">{item.productName}</Text>
              )}
              <Text variant="body3" tone="muted">
                {[options, item.sku].filter((part) => part !== '').join(' · ')} · Qty{' '}
                {item.quantity}
              </Text>
              {itemActions[item.id] ?? null}
            </div>
            <div className="flex flex-col items-end gap-xs">
              <Text variant="body2-medium">{formatPaise(item.lineTotalPaise)}</Text>
              <Text variant="body3" tone="muted">
                {formatPaise(item.unitPricePaise)} each
              </Text>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
