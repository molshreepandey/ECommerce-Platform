import { NextResponse } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { setSessionCookie } from '@/lib/session-cookie';
import { requestMetadata } from '@/modules/identity/access-control';
import { loginSchema } from '@/modules/identity/identity.schema';
import { loginStaff } from '@/modules/identity/staff-account.service';

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const input = await parseJsonBody(request, loginSchema);
  const { staffUserId, session } = await loginStaff(
    input,
    requestMetadata(request, requestContext),
  );
  const response = NextResponse.json({ staffUser: { id: staffUserId } });
  setSessionCookie(response, 'admin', session);
  return response;
});
