import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import { LowStockFilters, LowStockList } from '@/components/organisms/InventoryAdmin';
import { formatQuantity } from '@/components/organisms/InventoryAdmin/inventory-format';
import type { StaffContext } from '@/modules/identity/access-control';
import { listLowStockSchema } from '@/modules/inventory/inventory.schema';
import { countLowStock, listLowStock } from '@/modules/inventory/inventory-query.service';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { firstSearchValues } from '../../catalogue-page-parts';
import { PageLinks, warehouseChoices } from '../inventory-page-parts';

export const metadata: Metadata = { title: 'Low stock' };

async function LowStockView({
  staff,
  searchValues,
}: Readonly<{ staff: StaffContext; searchValues: Record<string, string> }>) {
  const parsed = listLowStockSchema.safeParse(searchValues);
  const filters = parsed.success ? parsed.data : listLowStockSchema.parse({});
  const [page, totalCount, warehouses] = await Promise.all([
    listLowStock(staff, filters),
    countLowStock(staff, {
      warehouseId: filters.warehouseId,
      includeInactiveWarehouses: filters.includeInactiveWarehouses,
    }),
    warehouseChoices(staff),
  ]);
  const filterValues = Object.fromEntries(
    Object.entries(parsed.success ? searchValues : {}).filter(([key]) => key !== 'cursor'),
  );
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      {parsed.success ? null : (
        <InlineAlert tone="warning">
          Some filters in the address were not valid, so all low stock is shown.
        </InlineAlert>
      )}
      <LowStockFilters
        key={new URLSearchParams(filterValues).toString()}
        values={{
          ...(filters.warehouseId === undefined ? {} : { warehouseId: filters.warehouseId }),
          includeInactiveWarehouses: filters.includeInactiveWarehouses,
        }}
        warehouses={warehouses}
      />
      <Text variant="body3" tone="muted">
        {`${formatQuantity(totalCount)} ${totalCount === 1 ? 'item is' : 'items are'} at or below the alert level. Archived products and variants are never listed.`}
      </Text>
      {page.items.length === 0 ? (
        <EmptyState
          icon="circle-check"
          headingLevel={2}
          title="Nothing is low on stock"
          description="Set alert levels on the Inventory page to be told when stock runs low."
        />
      ) : (
        <LowStockList items={page.items} />
      )}
      <PageLinks
        basePath="/inventory/low-stock"
        filters={filterValues}
        isFirstPage={filters.cursor === undefined}
        nextCursor={page.nextCursor}
      />
    </Flexbox>
  );
}

export default function LowStockPage({ searchParams }: PageProps<'/admin/inventory/low-stock'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {searchParams.then((values) => (
        <AdminPageFrame
          path="/inventory/low-stock"
          title="Low stock"
          readPermission="inventory.read"
          writePermission="inventory.write"
        >
          {({ staff }) => <LowStockView staff={staff} searchValues={firstSearchValues(values)} />}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
