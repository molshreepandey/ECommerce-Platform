import { NextResponse } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { setSessionCookie } from '@/lib/session-cookie';
import { requestMetadata } from '@/modules/identity/access-control';
import { loginCustomer } from '@/modules/identity/customer-account.service';
import { loginSchema } from '@/modules/identity/identity.schema';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const input = await parseJsonBody(request, loginSchema);
  const { customerId, session } = await loginCustomer(
    input,
    requestMetadata(request, requestContext),
  );
  const response = NextResponse.json({ customer: { id: customerId } });
  setSessionCookie(response, 'store', session);
  return response;
});
