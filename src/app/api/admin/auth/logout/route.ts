import { NextResponse } from 'next/server';

import { apiHandler } from '@/lib/api-handler';
import { clearSessionCookie, readSessionToken } from '@/lib/session-cookie';
import { endSession } from '@/modules/identity/session.service';

export const POST = apiHandler(async (request) => {
  const sessionToken = readSessionToken(request, 'admin');
  if (sessionToken !== null) await endSession(sessionToken);
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response, 'admin');
  return response;
});
