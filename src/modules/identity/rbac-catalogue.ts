import type { DatabaseClient } from '@/lib/db';

// The role-based access catalogue (plan D1/D2): every permission, every role and what each role may do.
// Reference data, not demo data: it is needed in every environment, including production.
export const permissionCatalogue = [
  { code: 'catalogue.read', description: 'View product types, attributes, brands and products' },
  {
    code: 'catalogue.write',
    description: 'Create and edit product types, attributes, brands and products',
  },
  { code: 'taxonomy.write', description: 'Manage the category tree, tagging and product groups' },
  { code: 'merchandising.write', description: 'Manage collections, banners and store branding' },
  { code: 'inventory.read', description: 'View warehouses, stock and the inventory ledger' },
  { code: 'inventory.write', description: 'Adjust and transfer stock' },
  { code: 'warehouses.write', description: 'Create and edit warehouses' },
  { code: 'orders.read', description: 'View orders, shipments and returns' },
  { code: 'orders.write', description: 'Change order and shipment status' },
  { code: 'returns.write', description: 'Decide returns and record refunds' },
  { code: 'couriers.write', description: 'Manage courier partners and serviceable pincodes' },
  { code: 'customers.read', description: 'View customers' },
  { code: 'customers.block', description: 'Block and unblock customers' },
  { code: 'coupons.write', description: 'Create and edit coupons' },
  { code: 'settings.write', description: 'Change store settings' },
  { code: 'reports.read', description: 'View dashboard, reports and exports' },
  { code: 'audit.read', description: 'View the audit trail' },
  { code: 'search.manage', description: 'View search index health and trigger reindex' },
  { code: 'staff.manage', description: 'Manage staff users and roles' },
] as const;

type CataloguePermissionCode = (typeof permissionCatalogue)[number]['code'];

const allPermissionCodes: readonly CataloguePermissionCode[] = permissionCatalogue.map(
  (permissionSeed) => permissionSeed.code,
);

export const roleCatalogue: readonly {
  code: string;
  name: string;
  description: string;
  permissionCodes: readonly CataloguePermissionCode[];
}[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super admin',
    description: 'Full access including staff management',
    permissionCodes: allPermissionCodes,
  },
  {
    code: 'CATALOGUE_MANAGER',
    name: 'Catalogue manager',
    description: 'Catalogue, taxonomy, grouping and merchandising',
    permissionCodes: [
      'catalogue.read',
      'catalogue.write',
      'taxonomy.write',
      'merchandising.write',
      'inventory.read',
      'reports.read',
    ],
  },
  {
    code: 'INVENTORY_MANAGER',
    name: 'Inventory manager',
    description: 'Warehouses and stock',
    permissionCodes: [
      'catalogue.read',
      'inventory.read',
      'inventory.write',
      'warehouses.write',
      'orders.read',
      'reports.read',
    ],
  },
  {
    code: 'ORDER_OPS',
    name: 'Order operations',
    description: 'Orders, shipments, couriers and returns',
    permissionCodes: [
      'catalogue.read',
      'inventory.read',
      'orders.read',
      'orders.write',
      'returns.write',
      'couriers.write',
      'customers.read',
      'reports.read',
    ],
  },
  {
    code: 'SUPPORT',
    name: 'Support (read-only)',
    description: 'Read-only access for customer support',
    permissionCodes: [
      'catalogue.read',
      'inventory.read',
      'orders.read',
      'customers.read',
      'reports.read',
      'audit.read',
    ],
  },
];

function permissionIdFor(permissionIdByCode: ReadonlyMap<string, string>, code: string): string {
  const permissionId = permissionIdByCode.get(code);
  if (permissionId === undefined) throw new Error(`RBAC catalogue is missing permission ${code}`);
  return permissionId;
}

// Creates or updates every permission, role and role-permission link (idempotent). The seed and the
// first-admin bootstrap both call it, so a fresh deployment gets the same RBAC catalogue as development.
export async function ensureRbacCatalogue(client: DatabaseClient): Promise<Map<string, string>> {
  const permissionIdByCode = new Map<string, string>();
  for (const { code, description } of permissionCatalogue) {
    const permission = await client.permission.upsert({
      where: { code },
      create: { code, description },
      update: { description },
      select: { id: true },
    });
    permissionIdByCode.set(code, permission.id);
  }

  const roleIdByCode = new Map<string, string>();
  for (const roleDefinition of roleCatalogue) {
    const role = await client.role.upsert({
      where: { code: roleDefinition.code },
      create: {
        code: roleDefinition.code,
        name: roleDefinition.name,
        description: roleDefinition.description,
      },
      update: { name: roleDefinition.name, description: roleDefinition.description },
      select: { id: true },
    });
    roleIdByCode.set(roleDefinition.code, role.id);
    await client.rolePermission.createMany({
      data: roleDefinition.permissionCodes.map((permissionCode) => ({
        roleId: role.id,
        permissionId: permissionIdFor(permissionIdByCode, permissionCode),
      })),
      skipDuplicates: true,
    });
  }
  return roleIdByCode;
}
