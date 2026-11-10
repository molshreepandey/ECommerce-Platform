export const permissionCodes = [
  'catalogue.read',
  'catalogue.write',
  'taxonomy.write',
  'merchandising.write',
  'inventory.read',
  'inventory.write',
  'warehouses.write',
  'orders.read',
  'orders.write',
  'returns.write',
  'couriers.write',
  'customers.read',
  'customers.block',
  'coupons.write',
  'settings.write',
  'reports.read',
  'audit.read',
  'search.manage',
  'staff.manage',
] as const;

export type PermissionCode = (typeof permissionCodes)[number];

const permissionCodeSet: ReadonlySet<string> = new Set(permissionCodes);

export function isPermissionCode(value: string): value is PermissionCode {
  return permissionCodeSet.has(value);
}
