import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { cancelOrderSchema } from '@/modules/ordering/order-actions.schema';
import { cancelOrderByCustomer } from '@/modules/ordering/order-lifecycle.service';

import { orderIdFrom } from '../../order-id';

// C34: cancel before dispatch, reason required.
export const POST = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }, requestContext) => {
    const customer = await requireCustomer(request);
    const orderId = await orderIdFrom(routeContext);
    const { reason } = await parseJsonBody(request, cancelOrderSchema);
    await cancelOrderByCustomer(
      customer,
      orderId,
      reason,
      requestMetadata(request, requestContext),
    );
    return new Response(null, { status: 204 });
  },
);
