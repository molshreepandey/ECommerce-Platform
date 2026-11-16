import type { Prisma } from '@/generated/prisma/client';
import type { CustomerStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export interface CustomerListFilters {
  search: string | null;
  status: CustomerStatus | null;
  cursor: CustomerPageCursor | null;
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
                  { createdAt: { lt: filters.cursor.createdBefore } },
                  { id: { in: filters.cursor.sameMillisecondIdsAfter } },
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

// Keyset pages on (created_at DESC, id DESC). created_at has microseconds but a JS Date only
// milliseconds, so the rows inside the cursor's millisecond are compared in SQL (as for orders).
export interface CustomerPageCursor {
  createdBefore: Date;
  sameMillisecondIdsAfter: string[];
}

export async function findCustomerPageCursor(
  database: DatabaseClient,
  customerId: string,
): Promise<CustomerPageCursor | null> {
  const rows = await database.$queryRaw<{ floor: Date; id: string | null }[]>`
    SELECT date_trunc('milliseconds', c.created_at) AS floor, o.id::text AS id
    FROM customers c
    LEFT JOIN customers o
      ON o.created_at >= date_trunc('milliseconds', c.created_at)
     AND (o.created_at, o.id) < (c.created_at, c.id)
    WHERE c.id = ${customerId}::uuid`;
  const [first] = rows;
  if (first === undefined) return null;
  return {
    createdBefore: first.floor,
    sameMillisecondIdsAfter: rows.flatMap(({ id }) => (id === null ? [] : [id])),
  };
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
