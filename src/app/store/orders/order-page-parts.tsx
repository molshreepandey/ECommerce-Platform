import { notFound } from 'next/navigation';
import { z } from 'zod';
import { isNotFoundError } from '@/lib/errors';
import type { CustomerContext } from '@/modules/identity/access-control';
import { getCustomerOrder } from '@/modules/ordering/order-query.service';

export async function loadCustomerOrderOrNotFound(customer: CustomerContext, orderId: string) {
  if (!z.uuid().safeParse(orderId).success) notFound();
  try {
    return await getCustomerOrder(customer, orderId);
  } catch (error) {
    if (isNotFoundError(error)) notFound();
    throw error;
  }
}

export { ShippingAddressCard } from '@/components/organisms/OrderViews';
