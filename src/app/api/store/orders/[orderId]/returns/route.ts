import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { createReturnSchema } from '@/modules/returns/returns.schema';
import { getReturnOverview, requestReturn } from '@/modules/returns/returns.service';

import { orderIdFrom } from '../../order-id';

type RouteContext = { params: Promise<{ orderId: string }> };

export const GET = apiHandler(async (request, routeContext: RouteContext) => {
  const customer = await requireCustomer(request);
  return Response.json(await getReturnOverview(customer, await orderIdFrom(routeContext)));
});

// C37: 201; 422 RETURN_WINDOW_CLOSED, RETURN_NOT_DELIVERED, RETURN_QUANTITY_EXCEEDED, EXCHANGE_VARIANT_INVALID.
export const POST = apiHandler(async (request, routeContext: RouteContext, requestContext) => {
  const customer = await requireCustomer(request);
  const orderId = await orderIdFrom(routeContext);
  const input = await parseJsonBody(request, createReturnSchema);
  const returnRequest = await requestReturn(
    customer,
    orderId,
    input,
    requestMetadata(request, requestContext),
  );
  return Response.json({ returnRequest }, { status: 201 });
});
