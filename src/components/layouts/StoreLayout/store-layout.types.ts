import type { ReactNode } from 'react';

export type StoreNavigationLink = Readonly<{ label: string; href: string }>;

export type StoreLayoutProps = Readonly<{
  storeName: string;
  navigationLinks: readonly StoreNavigationLink[];
  children: ReactNode;
}>;
