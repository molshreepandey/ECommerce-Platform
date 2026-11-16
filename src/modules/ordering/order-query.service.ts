import { z } from 'zod';

import type { OrderStatus } from '@/generated/prisma/enums';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import {
  assertStaffPermission,
  type CustomerContext,
  type StaffContext,
} from '@/modules/identity/access-control';

import {
  findOrderDetailRow,
  listCustomerOrderRows,
  listOrderAuditRows,
  listStaffOrderRows,
  type OrderDetailRow,
  findOrderPageCursor,
  type OrderPageCursor,
} from './order-query.repository';
import { orderingErrors } from './ordering.errors';

const orderStatuses = [
  'PLACED',
  'CONFIRMED',
  'PROCESSING',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'PARTIALLY_DELIVERED',
  'DELIVERED',
  'CANCELLED',
  'RTO',
] as const satisfies readonly OrderStatus[];

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const customerOrderListSchema = z.object({
  status: z.enum(orderStatuses).optional().catch(undefined),
  cursor: z.uuid().optional().catch(undefined),
});

export const staffOrderListSchema = z.object({
  q: optionalText.pipe(z.string().max(100).optional()),
  status: z.enum(orderStatuses).optional().catch(undefined),
  paymentMethod: z.enum(['COD', 'ONLINE']).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  cursor: z.uuid().optional().catch(undefined),
});

export { orderStatuses };

const customerPageSize = 10;
const staffPageSize = 25;

async function cursorFor(
  database: DatabaseClient,
  orderId: string | undefined,
): Promise<OrderPageCursor | null> {
  if (orderId === undefined) return null;
  return findOrderPageCursor(database, orderId.toLowerCase());
}

function page<Row extends { id: string }>(rows: Row[], limit: number) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

// C33: the customer's own orders, newest first, filterable by status.
export async function listCustomerOrders(
  customer: CustomerContext,
  query: z.infer<typeof customerOrderListSchema>,
) {
  const database = getDatabase();
  const rows = await listCustomerOrderRows(database, {
    customerId: customer.customerId,
    status: query.status ?? null,
    cursor: await cursorFor(database, query.cursor),
    limit: customerPageSize,
  });
  return page(rows, customerPageSize);
}

export async function getCustomerOrder(
  customer: CustomerContext,
  orderId: string,
): Promise<OrderDetailRow> {
  const order = await findOrderDetailRow(getDatabase(), orderId.toLowerCase());
  if (order === null || order.customerId !== customer.customerId)
    throw orderingErrors.orderNotFound();
  return order;
}

// IST calendar days (plan §10B): the filter's "to" day is inclusive.
function istDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:30`);
}

export async function listStaffOrders(
  staff: StaffContext,
  query: z.infer<typeof staffOrderListSchema>,
) {
  assertStaffPermission(staff, 'orders.read');
  const database = getDatabase();
  const rows = await listStaffOrderRows(database, {
    search: query.q ?? null,
    status: query.status ?? null,
    paymentMethod: query.paymentMethod ?? null,
    placedFrom: query.from === undefined ? null : istDayStart(query.from),
    placedTo:
      query.to === undefined ? null : new Date(istDayStart(query.to).getTime() + 86_400_000),
    cursor: await cursorFor(database, query.cursor),
    limit: staffPageSize,
  });
  return page(rows, staffPageSize);
}

export async function getStaffOrder(staff: StaffContext, orderId: string) {
  assertStaffPermission(staff, 'orders.read');
  const database = getDatabase();
  const order = await findOrderDetailRow(database, orderId.toLowerCase());
  if (order === null) throw orderingErrors.orderNotFound();
  const auditEntries = await listOrderAuditRows(
    database,
    order.id,
    order.shipments.map(({ id }) => id),
  );
  return { order, auditEntries };
}
