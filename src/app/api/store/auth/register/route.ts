import { NextResponse } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { setSessionCookie } from '@/lib/session-cookie';
import { mergeGuestCartAfterSignIn } from '@/modules/cart/guest-cart-merge';
import { requestMetadata } from '@/modules/identity/access-control';
import { registerCustomer } from '@/modules/identity/customer-account.service';
import { registerCustomerSchema } from '@/modules/identity/identity.schema';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const input = await parseJsonBody(request, registerCustomerSchema);
  const { customer, session } = await registerCustomer(
    input,
    requestMetadata(request, requestContext),
  );
  const response = NextResponse.json({ customer }, { status: 201 });
  setSessionCookie(response, 'store', session);
  await mergeGuestCartAfterSignIn({
    request,
    response,
    customerId: customer.id,
    logger: requestContext.logger,
  });
  return response;
});
