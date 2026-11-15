import { Suspense } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Grid } from '@/components/atoms/Grid';
import { Heading } from '@/components/atoms/Heading';
import { Spinner } from '@/components/atoms/Spinner';
import { Text } from '@/components/atoms/Text';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { AdminSessionMenu } from '@/components/organisms/AdminSessionMenu';
import { DashboardCharts, ReportRangeForm } from '@/components/organisms/ReportsAdmin';
import { formatPaise } from '@/lib/money';
import { LowStockTile } from '@/components/organisms/InventoryAdmin';
import type { StaffContext } from '@/modules/identity/access-control';
import { currentStaffOrRedirect } from '@/modules/identity/current-session';
import { getStaffProfile } from '@/modules/identity/staff-account.service';
import { countLowStock, listLowStock } from '@/modules/inventory/inventory-query.service';
import {
  getDashboard,
  reportRangeSchema,
  resolveReportRange,
} from '@/modules/reporting/report.service';
import { orderStatusAppearance } from '@/theme';
import { adminNavigationEntries, visibleNavigationItems } from './admin-shell';
import { firstSearchValues } from './catalogue-page-parts';

// Shown only to staff who can read inventory (the queries check the permission again).
async function InventorySummary({ staff }: Readonly<{ staff: StaffContext }>) {
  if (!staff.permissionCodes.has('inventory.read')) return null;
  const [totalCount, firstItems] = await Promise.all([
    countLowStock(staff),
    listLowStock(staff, { includeInactiveWarehouses: false, limit: 5 }),
  ]);
  return <LowStockTile totalCount={totalCount} items={firstItems.items} />;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function SalesOverview({
  staff,
  searchParams,
}: Readonly<{ staff: StaffContext; searchParams: SearchParams }>) {
  if (!staff.permissionCodes.has('reports.read')) return null;
  const range = resolveReportRange(reportRangeSchema.parse(firstSearchValues(await searchParams)));
  const dashboard = await getDashboard(staff, range);
  const { kpis } = dashboard;
  const kpiTiles = [
    { label: 'Orders', value: String(kpis.orderCount) },
    { label: 'GMV', value: formatPaise(kpis.grossMerchandiseValuePaise) },
    { label: 'COD collected', value: formatPaise(kpis.codCollectedPaise) },
    { label: 'Paid online', value: formatPaise(kpis.onlineCollectedPaise) },
    { label: 'Average order value', value: formatPaise(kpis.averageOrderValuePaise) },
    { label: 'Cancellations', value: String(kpis.cancelledCount) },
    { label: 'Returned to origin', value: String(kpis.rtoCount) },
    { label: 'Return requests', value: String(kpis.returnCount) },
  ];
  return (
    <Flexbox direction="column" gap="lg">
      <ReportRangeForm action="/" fromDay={range.fromDay} toDay={range.toDay} />
      <Grid columns={4} gap="lg" as="ul" aria-label="Key figures">
        {kpiTiles.map((tile) => (
          <Card as="li" key={tile.label}>
            <Flexbox direction="column" gap="xs">
              <Text variant="body3-medium" tone="muted">
                {tile.label}
              </Text>
              <Heading level={2} variant="heading2-5">
                {tile.value}
              </Heading>
            </Flexbox>
          </Card>
        ))}
      </Grid>
      {kpis.orderCount === 0 ? (
        <Card padding="none">
          <EmptyState
            icon="package"
            title="No orders in this range"
            description="Orders placed on the store will appear here."
          />
        </Card>
      ) : (
        <DashboardCharts
          ordersByDay={dashboard.ordersByDay}
          ordersByStatus={dashboard.ordersByStatus.map(({ status, orderCount }) => ({
            label: orderStatusAppearance[status].label,
            orderCount,
          }))}
          shipmentsByCourier={dashboard.shipmentsByCourier}
        />
      )}
    </Flexbox>
  );
}

async function AdminDashboard({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const staff = await currentStaffOrRedirect('/');
  const profile = await getStaffProfile(staff);
  const roleNames = profile.roles.map(({ name }) => name).join(', ');
  return (
    <AdminLayout
      navigationItems={visibleNavigationItems(adminNavigationEntries, staff.permissionCodes)}
      title="Dashboard"
      headerActions={<AdminSessionMenu fullName={profile.fullName} roleNames={roleNames} />}
    >
      <Flexbox direction="column" gap="xl">
        <SalesOverview staff={staff} searchParams={searchParams} />
        <InventorySummary staff={staff} />
        <Card as="section">
          <Flexbox direction="column" gap="md">
            <Heading level={2} variant="heading4">
              Your access
            </Heading>
            <Text tone="subtitle">
              Signed in as {profile.email} with the role {roleNames}.
            </Text>
            <ul aria-label="Your permissions" className="flex flex-wrap gap-xs">
              {profile.permissionCodes.map((permissionCode) => (
                <li key={permissionCode}>
                  <Badge tone="info">{permissionCode}</Badge>
                </li>
              ))}
            </ul>
          </Flexbox>
        </Card>
      </Flexbox>
    </AdminLayout>
  );
}

export default function AdminDashboardPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size="lg" label="Loading" />
        </div>
      }
    >
      <AdminDashboard searchParams={searchParams} />
    </Suspense>
  );
}
