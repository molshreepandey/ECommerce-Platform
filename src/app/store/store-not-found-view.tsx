import { EmptyState } from '@/components/atoms/EmptyState';
import { Link } from '@/components/atoms/Link';
import { StoreLayout } from '@/components/layouts/StoreLayout';

import { storeName, storeNavigationLinks } from './store-shell';

export const storeNotFoundTitle = 'Page not found';

export function StoreNotFoundView() {
  return (
    <StoreLayout storeName={storeName} navigationLinks={storeNavigationLinks}>
      <EmptyState
        icon="search"
        title={storeNotFoundTitle}
        headingLevel={1}
        description="The page you are looking for does not exist or has moved."
        action={<Link href="/">Back to the store</Link>}
      />
    </StoreLayout>
  );
}
