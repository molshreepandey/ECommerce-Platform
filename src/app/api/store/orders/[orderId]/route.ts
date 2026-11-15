import { apiHandler } from '@/lib/api-handler';
import { requireCustomer } from '@/modules/identity/access-control';
import { getCustomerOrder } from '@/modules/ordering/order-query.service';

import { orderIdFrom } from '../order-id';

export const GET = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }) => {
    const customer = await requireCustomer(request);
    return Response.json({
      order: await getCustomerOrder(customer, await orderIdFrom(routeContext)),
    });
  },
);
