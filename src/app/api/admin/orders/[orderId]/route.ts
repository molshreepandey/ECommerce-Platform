import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { getStaffOrder } from '@/modules/ordering/order-query.service';

import { orderIdFrom } from '../order-id';

export const GET = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }) => {
    const staff = await requirePermission(request, 'orders.read');
    return Response.json(await getStaffOrder(staff, await orderIdFrom(routeContext)));
  },
);
