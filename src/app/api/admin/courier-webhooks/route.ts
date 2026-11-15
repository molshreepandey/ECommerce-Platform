import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { listWebhookReceipts } from '@/modules/fulfilment/courier-admin.service';

const querySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional().catch(undefined),
});

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'orders.read');
  const { before } = querySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return Response.json({
    receipts: await listWebhookReceipts(staff, before === undefined ? null : new Date(before)),
  });
});
