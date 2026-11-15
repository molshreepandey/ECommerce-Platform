import { EmptyState } from '@/components/atoms/EmptyState';
import { Link } from '@/components/atoms/Link';

import { StorePageFrame } from './store-page-frame';

export const storeNotFoundTitle = 'Page not found';

export function StoreNotFoundView() {
  return (
    <StorePageFrame>
      <EmptyState
        icon="search"
        title={storeNotFoundTitle}
        headingLevel={1}
        description="The page you are looking for does not exist or has moved."
        action={<Link href="/">Back to the store</Link>}
      />
    </StorePageFrame>
  );
}
