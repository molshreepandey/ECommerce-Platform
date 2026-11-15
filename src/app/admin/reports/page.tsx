import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { ButtonLink } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { ReportRangeForm } from '@/components/organisms/ReportsAdmin';
import { formatPaise } from '@/lib/money';
import type { StaffContext } from '@/modules/identity/access-control';
import {
  getReports,
  reportRangeSchema,
  resolveReportRange,
} from '@/modules/reporting/report.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Reports' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function RankedList({
  title,
  rows,
}: Readonly<{
  title: string;
  rows: readonly { key: string; label: string; quantity: number; salesPaise: number }[];
}>) {
  return (
    <Card as="section">
      <Flexbox direction="column" gap="md">
        <Heading level={2} variant="heading5">
          {title}
        </Heading>
        {rows.length === 0 ? (
          <Text tone="muted">No sales in this range.</Text>
        ) : (
          <ol className="flex flex-col gap-xs">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className="flex items-baseline justify-between gap-md border-b border-strokes py-xs last:border-b-0"
              >
                <Text variant="body2">
                  {index + 1}. {row.label}
                </Text>
                <Text variant="body3" tone="muted">
                  {row.quantity} sold · {formatPaise(row.salesPaise)}
                </Text>
              </li>
            ))}
          </ol>
        )}
      </Flexbox>
    </Card>
  );
}

async function Reports({
  staff,
  searchParams,
}: Readonly<{ staff: StaffContext; searchParams: SearchParams }>) {
  const range = resolveReportRange(reportRangeSchema.parse(firstSearchValues(await searchParams)));
  const reports = await getReports(staff, range);
  const { reconciliation } = reports;
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <ReportRangeForm action="/reports" fromDay={range.fromDay} toDay={range.toDay} />
      <section aria-labelledby="exports-heading" className="flex flex-col gap-sm">
        <Heading level={2} variant="heading5" id="exports-heading">
          CSV exports for this range
        </Heading>
        <div className="flex flex-wrap gap-sm">
          {(
            [
              ['orders', 'Orders'],
              ['sales', 'Daily sales'],
              ['gst-summary', 'GST summary'],
              ['inventory', 'Stock by warehouse'],
            ] as const
          ).map(([report, label]) => (
            <ButtonLink
              key={report}
              size="sm"
              iconBefore="arrow-down"
              href={`/api/admin/reports/export/${report}?from=${range.fromDay}&to=${range.toDay}`}
              prefetch={false}
              download
            >
              {label}
            </ButtonLink>
          ))}
        </div>
      </section>
      <Card as="section">
        <Flexbox direction="column" gap="md">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <Heading level={2} variant="heading5">
              Reconciliation
            </Heading>
            <Badge tone={reconciliation.isBalanced ? 'success' : 'danger'}>
              {reconciliation.isBalanced ? 'balanced' : 'does not match'}
            </Badge>
          </div>
          <Text variant="body3" tone="muted">
            Non-cancelled orders placed {range.fromDay} to {range.toDay} (IST): the daily report
            added up, the order rows, and the payment rows of those orders must agree.
          </Text>
          <dl className="grid grid-cols-1 gap-md md:grid-cols-3">
            {[
              {
                label: 'Report total (sum of days)',
                value: formatPaise(reconciliation.reportTotalPaise),
              },
              {
                label: `Order rows (${String(reconciliation.orderCount)})`,
                value: formatPaise(reconciliation.orderTotalPaise),
              },
              {
                label: `Payment rows (${String(reconciliation.paymentCount)})`,
                value: formatPaise(reconciliation.paymentTotalPaise),
              },
            ].map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-xs rounded-default border border-strokes p-md"
              >
                <dt>
                  <Text as="span" variant="body3" tone="muted">
                    {item.label}
                  </Text>
                </dt>
                <dd>
                  <Text as="span" variant="body1-medium">
                    {item.value}
                  </Text>
                </dd>
              </div>
            ))}
          </dl>
        </Flexbox>
      </Card>
      <div className="grid grid-cols-1 gap-lg xl:grid-cols-2">
        <RankedList
          title="Top products"
          rows={reports.topProducts.map((row) => ({
            key: row.productId,
            label: row.productName,
            quantity: row.quantity,
            salesPaise: row.salesPaise,
          }))}
        />
        <RankedList
          title="Top categories"
          rows={reports.topCategories.map((row) => ({
            key: row.categoryName,
            label: row.categoryName,
            quantity: row.quantity,
            salesPaise: row.salesPaise,
          }))}
        />
      </div>
      <Card as="section">
        <Flexbox direction="column" gap="md">
          <Heading level={2} variant="heading5">
            Stock by warehouse
          </Heading>
          <ul className="grid grid-cols-1 gap-sm md:grid-cols-3">
            {reports.stockByWarehouse.map((warehouse) => (
              <li
                key={warehouse.warehouseName}
                className="flex flex-col gap-xs rounded-default border border-strokes p-md"
              >
                <div className="flex items-center justify-between gap-sm">
                  <Text variant="body2-medium">{warehouse.warehouseName}</Text>
                  {warehouse.isActive ? null : <Badge tone="warning">inactive</Badge>}
                </div>
                <Text variant="body3" tone="muted">
                  On hand {warehouse.onHandQuantity} · reserved {warehouse.reservedQuantity} ·
                  available {warehouse.availableQuantity}
                </Text>
              </li>
            ))}
          </ul>
        </Flexbox>
      </Card>
    </Flexbox>
  );
}

export default function ReportsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/reports"
        title="Reports"
        readPermission="reports.read"
        writePermission="reports.read"
      >
        {({ staff }) => <Reports staff={staff} searchParams={searchParams} />}
      </AdminPageFrame>
    </Suspense>
  );
}
