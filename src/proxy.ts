import { NextResponse, type NextRequest } from 'next/server';

import { getEnvironment } from '@/lib/env';
import { decideHostRouting } from '@/lib/host-routing';
import { REQUEST_ID_HEADER, SURFACE_HEADER } from '@/lib/request-headers';

const safeRequestIdPattern = /^[A-Za-z0-9-]{8,64}$/;

function notFoundResponse(pathname: string): NextResponse {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Not found', details: null } },
      { status: 404 },
    );
  }
  return new NextResponse('Not found', { status: 404 });
}

export function proxy(request: NextRequest): NextResponse {
  const environment = getEnvironment();
  const { pathname } = request.nextUrl;
  const decision = decideHostRouting(
    { host: request.headers.get('host'), pathname },
    { storeHosts: environment.STORE_HOSTS, adminHosts: environment.ADMIN_HOSTS },
  );

  if (decision.kind === 'not_found') return notFoundResponse(pathname);

  const incomingRequestId = request.headers.get(REQUEST_ID_HEADER);
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(
    REQUEST_ID_HEADER,
    incomingRequestId !== null && safeRequestIdPattern.test(incomingRequestId)
      ? incomingRequestId
      : crypto.randomUUID(),
  );
  forwardedHeaders.set(SURFACE_HEADER, decision.surface);

  if (decision.kind === 'continue') {
    return NextResponse.next({ request: { headers: forwardedHeaders } });
  }

  const rewrittenUrl = request.nextUrl.clone();
  rewrittenUrl.pathname = decision.pathname;
  return NextResponse.rewrite(rewrittenUrl, { request: { headers: forwardedHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|__nextjs|favicon.ico).*)'],
};
