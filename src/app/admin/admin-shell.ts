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
  {
    label: 'Categories',
    href: '/categories',
    icon: 'folder-tree',
    requiredPermission: 'catalogue.read',
  },
  { label: 'Tagging', href: '/tagging', icon: 'list-checks', requiredPermission: 'catalogue.read' },
  {
    label: 'Product groups',
    href: '/product-groups',
    icon: 'boxes',
    requiredPermission: 'catalogue.read',
  },
  { label: 'Inventory', href: '/inventory', icon: 'inbox', requiredPermission: 'inventory.read' },
  {
    label: 'Low stock',
    href: '/inventory/low-stock',
    icon: 'triangle-alert',
    requiredPermission: 'inventory.read',
  },
  {
    label: 'Stock movements',
    href: '/inventory/movements',
    icon: 'history',
    requiredPermission: 'inventory.read',
  },
  {
    label: 'Warehouses',
    href: '/warehouses',
    icon: 'warehouse',
    requiredPermission: 'inventory.read',
  },
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
