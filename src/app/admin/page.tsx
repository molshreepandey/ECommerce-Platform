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
import { LowStockTile } from '@/components/organisms/InventoryAdmin';
import type { StaffContext } from '@/modules/identity/access-control';
import { currentStaffOrRedirect } from '@/modules/identity/current-session';
import { getStaffProfile } from '@/modules/identity/staff-account.service';
import { countLowStock, listLowStock } from '@/modules/inventory/inventory-query.service';
import { adminNavigationEntries, visibleNavigationItems } from './admin-shell';

const placeholderKpis = ['Orders', 'GMV', 'COD collected', 'Average order value'] as const;

// Shown only to staff who can read inventory (the queries check the permission again).
async function InventorySummary({ staff }: Readonly<{ staff: StaffContext }>) {
  if (!staff.permissionCodes.has('inventory.read')) return null;
  const [totalCount, firstItems] = await Promise.all([
    countLowStock(staff),
    listLowStock(staff, { includeInactiveWarehouses: false, limit: 5 }),
  ]);
  return <LowStockTile totalCount={totalCount} items={firstItems.items} />;
}

async function AdminDashboard() {
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
        <Grid columns={4} gap="lg" as="ul">
          {placeholderKpis.map((kpiLabel) => (
            <Card as="li" key={kpiLabel}>
              <Flexbox direction="column" gap="xs">
                <Text variant="body3-medium" tone="muted">
                  {kpiLabel}
                </Text>
                <Heading level={2} variant="heading2-5">
                  —
                </Heading>
              </Flexbox>
            </Card>
          ))}
        </Grid>
        <InventorySummary staff={staff} />
        <Card padding="none">
          <EmptyState
            icon="package"
            title="No orders yet"
            description="Orders placed on the store will appear here."
          />
        </Card>
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

export default function AdminDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner size="lg" label="Loading" />
        </div>
      }
    >
      <AdminDashboard />
    </Suspense>
  );
}
