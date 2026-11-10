import type { StoreNavigationLink } from '@/components/layouts/StoreLayout';

export const storeName = 'Demo Store';

export const storeNavigationLinks: readonly StoreNavigationLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Account', href: '/account' },
];
