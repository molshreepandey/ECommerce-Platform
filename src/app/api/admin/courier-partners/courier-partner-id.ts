import { z } from 'zod';

import { DomainError } from '@/lib/errors';

export async function courierPartnerIdFrom(routeContext: {
  params: Promise<{ courierPartnerId: string }>;
}): Promise<string> {
  const parsed = z.uuid().safeParse((await routeContext.params).courierPartnerId);
  if (!parsed.success) {
    throw new DomainError({
      kind: 'NOT_FOUND',
      code: 'COURIER_NOT_FOUND',
      message: 'This courier was not found.',
    });
  }
  return parsed.data.toLowerCase();
}
