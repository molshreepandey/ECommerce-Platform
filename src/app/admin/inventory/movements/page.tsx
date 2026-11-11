import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { MovementFilters, MovementList } from '@/components/organisms/InventoryAdmin';
import { ledgerDateBound } from '@/components/organisms/InventoryAdmin/inventory-format';
import type { StaffContext } from '@/modules/identity/access-control';
import { listMovementsSchema } from '@/modules/inventory/inventory.schema';
import { listMovements } from '@/modules/inventory/inventory-query.service';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { firstSearchValues } from '../../catalogue-page-parts';
import { isInvalidCursor, PageLinks, warehouseChoices } from '../inventory-page-parts';

export const metadata: Metadata = { title: 'Stock movements' };

const filterKeys = ['warehouseId', 'variantId', 'movementType', 'from', 'to', 'limit'] as const;

// The URL holds calendar days ("from", "to"); the ledger API takes instants, so they are converted here.
function ledgerQuery(searchValues: Record<string, string>) {
  const { from, to, ...rest } = searchValues;
  const createdFrom = from === undefined ? undefined : ledgerDateBound(from, 'from');
  const createdTo = to === undefined ? undefined : ledgerDateBound(to, 'to');
  if (createdFrom === null || createdTo === null) return null;
  return listMovementsSchema.safeParse({
    ...rest,
    ...(createdFrom === undefined ? {} : { createdFrom }),
    ...(createdTo === undefined ? {} : { createdTo }),
  });
}

async function MovementView({
  staff,
  searchValues,
}: Readonly<{ staff: StaffContext; searchValues: Record<string, string> }>) {
  const query = ledgerQuery(searchValues);
  const valid = query?.success === true;
  const filters = valid ? query.data : listMovementsSchema.parse({});
  let notice: string | null = valid
    ? null
    : 'Some filters in the address were not valid, so all movements are shown.';
  let page;
  try {
    page = await listMovements(staff, filters);
  } catch (error) {
    if (!isInvalidCursor(error)) throw error;
    notice = 'That page link is no longer valid, so the first page is shown.';
    page = await listMovements(staff, { ...filters, cursor: undefined });
  }
  const warehouses = await warehouseChoices(staff);
  const filterValues: Record<string, string> = valid
    ? Object.fromEntries(
        filterKeys.flatMap((key) => {
          const value = searchValues[key];
          return value === undefined ? [] : [[key, value]];
        }),
      )
    : {};
  const variantSku = page.movements[0]?.sku ?? null;
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      {notice === null ? null : <InlineAlert tone="warning">{notice}</InlineAlert>}
      {filters.variantId === undefined ? null : (
        <Text variant="body3" tone="subtitle">
          Showing one variant{variantSku === null ? '' : ` (${variantSku})`}.{' '}
          <Link href="/inventory/movements" variant="body3">
            Show all variants
          </Link>
        </Text>
      )}
      <MovementFilters
        key={new URLSearchParams(filterValues).toString()}
        values={filterValues}
        warehouses={warehouses}
      />
      {page.movements.length === 0 ? (
        <EmptyState
          icon="history"
          headingLevel={2}
          title="No stock movements found"
          description="Every stock change appears here. Change the filters to see more."
        />
      ) : (
        <MovementList movements={page.movements} />
      )}
      <PageLinks
        basePath="/inventory/movements"
        filters={filterValues}
        isFirstPage={filters.cursor === undefined || notice !== null}
        nextCursor={page.nextCursor}
      />
    </Flexbox>
  );
}

export default function MovementsPage({ searchParams }: PageProps<'/admin/inventory/movements'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {searchParams.then((values) => (
        <AdminPageFrame
          path="/inventory/movements"
          title="Stock movements"
          readPermission="inventory.read"
          writePermission="inventory.write"
        >
          {({ staff }) => <MovementView staff={staff} searchValues={firstSearchValues(values)} />}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
