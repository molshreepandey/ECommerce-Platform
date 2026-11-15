import type { ReactNode } from 'react';

// hideOnSmallScreens: left out of the phone header to keep it to one row (still reachable elsewhere).
export type StoreNavigationLink = Readonly<{
  label: string;
  href: string;
  hideOnSmallScreens?: boolean;
}>;

export type StoreLayoutProps = Readonly<{
  storeName: string;
  navigationLinks: readonly StoreNavigationLink[];
  brand?: ReactNode;
  headerSearch?: ReactNode;
  headerActions?: ReactNode;
  categoryNavigation?: ReactNode;
  children: ReactNode;
}>;
