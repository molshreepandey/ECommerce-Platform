import type { StoreNavigationLink } from '@/components/layouts/StoreLayout';

export const storeName = 'ShopSphere';

export const storeNavigationLinks: readonly StoreNavigationLink[] = [
  // On phones the department bar has "All categories" and the footer has "Track your orders".
  { label: 'Categories', href: '/categories', hideOnSmallScreens: true, icon: 'layers' },
  { label: 'Orders', href: '/orders', hideOnSmallScreens: true, icon: 'package' },
  { label: 'Account', href: '/account', icon: 'user' },
];
