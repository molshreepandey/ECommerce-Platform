import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { cancelOrderSchema } from '@/modules/ordering/order-actions.schema';
import { cancelOrderByStaff } from '@/modules/ordering/order-lifecycle.service';

import { orderIdFrom } from '../../order-id';

export const POST = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }, requestContext) => {
    const staff = await requirePermission(request, 'orders.write');
    const orderId = await orderIdFrom(routeContext);
    const { reason } = await parseJsonBody(request, cancelOrderSchema);
    await cancelOrderByStaff(staff, orderId, reason, requestMetadata(request, requestContext));
    return new Response(null, { status: 204 });
  },
);
