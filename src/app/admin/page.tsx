import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Grid } from '@/components/atoms/Grid';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { adminNavigationItems } from './admin-shell';

const placeholderKpis = ['Orders', 'GMV', 'COD collected', 'Average order value'] as const;

export default function AdminDashboardPage() {
  return (
    <AdminLayout navigationItems={adminNavigationItems} title="Dashboard">
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
      </Flexbox>
    </AdminLayout>
  );
}
