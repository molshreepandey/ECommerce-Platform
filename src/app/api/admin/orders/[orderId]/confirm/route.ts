import { apiHandler } from '@/lib/api-handler';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { confirmOrder } from '@/modules/ordering/order-lifecycle.service';

import { orderIdFrom } from '../../order-id';

export const POST = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }, requestContext) => {
    const staff = await requirePermission(request, 'orders.write');
    await confirmOrder(
      staff,
      await orderIdFrom(routeContext),
      requestMetadata(request, requestContext),
    );
    return new Response(null, { status: 204 });
  },
);
