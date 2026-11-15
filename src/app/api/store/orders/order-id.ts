import { z } from 'zod';

import { orderingErrors } from '@/modules/ordering/ordering.errors';

export async function orderIdFrom(routeContext: {
  params: Promise<{ orderId: string }>;
}): Promise<string> {
  const parsed = z.uuid().safeParse((await routeContext.params).orderId);
  if (!parsed.success) throw orderingErrors.orderNotFound();
  return parsed.data.toLowerCase();
}
