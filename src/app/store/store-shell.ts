import type { StoreNavigationLink } from '@/components/layouts/StoreLayout';

export const storeName = 'ShopSphere';

export const storeNavigationLinks: readonly StoreNavigationLink[] = [
  { label: 'Categories', href: '/categories' },
  { label: 'Orders', href: '/orders' },
  { label: 'Account', href: '/account' },
];
