import type { ReactNode } from 'react';

export type StoreNavigationLink = Readonly<{ label: string; href: string }>;

export type StoreLayoutProps = Readonly<{
  storeName: string;
  navigationLinks: readonly StoreNavigationLink[];
  brand?: ReactNode;
  headerSearch?: ReactNode;
  headerActions?: ReactNode;
  categoryNavigation?: ReactNode;
  children: ReactNode;
}>;
