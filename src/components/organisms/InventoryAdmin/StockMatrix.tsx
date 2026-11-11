'use client';

import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { createIdempotencyKeeper, type IdempotencyKeeper } from './idempotency-key';
import { formatQuantity, stockState, type StockState } from './inventory-format';
import type {
  StockLevelView,
  StockProductView,
  StockVariantView,
  WarehouseChoice,
} from './inventory-types';
import { AdjustStockDialog, ReceiveStockDialog, ThresholdDialog } from './StockDialogs';

const stateBadges: Record<StockState, { tone: BadgeTone; label: string }> = {
  out: { tone: 'danger', label: 'out of stock' },
  low: { tone: 'warning', label: 'low stock' },
  ok: { tone: 'success', label: 'in stock' },
};

type Dialog =
  | { kind: 'adjust'; variant: StockVariantView }
  | { kind: 'threshold'; variant: StockVariantView }
  | { kind: 'receive'; product: StockProductView };

function LevelRow({ level }: Readonly<{ level: StockLevelView }>) {
  const badge = stateBadges[stockState(level)];
  return (
    <li className="flex flex-col gap-xs rounded-default bg-background p-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-xs">
        <Text variant="body3-medium">{level.warehouseCode}</Text>
        {level.warehouseActive ? null : <Badge tone="neutral">inactive warehouse</Badge>}
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-sm text-body3 sm:min-w-80 sm:grid-cols-4">
        {(
          [
            ['On hand', level.onHandQuantity],
            ['Reserved', level.reservedQuantity],
            ['Available', level.availableQuantity],
            ['Alert at', level.lowStockThreshold],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-subtitle text-body4">{label}</dt>
            <dd className="font-medium text-headings tabular-nums">
              {label === 'Alert at' && value === 0 ? 'off' : formatQuantity(value)}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

// Variant × warehouse stock for one page of products. Write buttons exist only for staff who may change
// stock; the API checks the permission again on every change.
export function StockMatrix({
  products,
  warehouses,
  selectedWarehouseId,
  canWrite,
}: Readonly<{
  products: readonly StockProductView[];
  warehouses: readonly WarehouseChoice[];
  selectedWarehouseId: string | undefined;
  canWrite: boolean;
}>) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Keys outlive the dialogs (TD-021): reopening a dialog and sending the same change reuses its key.
  const [keepers] = useState(() => new Map<string, IdempotencyKeeper>());
  const keeperFor = (id: string): IdempotencyKeeper => {
    const existing = keepers.get(id);
    if (existing !== undefined) return existing;
    const keeper = createIdempotencyKeeper();
    keepers.set(id, keeper);
    return keeper;
  };
  // With a warehouse filter the page only has that warehouse's stock rows, so the dialogs offer only it;
  // any other warehouse would show made-up zeros.
  const dialogWarehouses =
    selectedWarehouseId === undefined
      ? warehouses
      : warehouses.filter((warehouse) => warehouse.id === selectedWarehouseId);
  const currentVariant = (variantId: string) =>
    products
      .flatMap(({ variants }) => variants)
      .find((candidate) => candidate.variantId === variantId);
  const defaultWarehouseId =
    selectedWarehouseId ??
    warehouses.find((warehouse) => warehouse.isActive)?.id ??
    warehouses[0]?.id ??
    '';
  const warehouseFor = (variant: StockVariantView) =>
    selectedWarehouseId ?? variant.levels[0]?.warehouseId ?? defaultWarehouseId;
  const close = () => {
    setDialog(null);
  };

  return (
    <>
      <ul aria-label="Stock by product" className="flex flex-col gap-md">
        {products.map((product) => (
          <li
            key={product.productId}
            aria-label={product.productName}
            className="flex flex-col gap-md rounded-default border border-lowlight bg-white p-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div className="flex min-w-0 flex-wrap items-center gap-sm">
                <Link href={`/products/${product.productId}`} variant="body2-medium">
                  {product.productName}
                </Link>
                {product.productStatus === 'ACTIVE' ? null : (
                  <Badge tone="neutral">{product.productStatus.toLowerCase()}</Badge>
                )}
              </div>
              {canWrite && warehouses.length > 0 ? (
                <Button
                  size="sm"
                  iconBefore="inbox"
                  aria-label={`Receive stock for ${product.productName}`}
                  onClick={() => {
                    setDialog({ kind: 'receive', product });
                  }}
                >
                  Receive stock
                </Button>
              ) : null}
            </div>
            <ul aria-label={`Variants of ${product.productName}`} className="flex flex-col gap-md">
              {product.variants.map((variant) => (
                <li
                  key={variant.variantId}
                  aria-label={variant.sku}
                  className="flex flex-col gap-sm border-t border-lowlight pt-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-sm">
                    <div className="flex flex-wrap items-center gap-xs">
                      <Text variant="body2-medium">{variant.sku}</Text>
                      {variant.variantStatus === 'ACTIVE' ? null : (
                        <Badge tone="neutral">{variant.variantStatus.toLowerCase()}</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-sm">
                      <Link
                        href={`/inventory/movements?variantId=${variant.variantId}`}
                        variant="body3"
                        aria-label={`History of ${variant.sku}`}
                      >
                        History
                      </Link>
                      {canWrite && warehouses.length > 0 ? (
                        <>
                          <Button
                            size="sm"
                            iconBefore="pencil"
                            aria-label={`Adjust stock of ${variant.sku}`}
                            onClick={() => {
                              setDialog({ kind: 'adjust', variant });
                            }}
                          >
                            Adjust
                          </Button>
                          <Button
                            size="sm"
                            iconBefore="triangle-alert"
                            aria-label={`Low-stock threshold of ${variant.sku}`}
                            onClick={() => {
                              setDialog({ kind: 'threshold', variant });
                            }}
                          >
                            Threshold
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {variant.levels.length === 0 ? (
                    <Text variant="body3" tone="muted">
                      No stock recorded
                      {selectedWarehouseId === undefined ? '' : ' in this warehouse'} yet.
                    </Text>
                  ) : (
                    <ul
                      aria-label={`Stock of ${variant.sku} by warehouse`}
                      className="flex flex-col gap-xs"
                    >
                      {variant.levels.map((level) => (
                        <LevelRow key={level.warehouseId} level={level} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {dialog?.kind === 'adjust' ? (
        <AdjustStockDialog
          key={`adjust-${dialog.variant.variantId}`}
          variant={currentVariant(dialog.variant.variantId) ?? dialog.variant}
          isStale={currentVariant(dialog.variant.variantId) === undefined}
          warehouses={dialogWarehouses}
          defaultWarehouseId={warehouseFor(dialog.variant)}
          keeper={keeperFor(`variant/${dialog.variant.variantId}`)}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'threshold' ? (
        <ThresholdDialog
          key={`threshold-${dialog.variant.variantId}`}
          variant={currentVariant(dialog.variant.variantId) ?? dialog.variant}
          isStale={currentVariant(dialog.variant.variantId) === undefined}
          warehouses={dialogWarehouses}
          defaultWarehouseId={warehouseFor(dialog.variant)}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'receive' ? (
        <ReceiveStockDialog
          key={`receive-${dialog.product.productId}`}
          product={dialog.product}
          warehouses={dialogWarehouses}
          defaultWarehouseId={defaultWarehouseId}
          keeper={keeperFor(`product/${dialog.product.productId}`)}
          onClose={close}
        />
      ) : null}
    </>
  );
}
