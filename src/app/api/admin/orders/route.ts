import { after } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { listStaffOrders, staffOrderListSchema } from '@/modules/ordering/order-query.service';
import { expireUnpaidOnlineOrders } from '@/modules/payment/payment.service';

export const GET = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'orders.read');
  const query = staffOrderListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  after(() => expireUnpaidOnlineOrders({ requestId: requestContext.requestId }));
  return Response.json(await listStaffOrders(staff, query));
});
