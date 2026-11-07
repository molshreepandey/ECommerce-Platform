'use client';

import { cva } from 'class-variance-authority';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { Icon } from '@/components/atoms/Icon';
import type { AdminSidenavProps } from './admin-layout.types';

const sidenavLinkClassNames = cva(
  [
    'flex items-center gap-sm rounded-default px-md py-sm text-body2 whitespace-nowrap transition-colors',
    focusRingClassNames,
  ],
  {
    variants: {
      isActive: {
        true: 'bg-nav-group text-white',
        false: 'text-lowlight-2 hover:bg-nav-hover hover:text-white',
      },
    },
  },
);

function isActivePath(currentPath: string, itemHref: string): boolean {
  if (itemHref === '/') return currentPath === '/';
  return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`);
}

export function AdminSidenav({ navigationItems }: AdminSidenavProps) {
  const currentPath = usePathname();
  return (
    <aside className="bg-nav-background md:min-h-screen md:w-60 md:shrink-0">
      <div className="flex items-center gap-sm px-lg py-md text-white">
        <Icon name="store" size="md" />
        <span className="text-heading4">Admin</span>
      </div>
      <nav aria-label="Admin">
        <ul className="flex gap-xs overflow-x-auto px-sm pb-sm md:flex-col md:overflow-visible">
          {navigationItems.map((navigationItem) => {
            const isActive = isActivePath(currentPath, navigationItem.href);
            return (
              <li key={navigationItem.href}>
                <NextLink
                  href={navigationItem.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={sidenavLinkClassNames({ isActive })}
                >
                  <Icon name={navigationItem.icon} size="sm" />
                  {navigationItem.label}
                </NextLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
