import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { formatQuantity } from './inventory-format';
import type { LowStockItemView } from './LowStockList';

// Dashboard summary: how many stock rows are at or below their threshold, with the first few (in the
// low-stock list's order, by warehouse), and a link to the full list.
export function LowStockTile({
  totalCount,
  items,
}: Readonly<{ totalCount: number; items: readonly LowStockItemView[] }>) {
  return (
    <Card as="section" aria-labelledby="low-stock-tile-heading">
      <Flexbox direction="column" gap="md">
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <Heading level={2} variant="heading4" id="low-stock-tile-heading">
            Low stock
          </Heading>
          <Text variant="body2-medium" tone={totalCount === 0 ? 'success' : 'warning'}>
            {totalCount === 0
              ? 'Nothing is low'
              : `${formatQuantity(totalCount)} ${totalCount === 1 ? 'item' : 'items'} at or below the alert level`}
          </Text>
        </div>
        {items.length === 0 ? null : (
          <ul aria-label="Low-stock items" className="flex flex-col gap-xs">
            {items.map((item) => (
              <li
                key={`${item.warehouseId}/${item.variantId}`}
                className="flex flex-wrap justify-between gap-sm text-body3"
              >
                <span className="font-medium text-headings">
                  {item.sku} · {item.warehouseCode}
                </span>
                <span className="text-subtitle">
                  {formatQuantity(item.availableQuantity)} available (alert at{' '}
                  {formatQuantity(item.lowStockThreshold)})
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Link href="/inventory/low-stock" variant="body2-medium">
            View low stock
          </Link>
        </div>
      </Flexbox>
    </Card>
  );
}
