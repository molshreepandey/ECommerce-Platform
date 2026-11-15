import type { AdminNavigationItem } from '@/components/layouts/AdminLayout';
import type { PermissionCode } from '@/modules/identity/permissions';

export type AdminNavigationEntry = AdminNavigationItem &
  Readonly<{ requiredPermission?: PermissionCode }>;

// Grouped by `section` (shown as headings in the sidebar); entries of one section stay together.
export const adminNavigationEntries: readonly AdminNavigationEntry[] = [
  { label: 'Dashboard', href: '/', icon: 'layout-dashboard' },
  {
    label: 'Orders',
    href: '/orders',
    icon: 'clipboard-list',
    section: 'Orders',
    requiredPermission: 'orders.read',
  },
  {
    label: 'Returns',
    href: '/returns',
    icon: 'undo',
    section: 'Orders',
    requiredPermission: 'orders.read',
  },
  {
    label: 'Manifests',
    href: '/manifests',
    icon: 'truck',
    section: 'Orders',
    requiredPermission: 'orders.read',
  },
  {
    label: 'Couriers',
    href: '/couriers',
    icon: 'truck',
    section: 'Orders',
    requiredPermission: 'orders.read',
  },
  {
    label: 'Customers',
    href: '/customers',
    icon: 'users',
    section: 'Customers',
    requiredPermission: 'customers.read',
  },
  {
    label: 'Coupons',
    href: '/coupons',
    icon: 'ticket',
    section: 'Customers',
    requiredPermission: 'coupons.write',
  },
  {
    label: 'Products',
    href: '/products',
    icon: 'package',
    section: 'Catalogue',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Product types',
    href: '/product-types',
    icon: 'layers',
    section: 'Catalogue',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Brands',
    href: '/brands',
    icon: 'tag',
    section: 'Catalogue',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Categories',
    href: '/categories',
    icon: 'folder-tree',
    section: 'Catalogue',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Tagging',
    href: '/tagging',
    icon: 'list-checks',
    section: 'Catalogue',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Product groups',
    href: '/product-groups',
    icon: 'boxes',
    section: 'Catalogue',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Inventory',
    href: '/inventory',
    icon: 'inbox',
    section: 'Inventory',
    requiredPermission: 'inventory.read',
  },
  {
    label: 'Low stock',
    href: '/inventory/low-stock',
    icon: 'triangle-alert',
    section: 'Inventory',
    requiredPermission: 'inventory.read',
  },
  {
    label: 'Stock movements',
    href: '/inventory/movements',
    icon: 'history',
    section: 'Inventory',
    requiredPermission: 'inventory.read',
  },
  {
    label: 'Warehouses',
    href: '/warehouses',
    icon: 'warehouse',
    section: 'Inventory',
    requiredPermission: 'inventory.read',
  },
  {
    label: 'Collections',
    href: '/collections',
    icon: 'layers',
    section: 'Storefront',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Banners',
    href: '/banners',
    icon: 'image',
    section: 'Storefront',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Branding',
    href: '/branding',
    icon: 'store',
    section: 'Storefront',
    requiredPermission: 'merchandising.write',
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: 'chart-column',
    section: 'Administration',
    requiredPermission: 'reports.read',
  },
  {
    label: 'Audit trail',
    href: '/audit',
    icon: 'history',
    section: 'Administration',
    requiredPermission: 'audit.read',
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: 'settings',
    section: 'Administration',
    requiredPermission: 'settings.write',
  },
  {
    label: 'Staff',
    href: '/staff',
    icon: 'users',
    section: 'Administration',
    requiredPermission: 'staff.manage',
  },
  {
    label: 'API docs',
    href: '/docs',
    icon: 'layers',
    section: 'Administration',
    requiredPermission: 'catalogue.read',
  },
  {
    label: 'Search index',
    href: '/search-index',
    icon: 'search',
    section: 'Administration',
    requiredPermission: 'search.manage',
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
    .map(({ label, href, icon, section }) =>
      section === undefined ? { label, href, icon } : { label, href, icon, section },
    );
}
