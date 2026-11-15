import { ensureRbacCatalogue } from '../../src/modules/identity/rbac-catalogue';

import type { SeedClient } from './seed-client';
import { daysFromSeedDay } from './seed-clock';
import { deterministicUuidV7, requireValue } from './seed-ids';

// New demo accounts start with this; demo-passwords.seed.ts replaces it with an Argon2id hash.
export const placeholderPasswordHash = 'SEED_PLACEHOLDER_PASSWORD_HASH_REPLACED_IN_WAVE_2';

// The permission and role catalogue lives in the identity module (shared with the first-admin bootstrap).
export { permissionCatalogue as permissionSeeds } from '../../src/modules/identity/rbac-catalogue';

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
  const roleIdByCode = await ensureRbacCatalogue(client);
  await seedStaffUsers(client, roleIdByCode);
  return seedCustomers(client);
}
