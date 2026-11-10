import type { DatabaseClient } from '@/lib/db';

export const addressSelect = {
  id: true,
  recipientName: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  landmark: true,
  city: true,
  state: true,
  pincode: true,
  isDefault: true,
} as const;

export type AddressRow = {
  id: string;
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

export type AddressWrite = Omit<AddressRow, 'id' | 'isDefault'>;

// Holding the customer row lock serialises default-address changes for one customer.
export async function lockCustomerForAddressChange(
  database: DatabaseClient,
  customerId: string,
): Promise<void> {
  await database.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
}

export function listActiveAddresses(
  database: DatabaseClient,
  customerId: string,
): Promise<AddressRow[]> {
  return database.customerAddress.findMany({
    where: { customerId, archivedAt: null },
    select: addressSelect,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

export function findActiveAddress(
  database: DatabaseClient,
  customerId: string,
  addressId: string,
): Promise<AddressRow | null> {
  return database.customerAddress.findFirst({
    where: { id: addressId, customerId, archivedAt: null },
    select: addressSelect,
  });
}

export function countActiveAddresses(
  database: DatabaseClient,
  customerId: string,
): Promise<number> {
  return database.customerAddress.count({ where: { customerId, archivedAt: null } });
}

export async function clearDefaultAddress(
  database: DatabaseClient,
  customerId: string,
): Promise<void> {
  await database.customerAddress.updateMany({
    where: { customerId, isDefault: true },
    data: { isDefault: false },
  });
}

export function insertAddress(
  database: DatabaseClient,
  customerId: string,
  address: AddressWrite & { isDefault: boolean },
): Promise<AddressRow> {
  return database.customerAddress.create({
    data: { ...address, customerId },
    select: addressSelect,
  });
}

export function updateAddressRow(
  database: DatabaseClient,
  addressId: string,
  changes: Partial<AddressWrite>,
): Promise<AddressRow> {
  return database.customerAddress.update({
    where: { id: addressId },
    data: changes,
    select: addressSelect,
  });
}

export async function markAddressDefault(
  database: DatabaseClient,
  addressId: string,
): Promise<void> {
  await database.customerAddress.update({
    where: { id: addressId },
    data: { isDefault: true },
    select: { id: true },
  });
}

export async function archiveAddressRow(
  database: DatabaseClient,
  addressId: string,
): Promise<void> {
  await database.customerAddress.update({
    where: { id: addressId },
    data: { archivedAt: new Date(), isDefault: false },
    select: { id: true },
  });
}

export function findNewestActiveAddress(
  database: DatabaseClient,
  customerId: string,
): Promise<{ id: string } | null> {
  return database.customerAddress.findFirst({
    where: { customerId, archivedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
}
