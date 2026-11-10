import type { AdminNavigationItem } from '@/components/layouts/AdminLayout';
import type { PermissionCode } from '@/modules/identity/permissions';

export type AdminNavigationEntry = AdminNavigationItem &
  Readonly<{ requiredPermission?: PermissionCode }>;

// Later waves add sections here with the permission each one needs.
export const adminNavigationEntries: readonly AdminNavigationEntry[] = [
  { label: 'Dashboard', href: '/', icon: 'layout-dashboard' },
  { label: 'Products', href: '/products', icon: 'package', requiredPermission: 'catalogue.read' },
  {
    label: 'Product types',
    href: '/product-types',
    icon: 'layers',
    requiredPermission: 'catalogue.read',
  },
  { label: 'Brands', href: '/brands', icon: 'tag', requiredPermission: 'catalogue.read' },
];

// Signed-out pages (not-found) show the entries every staff member can see.
export const adminNavigationItems: readonly AdminNavigationItem[] = visibleNavigationItems(
  adminNavigationEntries,
  new Set(),
);

export function visibleNavigationItems(
  entries: readonly AdminNavigationEntry[],
  permissionCodes: ReadonlySet<PermissionCode>,
): AdminNavigationItem[] {
  return entries
    .filter(
      ({ requiredPermission }) =>
        requiredPermission === undefined || permissionCodes.has(requiredPermission),
    )
    .map(({ label, href, icon }) => ({ label, href, icon }));
}
