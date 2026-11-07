import { EmptyState } from '@/components/atoms/EmptyState';
import { Link } from '@/components/atoms/Link';
import { AdminLayout } from '@/components/layouts/AdminLayout';

import { adminNavigationItems } from './admin-shell';

export const adminNotFoundTitle = 'Page not found';

export function AdminNotFoundView() {
  return (
    <AdminLayout navigationItems={adminNavigationItems} title={adminNotFoundTitle}>
      <EmptyState
        icon="search"
        title="This admin page does not exist"
        description="Check the address or use the navigation to find what you need."
        action={<Link href="/">Back to the dashboard</Link>}
      />
    </AdminLayout>
  );
}
