import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  customerOrderStats,
  recentCustomerOrders,
} from '@/modules/ordering/order-history.repository';

import { assertStaffPermission, type RequestMetadata, type StaffContext } from './access-control';
import {
  findCustomerCursor,
  findCustomerPageCursor,
  findCustomerDetailRow,
  listCustomerRows,
  setCustomerStatusIfCurrent,
} from './customer-admin.repository';
import { revokeAllSessionsForSubject } from './session.repository';

export const customerListSchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value === '' ? undefined : value))
    .optional()
    .catch(undefined),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional().catch(undefined),
  cursor: z.uuid().optional().catch(undefined),
});

const pageSize = 25;

const customerNotFound = () =>
  new DomainError({
    kind: 'NOT_FOUND',
    code: 'CUSTOMER_NOT_FOUND',
    message: 'This customer was not found.',
  });

export async function listCustomers(
  staff: StaffContext,
  query: z.infer<typeof customerListSchema>,
) {
  assertStaffPermission(staff, 'customers.read');
  const database = getDatabase();
  const cursor =
    query.cursor === undefined
      ? null
      : await findCustomerPageCursor(database, query.cursor.toLowerCase());
  const rows = await listCustomerRows(database, {
    search: query.q ?? null,
    status: query.status ?? null,
    cursor,
    limit: pageSize,
  });
  const items = rows.slice(0, pageSize);
  return { items, nextCursor: rows.length > pageSize ? (items.at(-1)?.id ?? null) : null };
}

// D44: profile, addresses, order totals (lifetime value excludes cancelled and RTO orders), RTO count.
export async function getCustomerDetail(staff: StaffContext, customerId: string) {
  assertStaffPermission(staff, 'customers.read');
  const database = getDatabase();
  const customer = await findCustomerDetailRow(database, customerId);
  if (customer === null) throw customerNotFound();
  const [stats, recentOrders] = await Promise.all([
    customerOrderStats(database, customerId),
    recentCustomerOrders(database, customerId, 10),
  ]);
  return { customer, stats, recentOrders };
}

// Blocking revokes every session in the same transaction, so the customer is signed out at once and can
// neither sign in nor check out (plan Wave 10); unblocking lets them sign in again.
export async function changeCustomerStatus(
  staff: StaffContext,
  customerId: string,
  block: { isBlocked: boolean; reason: string },
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'customers.block');
  const [from, to] = block.isBlocked
    ? (['ACTIVE', 'BLOCKED'] as const)
    : (['BLOCKED', 'ACTIVE'] as const);
  await getDatabase().$transaction(async (transaction) => {
    if (!(await setCustomerStatusIfCurrent(transaction, customerId, from, to))) {
      const exists = await findCustomerCursor(transaction, customerId);
      if (exists === null) throw customerNotFound();
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'CUSTOMER_STATUS_UNCHANGED',
        message: block.isBlocked
          ? 'This customer is already blocked.'
          : 'This customer is not blocked.',
      });
    }
    if (block.isBlocked) {
      await revokeAllSessionsForSubject(transaction, {
        subjectType: 'CUSTOMER',
        subjectId: customerId,
      });
    }
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: block.isBlocked ? 'customer.blocked' : 'customer.unblocked',
      entityType: 'customer',
      entityId: customerId,
      before: { status: from },
      after: { status: to, reason: block.reason },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
  });
}
