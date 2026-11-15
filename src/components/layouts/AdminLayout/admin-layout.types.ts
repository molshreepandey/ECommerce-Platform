import type { ReactNode } from 'react';
import type { IconName } from '@/components/atoms/Icon';

export type AdminNavigationItem = Readonly<{
  label: string;
  href: string;
  icon: IconName;
  // Sidebar heading for a run of related items (desktop only).
  section?: string;
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
