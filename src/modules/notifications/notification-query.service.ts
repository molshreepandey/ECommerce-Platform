import { getDatabase } from '@/lib/db';
import {
  assertStaffPermission,
  type CustomerContext,
  type StaffContext,
} from '@/modules/identity/access-control';
import { findCustomerOrderNumber } from '@/modules/ordering/order-query.repository';
import { orderingErrors } from '@/modules/ordering/ordering.errors';

import { listOrderNotifications, type OrderNotification } from './notification.service';

// C38: a customer sees the messages of their own orders only (someone else's order is 404).
export async function getCustomerOrderNotifications(
  customer: CustomerContext,
  orderId: string,
): Promise<OrderNotification[]> {
  const database = getDatabase();
  const order = await findCustomerOrderNumber(database, orderId);
  if (order === null || order.customerId !== customer.customerId) {
    throw orderingErrors.orderNotFound();
  }
  return listOrderNotifications(database, orderId);
}

export async function getStaffOrderNotifications(
  staff: StaffContext,
  orderId: string,
): Promise<OrderNotification[]> {
  assertStaffPermission(staff, 'orders.read');
  const database = getDatabase();
  if ((await findCustomerOrderNumber(database, orderId)) === null) {
    throw orderingErrors.orderNotFound();
  }
  return listOrderNotifications(database, orderId);
}
