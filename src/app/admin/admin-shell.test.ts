import { describe, expect, it } from 'vitest';

import {
  type AdminNavigationEntry,
  adminNavigationEntries,
  visibleNavigationItems,
} from './admin-shell';

const entries: AdminNavigationEntry[] = [
  { label: 'Dashboard', href: '/', icon: 'layout-dashboard' },
  { label: 'Orders', href: '/orders', icon: 'package', requiredPermission: 'orders.read' },
  { label: 'Staff', href: '/staff', icon: 'user', requiredPermission: 'staff.manage' },
];

describe('visibleNavigationItems', () => {
  it('shows only entries without a requirement when the user has no permissions', () => {
    expect(visibleNavigationItems(entries, new Set()).map(({ label }) => label)).toEqual([
      'Dashboard',
    ]);
  });

  it('adds the entries whose permission the user holds, keeping order', () => {
    expect(
      visibleNavigationItems(entries, new Set(['orders.read'])).map(({ label }) => label),
    ).toEqual(['Dashboard', 'Orders']);
    expect(
      visibleNavigationItems(entries, new Set(['staff.manage', 'orders.read'])).map(
        ({ label }) => label,
      ),
    ).toEqual(['Dashboard', 'Orders', 'Staff']);
  });

  it('does not pass the permission requirement on to the layout', () => {
    expect(visibleNavigationItems(entries, new Set(['orders.read']))[1]).toEqual({
      label: 'Orders',
      href: '/orders',
      icon: 'package',
    });
  });

  it('keeps each sidebar section in one run and passes the section through', () => {
    const allPermissions = new Set(
      adminNavigationEntries.flatMap(({ requiredPermission }) =>
        requiredPermission === undefined ? [] : [requiredPermission],
      ),
    );
    const items = visibleNavigationItems(adminNavigationEntries, allPermissions);
    expect(items).toHaveLength(adminNavigationEntries.length);
    const runs = items
      .map(({ section }) => section ?? '')
      .filter((section, index, all) => section !== all[index - 1]);
    expect(new Set(runs).size).toBe(runs.length);
    expect(items.find(({ href }) => href === '/orders')?.section).toBe('Orders');
  });
});
