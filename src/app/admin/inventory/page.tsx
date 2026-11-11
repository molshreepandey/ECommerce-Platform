import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import {
  InventoryReadOnlyNotice,
  StockFilters,
  StockMatrix,
} from '@/components/organisms/InventoryAdmin';
import type { StaffContext } from '@/modules/identity/access-control';
import { listStockLevelsSchema } from '@/modules/inventory/inventory.schema';
import { listStockLevels } from '@/modules/inventory/inventory-query.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';
import { isInvalidCursor, PageLinks, warehouseChoices } from './inventory-page-parts';

export const metadata: Metadata = { title: 'Inventory' };

async function StockView({
  staff,
  canWrite,
  searchValues,
}: Readonly<{ staff: StaffContext; canWrite: boolean; searchValues: Record<string, string> }>) {
  const parsed = listStockLevelsSchema.safeParse(searchValues);
  const filters = parsed.success ? parsed.data : listStockLevelsSchema.parse({});
  let notice: string | null = parsed.success
    ? null
    : 'Some filters in the address were not valid, so all stock is shown.';
  let page;
  try {
    page = await listStockLevels(staff, filters);
  } catch (error) {
    if (!isInvalidCursor(error)) throw error;
    notice = 'That page link is no longer valid, so the first page is shown.';
    page = await listStockLevels(staff, { ...filters, cursor: undefined });
  }
  const warehouses = await warehouseChoices(staff);
  const filterValues = Object.fromEntries(
    Object.entries(parsed.success ? searchValues : {}).filter(([key]) => key !== 'cursor'),
  );
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <InventoryReadOnlyNotice canWrite={canWrite} what="stock" />
      {notice === null ? null : <InlineAlert tone="warning">{notice}</InlineAlert>}
      <StockFilters
        key={new URLSearchParams(filterValues).toString()}
        values={{
          ...(filters.search === undefined ? {} : { search: filters.search }),
          ...(filters.warehouseId === undefined ? {} : { warehouseId: filters.warehouseId }),
          lowStockOnly: filters.lowStockOnly,
        }}
        warehouses={warehouses}
      />
      <Text variant="body3" tone="muted">
        On hand is what is in the warehouse; reserved is held for placed orders; available is on
        hand minus reserved, the quantity that can still be sold.
      </Text>
      {warehouses.length === 0 ? (
        <InlineAlert tone="info">
          There are no warehouses yet. Add one under Warehouses before receiving stock.
        </InlineAlert>
      ) : null}
      {page.items.length === 0 ? (
        <EmptyState
          icon="inbox"
          headingLevel={2}
          title={filters.lowStockOnly ? 'Nothing is low on stock' : 'No products found'}
          description={
            filters.lowStockOnly
              ? 'No variant is at or below its alert level for these filters.'
              : 'Change the filters, or add products with variants in the catalogue.'
          }
        />
      ) : (
        <StockMatrix
          products={page.items}
          warehouses={warehouses}
          selectedWarehouseId={filters.warehouseId}
          canWrite={canWrite}
        />
      )}
      <PageLinks
        basePath="/inventory"
        filters={filterValues}
        isFirstPage={filters.cursor === undefined || notice !== null}
        nextCursor={page.nextCursor}
      />
    </Flexbox>
  );
}

export default function InventoryPage({ searchParams }: PageProps<'/admin/inventory'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {searchParams.then((values) => (
        <AdminPageFrame
          path="/inventory"
          title="Inventory"
          readPermission="inventory.read"
          writePermission="inventory.write"
        >
          {({ staff, canWrite }) => (
            <StockView staff={staff} canWrite={canWrite} searchValues={firstSearchValues(values)} />
          )}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
