import { after } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { idempotencyKeyFrom } from '@/lib/request-idempotency';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { checkoutIdempotencyKeySchema, placeOrderSchema } from '@/modules/ordering/checkout.schema';
import { placeOrder } from '@/modules/ordering/checkout.service';
import { expireUnpaidOnlineOrders } from '@/modules/payment/payment.service';

// C29: 201 for a new order, 200 when the same Idempotency-Key and request return the existing one.
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const customer = await requireCustomer(request);
  const idempotencyKey = idempotencyKeyFrom(request, checkoutIdempotencyKeySchema);
  const input = await parseJsonBody(request, placeOrderSchema);
  const placed = await placeOrder(
    customer,
    input,
    idempotencyKey,
    requestMetadata(request, requestContext),
  );
  after(() => expireUnpaidOnlineOrders({ requestId: requestContext.requestId }));
  return Response.json({ order: placed }, { status: placed.isReplay ? 200 : 201 });
});
