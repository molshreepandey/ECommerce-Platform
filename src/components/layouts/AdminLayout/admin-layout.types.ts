import type { ReactNode } from 'react';
import type { IconName } from '@/components/atoms/Icon';

export type AdminNavigationItem = Readonly<{
  label: string;
  href: string;
  icon: IconName;
}>;

export type AdminSidenavProps = Readonly<{
  navigationItems: readonly AdminNavigationItem[];
}>;

export type AdminLayoutProps = Readonly<{
  navigationItems: readonly AdminNavigationItem[];
  title: string;
  headerActions?: ReactNode;
  children: ReactNode;
}>;
