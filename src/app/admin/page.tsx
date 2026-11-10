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
import { currentStaffOrRedirect } from '@/modules/identity/current-session';
import { getStaffProfile } from '@/modules/identity/staff-account.service';
import { adminNavigationEntries, visibleNavigationItems } from './admin-shell';

const placeholderKpis = ['Orders', 'GMV', 'COD collected', 'Average order value'] as const;

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
