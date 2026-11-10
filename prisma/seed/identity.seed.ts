import type { SeedClient } from './seed-client';
import { daysFromSeedDay } from './seed-clock';
import { deterministicUuidV7, requireValue } from './seed-ids';

// New demo accounts start with this; demo-passwords.seed.ts replaces it with an Argon2id hash.
export const placeholderPasswordHash = 'SEED_PLACEHOLDER_PASSWORD_HASH_REPLACED_IN_WAVE_2';

export const permissionSeeds = [
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

type PermissionCode = (typeof permissionSeeds)[number]['code'];

const allPermissionCodes: readonly PermissionCode[] = permissionSeeds.map(
  (permissionSeed) => permissionSeed.code,
);

const roleDefinitions: readonly {
  code: string;
  name: string;
  description: string;
  permissionCodes: readonly PermissionCode[];
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

export const staffUsers = [
  { email: 'super.admin@demo-store.test', fullName: 'Sana Kapoor', roleCode: 'SUPER_ADMIN' },
  {
    email: 'catalogue.manager@demo-store.test',
    fullName: 'Arjun Nair',
    roleCode: 'CATALOGUE_MANAGER',
  },
  {
    email: 'inventory.manager@demo-store.test',
    fullName: 'Priya Rao',
    roleCode: 'INVENTORY_MANAGER',
  },
  { email: 'order.ops@demo-store.test', fullName: 'Vikram Shah', roleCode: 'ORDER_OPS' },
  { email: 'support@demo-store.test', fullName: 'Meera Das', roleCode: 'SUPPORT' },
] as const;

export const demoCustomers = [
  {
    key: 'asha',
    fullName: 'Asha Verma',
    email: 'asha.verma@demo-store.test',
    phone: '9876500001',
    addresses: [
      {
        key: 'home',
        recipientName: 'Asha Verma',
        addressLine1: '12, 4th Cross, Koramangala',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
        isDefault: true,
      },
      {
        key: 'parents',
        recipientName: 'Kamala Verma',
        addressLine1: '45, Anna Salai',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
        isDefault: false,
      },
    ],
  },
  {
    key: 'rahul',
    fullName: 'Rahul Mehta',
    email: 'rahul.mehta@demo-store.test',
    phone: '9876500002',
    addresses: [
      {
        key: 'home',
        recipientName: 'Rahul Mehta',
        addressLine1: 'B-14, Malviya Nagar',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110017',
        isDefault: true,
      },
      {
        key: 'office',
        recipientName: 'Rahul Mehta',
        addressLine1: '7th Floor, Bandra Kurla Complex',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400050',
        isDefault: false,
      },
    ],
  },
  {
    key: 'neha',
    fullName: 'Neha Iyer',
    email: 'neha.iyer@demo-store.test',
    phone: '9876500003',
    addresses: [
      {
        key: 'home',
        recipientName: 'Neha Iyer',
        addressLine1: '22, FC Road, Shivajinagar',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        isDefault: true,
      },
      {
        key: 'hometown',
        recipientName: 'Neha Iyer',
        addressLine1: '9, MI Road',
        city: 'Jaipur',
        state: 'Rajasthan',
        pincode: '302001',
        isDefault: false,
      },
    ],
  },
] as const;

export type DemoCustomerKey = (typeof demoCustomers)[number]['key'];

export interface SeededAddress {
  id: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
}

export interface SeededCustomer {
  id: string;
  defaultAddress: SeededAddress;
  addresses: SeededAddress[];
}

async function seedPermissionsAndRoles(client: SeedClient): Promise<Map<string, string>> {
  const permissionIdByCode = new Map<string, string>();
  for (const { code, description } of permissionSeeds) {
    const permission = await client.permission.upsert({
      where: { code },
      create: { code, description },
      update: { description },
      select: { id: true },
    });
    permissionIdByCode.set(code, permission.id);
  }

  const roleIdByCode = new Map<string, string>();
  for (const roleDefinition of roleDefinitions) {
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
        permissionId: requireValue(
          permissionIdByCode.get(permissionCode),
          `permission ${permissionCode}`,
        ),
      })),
      skipDuplicates: true,
    });
  }
  return roleIdByCode;
}

async function seedStaffUsers(
  client: SeedClient,
  roleIdByCode: Map<string, string>,
): Promise<void> {
  for (const staffUser of staffUsers) {
    const savedStaffUser = await client.staffUser.upsert({
      where: { email: staffUser.email },
      create: {
        email: staffUser.email,
        fullName: staffUser.fullName,
        passwordHash: placeholderPasswordHash,
      },
      update: { fullName: staffUser.fullName },
      select: { id: true },
    });
    await client.staffUserRole.createMany({
      data: [
        {
          staffUserId: savedStaffUser.id,
          roleId: requireValue(roleIdByCode.get(staffUser.roleCode), `role ${staffUser.roleCode}`),
        },
      ],
      skipDuplicates: true,
    });
  }
}

async function seedCustomers(client: SeedClient): Promise<Map<DemoCustomerKey, SeededCustomer>> {
  const customerByKey = new Map<DemoCustomerKey, SeededCustomer>();
  const addressCreatedAt = daysFromSeedDay(-60);
  for (const demoCustomer of demoCustomers) {
    const customer = await client.customer.upsert({
      where: { email: demoCustomer.email },
      create: {
        email: demoCustomer.email,
        fullName: demoCustomer.fullName,
        phone: demoCustomer.phone,
        passwordHash: placeholderPasswordHash,
        createdAt: addressCreatedAt,
      },
      update: { fullName: demoCustomer.fullName, phone: demoCustomer.phone },
      select: { id: true },
    });

    const addresses: SeededAddress[] = [];
    let defaultAddress: SeededAddress | undefined;
    for (const address of demoCustomer.addresses) {
      const addressId = deterministicUuidV7(
        `address:${demoCustomer.key}:${address.key}`,
        addressCreatedAt,
      );
      const addressFields = {
        recipientName: address.recipientName,
        phone: demoCustomer.phone,
        addressLine1: address.addressLine1,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        isDefault: address.isDefault,
      };
      await client.customerAddress.upsert({
        where: { id: addressId },
        create: {
          id: addressId,
          customerId: customer.id,
          createdAt: addressCreatedAt,
          ...addressFields,
        },
        update: addressFields,
      });
      const seededAddress = { id: addressId, ...addressFields };
      addresses.push(seededAddress);
      if (address.isDefault) {
        defaultAddress = seededAddress;
      }
    }

    customerByKey.set(demoCustomer.key, {
      id: customer.id,
      defaultAddress: requireValue(defaultAddress, `default address for ${demoCustomer.key}`),
      addresses,
    });
  }
  return customerByKey;
}

export async function seedIdentity(
  client: SeedClient,
): Promise<Map<DemoCustomerKey, SeededCustomer>> {
  const roleIdByCode = await seedPermissionsAndRoles(client);
  await seedStaffUsers(client, roleIdByCode);
  return seedCustomers(client);
}
