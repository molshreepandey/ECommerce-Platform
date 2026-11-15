import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { idempotencyKeyFrom } from '@/lib/request-idempotency';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { paymentIdempotencyKeySchema, submitPaymentSchema } from '@/modules/payment/payment.schema';
import { submitOnlinePayment } from '@/modules/payment/payment.service';

import { orderIdFrom } from '../../order-id';

// Simulated online payment: 201 for a new attempt (success or decline), 200 for a replayed one.
export const POST = apiHandler(
  async (request, routeContext: { params: Promise<{ orderId: string }> }, requestContext) => {
    const customer = await requireCustomer(request);
    const orderId = await orderIdFrom(routeContext);
    const idempotencyKey = idempotencyKeyFrom(request, paymentIdempotencyKeySchema);
    const input = await parseJsonBody(request, submitPaymentSchema);
    const attempt = await submitOnlinePayment(
      customer,
      orderId,
      input,
      idempotencyKey,
      requestMetadata(request, requestContext),
    );
    return Response.json({ attempt }, { status: attempt.isReplay ? 200 : 201 });
  },
);
