import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { getStaffOrderNotifications } from '@/modules/notifications/notification-query.service';

import { orderIdFrom } from '../../order-id';

// C38: the simulated customer messages of an order (orders.read).
export const GET = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }) => {
    const staff = await requirePermission(request, 'orders.read');
    return Response.json({
      notifications: await getStaffOrderNotifications(staff, await orderIdFrom(routeContext)),
    });
  },
);
