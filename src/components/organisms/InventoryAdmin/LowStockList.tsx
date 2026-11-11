import { Badge } from '@/components/atoms/Badge';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { formatQuantity } from './inventory-format';

export type LowStockItemView = Readonly<{
  productName: string;
  variantId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseActive: boolean;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
}>;

// Each row links to the stock view for that SKU in that warehouse, where it can be adjusted or received.
export function LowStockList({ items }: Readonly<{ items: readonly LowStockItemView[] }>) {
  return (
    <ul aria-label="Low-stock items" className="flex flex-col gap-sm">
      {items.map((item) => (
        <li
          key={`${item.warehouseId}/${item.variantId}`}
          className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-col gap-xs">
            <Link
              href={`/inventory?${new URLSearchParams({ search: item.sku, warehouseId: item.warehouseId }).toString()}`}
              variant="body2-medium"
            >
              {item.sku}
            </Link>
            <Text variant="body3" tone="muted">
              {item.productName} · {item.warehouseCode}
              {item.warehouseActive ? '' : ' (inactive)'}
            </Text>
          </div>
          <div className="flex flex-wrap items-center gap-sm">
            <Badge tone={item.availableQuantity <= 0 ? 'danger' : 'warning'}>
              {formatQuantity(item.availableQuantity)} available
            </Badge>
            <Text variant="body3" tone="subtitle">
              alert at {formatQuantity(item.lowStockThreshold)} · on hand{' '}
              {formatQuantity(item.onHandQuantity)} · reserved{' '}
              {formatQuantity(item.reservedQuantity)}
            </Text>
          </div>
        </li>
      ))}
    </ul>
  );
}
