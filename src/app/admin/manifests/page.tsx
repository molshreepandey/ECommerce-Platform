import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Link } from '@/components/atoms/Link';
import { Select } from '@/components/atoms/Select';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { ShipmentStatusBadge } from '@/components/organisms/OrderViews';
import { formatPaise } from '@/lib/money';
import type { StaffContext } from '@/modules/identity/access-control';
import { manifestQuerySchema } from '@/modules/ordering/manifest.schema';
import { getManifest, listManifestWarehouses } from '@/modules/ordering/order-documents.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Manifests' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

// D35: the daily courier hand-over list per warehouse, on screen and as a PDF to sign.
async function Manifest({
  staff,
  searchParams,
}: Readonly<{ staff: StaffContext; searchParams: SearchParams }>) {
  const values = firstSearchValues(await searchParams);
  const warehouses = await listManifestWarehouses(staff);
  const query = manifestQuerySchema.safeParse({
    warehouseId: values['warehouseId'] ?? warehouses[0]?.id ?? '',
    date: values['date'] ?? istToday(),
  });
  if (warehouses.length === 0)
    return <EmptyState icon="warehouse" headingLevel={2} title="No warehouses yet" />;
  const manifest = query.success
    ? await getManifest(staff, query.data.warehouseId, query.data.date)
    : null;
  const pdfHref = query.success
    ? `/api/admin/manifests/pdf?${new URLSearchParams({ warehouseId: query.data.warehouseId, date: query.data.date }).toString()}`
    : null;
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <form
        method="get"
        action="/manifests"
        aria-label="Choose a manifest"
        className="flex flex-wrap items-end gap-md rounded-default border border-lowlight bg-white p-md"
      >
        <label className="flex flex-col gap-xs">
          <Text as="span" variant="body2-medium">
            Warehouse
          </Text>
          <Select
            name="warehouseId"
            aria-label="Warehouse"
            defaultValue={query.success ? query.data.warehouseId : (warehouses[0]?.id ?? '')}
            options={warehouses.map((warehouse) => ({
              value: warehouse.id,
              label: `${warehouse.name} (${warehouse.code})`,
            }))}
          />
        </label>
        <FormField
          label="Day (IST)"
          name="date"
          type="date"
          defaultValue={query.success ? query.data.date : istToday()}
        />
        <Button type="submit" appearance="primary">
          Show
        </Button>
        {pdfHref === null ? null : (
          <Link href={pdfHref} target="_blank" rel="noopener">
            Download PDF
          </Link>
        )}
      </form>
      {manifest === null || manifest.shipments.length === 0 ? (
        <EmptyState
          icon="truck"
          headingLevel={2}
          title="Nothing handed over that day"
          description="Shipments appear here once they are marked shipped."
        />
      ) : (
        <ul aria-label="Manifest" className="flex flex-col gap-sm">
          {manifest.shipments.map((row) => (
            <li
              key={row.shipmentId}
              className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
            >
              <Text variant="body2">
                AWB {row.awbNumber ?? '—'} · {row.orderNumber} · {row.courierName} · {row.itemCount}{' '}
                items · {row.destination}
              </Text>
              <span className="flex items-center gap-sm">
                {row.collectOnDeliveryPaise > 0 ? (
                  <Text as="span" variant="body3">
                    COD {formatPaise(row.collectOnDeliveryPaise)}
                  </Text>
                ) : null}
                <ShipmentStatusBadge status={row.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Flexbox>
  );
}

export default function ManifestsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/manifests"
        title="Manifests"
        readPermission="orders.read"
        writePermission="orders.write"
      >
        {({ staff }) => <Manifest staff={staff} searchParams={searchParams} />}
      </AdminPageFrame>
    </Suspense>
  );
}
