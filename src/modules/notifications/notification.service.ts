import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';
import { formatPaise } from '@/lib/money';
import { recordAuditEvent } from '@/modules/audit/audit.service';

// C38 (Wave 16): simulated customer messages for order placed, shipped and delivered. Nothing is sent;
// each message is recorded as a `notification.sent` row of the append-only audit log in the same
// transaction as the event, so a message exists exactly when its event committed. (A dedicated table
// would need a migration; TD-030.)
export type NotificationEvent = 'ORDER_PLACED' | 'SHIPMENT_SHIPPED' | 'SHIPMENT_DELIVERED';

export interface OrderForNotification {
  id: string;
  orderNumber: string;
  paymentMethod: 'COD' | 'ONLINE';
  totalPaise: number;
  shippingPhone: string | null;
}

// Only the last four digits are kept, so the log never stores a full phone number.
export function maskedPhone(phone: string | null): string {
  if (phone === null || phone.length < 4) return 'unknown';
  return `••••••${phone.slice(-4)}`;
}

export function notificationMessage(
  event: NotificationEvent,
  order: OrderForNotification,
  awbNumber: string | null,
): string {
  switch (event) {
    case 'ORDER_PLACED':
      return `We have received your order ${order.orderNumber}. Total ${formatPaise(order.totalPaise)}, ${
        order.paymentMethod === 'COD' ? 'to pay on delivery' : 'paid online'
      }.`;
    case 'SHIPMENT_SHIPPED':
      return `Part of your order ${order.orderNumber} has shipped${
        awbNumber === null ? '' : ` (AWB ${awbNumber})`
      }. Track it in My Orders.`;
    case 'SHIPMENT_DELIVERED':
      return `A package of your order ${order.orderNumber}${
        awbNumber === null ? '' : ` (AWB ${awbNumber})`
      } has been delivered.`;
  }
}

export async function recordOrderNotification(
  transaction: DatabaseClient,
  input: { event: NotificationEvent; order: OrderForNotification; awbNumber?: string | null },
): Promise<void> {
  await recordAuditEvent(transaction, {
    actorType: 'SYSTEM',
    actorId: null,
    action: 'notification.sent',
    entityType: 'order',
    entityId: input.order.id,
    after: {
      event: input.event,
      channel: 'SMS (simulated)',
      recipient: maskedPhone(input.order.shippingPhone),
      message: notificationMessage(input.event, input.order, input.awbNumber ?? null),
    },
    ipAddress: null,
    requestId: null,
  });
}

const notificationDataSchema = z.object({
  event: z.enum(['ORDER_PLACED', 'SHIPMENT_SHIPPED', 'SHIPMENT_DELIVERED']),
  channel: z.string(),
  recipient: z.string(),
  message: z.string(),
});

export interface OrderNotification {
  id: string;
  sentAt: Date;
  event: NotificationEvent;
  channel: string;
  recipient: string;
  message: string;
}

// Oldest first, on audit_logs(entity_type, entity_id, created_at).
export async function listOrderNotifications(
  database: DatabaseClient,
  orderId: string,
): Promise<OrderNotification[]> {
  const rows = await database.auditLog.findMany({
    where: { entityType: 'order', entityId: orderId, action: 'notification.sent' },
    select: { id: true, createdAt: true, after: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  return rows.flatMap((row) => {
    const data = notificationDataSchema.safeParse(row.after);
    return data.success ? [{ id: row.id, sentAt: row.createdAt, ...data.data }] : [];
  });
}
