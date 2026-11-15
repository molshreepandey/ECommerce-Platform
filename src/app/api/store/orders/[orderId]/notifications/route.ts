import { apiHandler } from '@/lib/api-handler';
import { requireCustomer } from '@/modules/identity/access-control';
import { getCustomerOrderNotifications } from '@/modules/notifications/notification-query.service';

import { orderIdFrom } from '../../order-id';

// C38: the simulated messages sent for this order (placed, shipped, delivered); 404 for another's order.
export const GET = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }) => {
    const customer = await requireCustomer(request);
    return Response.json({
      notifications: await getCustomerOrderNotifications(customer, await orderIdFrom(routeContext)),
    });
  },
);
