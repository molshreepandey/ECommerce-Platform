import type { ReactNode } from 'react';
import type { IconName } from '@/components/atoms/Icon';

// hideOnSmallScreens: left out of the phone header to keep it to one row (still reachable elsewhere).
export type StoreNavigationLink = Readonly<{
  label: string;
  href: string;
  hideOnSmallScreens?: boolean;
  // Shown as an icon, with the label as its accessible name (the label shows beside it on wide screens).
  icon?: IconName;
}>;

export type StoreLayoutProps = Readonly<{
  storeName: string;
  navigationLinks: readonly StoreNavigationLink[];
  brand?: ReactNode;
  headerSearch?: ReactNode;
  headerActions?: ReactNode;
  categoryNavigation?: ReactNode;
  // The page lays out its own full-bleed sections (the home page); otherwise a centred column.
  fullWidth?: boolean;
  children: ReactNode;
}>;
