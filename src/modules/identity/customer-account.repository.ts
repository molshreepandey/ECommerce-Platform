import type { CustomerStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

const customerProfileSelect = { id: true, fullName: true, email: true, phone: true } as const;

export type CustomerProfile = { id: string; fullName: string; email: string; phone: string };

export function findCustomerCredentialsByEmail(
  database: DatabaseClient,
  email: string,
): Promise<{ id: string; passwordHash: string; status: CustomerStatus } | null> {
  return database.customer.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, status: true },
  });
}

export function insertCustomer(
  database: DatabaseClient,
  customer: { fullName: string; email: string; phone: string; passwordHash: string },
): Promise<CustomerProfile> {
  return database.customer.create({ data: customer, select: customerProfileSelect });
}

export function findCustomerProfile(
  database: DatabaseClient,
  customerId: string,
): Promise<CustomerProfile | null> {
  return database.customer.findUnique({ where: { id: customerId }, select: customerProfileSelect });
}

export function updateCustomerProfileRow(
  database: DatabaseClient,
  customerId: string,
  changes: { fullName?: string; phone?: string },
): Promise<CustomerProfile> {
  return database.customer.update({
    where: { id: customerId },
    data: changes,
    select: customerProfileSelect,
  });
}
