import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { changeCustomerStatus } from '@/modules/identity/customer-admin.service';

import { customerIdFrom } from '../../customer-id';

const statusSchema = z.strictObject({
  isBlocked: z.boolean(),
  reason: z.string().trim().min(3, 'Give a reason.').max(300),
});

// D44: block / unblock (customers.block). SUPPORT has customers.read only, so this answers 403.
export const POST = apiHandler(
  async (request, routeContext: { params: Promise<{ customerId: string }> }, requestContext) => {
    const staff = await requirePermission(request, 'customers.block');
    const customerId = await customerIdFrom(routeContext);
    const input = await parseJsonBody(request, statusSchema);
    await changeCustomerStatus(staff, customerId, input, requestMetadata(request, requestContext));
    return new Response(null, { status: 204 });
  },
);
