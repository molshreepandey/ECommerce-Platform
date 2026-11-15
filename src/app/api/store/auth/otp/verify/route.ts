import { NextResponse } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { setSessionCookie } from '@/lib/session-cookie';
import { mergeGuestCartAfterSignIn } from '@/modules/cart/guest-cart-merge';
import { requestMetadata } from '@/modules/identity/access-control';
import { verifyLoginOtp, verifyOtpSchema } from '@/modules/identity/otp-login.service';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const input = await parseJsonBody(request, verifyOtpSchema);
  const { customerId, session } = await verifyLoginOtp(
    input,
    requestMetadata(request, requestContext),
  );
  const response = NextResponse.json({ customer: { id: customerId } });
  setSessionCookie(response, 'store', session);
  await mergeGuestCartAfterSignIn({ request, response, customerId, logger: requestContext.logger });
  return response;
});
