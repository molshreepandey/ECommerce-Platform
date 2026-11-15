import type { Prisma } from '@/generated/prisma/client';
import type { CustomerStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export interface CustomerListFilters {
  search: string | null;
  status: CustomerStatus | null;
  cursor: { createdAt: Date; id: string } | null;
  limit: number;
}

// Exact email or phone use their unique indexes; a name search is a contains match (small table).
function searchCondition(search: string | null): Prisma.CustomerWhereInput {
  if (search === null) return {};
  return {
    OR: [
      { email: search.toLowerCase() },
      { phone: search },
      { fullName: { contains: search, mode: 'insensitive' } },
    ],
  };
}

export function listCustomerRows(database: DatabaseClient, filters: CustomerListFilters) {
  return database.customer.findMany({
    where: {
      ...searchCondition(filters.search),
      ...(filters.status === null ? {} : { status: filters.status }),
      ...(filters.cursor === null
        ? {}
        : {
            AND: [
              {
                OR: [
                  { createdAt: { lt: filters.cursor.createdAt } },
                  { createdAt: filters.cursor.createdAt, id: { lt: filters.cursor.id } },
                ],
              },
            ],
          }),
    },
    select: { id: true, fullName: true, email: true, phone: true, status: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filters.limit + 1,
  });
}

export function findCustomerCursor(database: DatabaseClient, customerId: string) {
  return database.customer.findUnique({
    where: { id: customerId },
    select: { id: true, createdAt: true },
  });
}

export function findCustomerDetailRow(database: DatabaseClient, customerId: string) {
  return database.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      status: true,
      blockedAt: true,
      createdAt: true,
      addresses: {
        where: { archivedAt: null },
        select: {
          id: true,
          recipientName: true,
          addressLine1: true,
          city: true,
          state: true,
          pincode: true,
          isDefault: true,
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });
}

export async function setCustomerStatusIfCurrent(
  database: DatabaseClient,
  customerId: string,
  from: CustomerStatus,
  to: CustomerStatus,
): Promise<boolean> {
  const { count } = await database.customer.updateMany({
    where: { id: customerId, status: from },
    data: { status: to, blockedAt: to === 'BLOCKED' ? new Date() : null },
  });
  return count === 1;
}
