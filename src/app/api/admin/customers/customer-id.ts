import { z } from 'zod';

import { DomainError } from '@/lib/errors';

export async function customerIdFrom(routeContext: {
  params: Promise<{ customerId: string }>;
}): Promise<string> {
  const parsed = z.uuid().safeParse((await routeContext.params).customerId);
  if (!parsed.success) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'CUSTOMER_NOT_FOUND',
      message: 'This customer was not found.',
    });
  }
  return parsed.data.toLowerCase();
}
