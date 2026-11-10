import { NextResponse } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { clearSessionCookie } from '@/lib/session-cookie';
import { requestMetadata, requireCustomer } from '@/modules/identity/access-control';
import { logoutCustomerEverywhere } from '@/modules/identity/customer-account.service';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const customer = await requireCustomer(request);
  const revokedSessionCount = await logoutCustomerEverywhere(
    customer,
    requestMetadata(request, requestContext),
  );
  const response = NextResponse.json({ revokedSessionCount });
  clearSessionCookie(response, 'store');
  return response;
});
