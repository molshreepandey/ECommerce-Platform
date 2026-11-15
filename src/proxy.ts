import { NextResponse, type NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';
import { classifyDynamicRoute } from '@/lib/dynamic-route-check';
import { decideHostRouting } from '@/lib/host-routing';
import { REQUEST_ID_HEADER, SURFACE_HEADER } from '@/lib/request-headers';
import { buildRuntimeSecurityHeaders } from '@/lib/security-headers';
import { sessionCookieName } from '@/lib/session-cookie';
import { signInRedirectPath } from '@/lib/sign-in-redirect';
import { isMissingStorefrontPage } from '@/modules/storefront/storefront-route-check.service';

const safeRequestIdPattern = /^[A-Za-z0-9-]{8,64}$/;
const shortCategoryLinkPattern = /^\/c\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const unknownHostContentSecurityPolicy = "default-src 'none'; frame-ancestors 'none'";

function withHeaders(response: NextResponse, headers: Record<string, string>): NextResponse {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

function notFoundResponse(pathname: string): NextResponse {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Not found', details: null } },
      { status: 404 },
    );
  }
  return new NextResponse('Not found', { status: 404 });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const { surfaces } = config;
  const { pathname } = request.nextUrl;
  const decision = decideHostRouting(
    { host: request.headers.get('host'), pathname },
    { storeHosts: surfaces.store.hosts, adminHosts: surfaces.admin.hosts },
  );

  if (decision.kind === 'not_found') {
    return withHeaders(notFoundResponse(pathname), {
      'Content-Security-Policy': unknownHostContentSecurityPolicy,
    });
  }

  const securityHeaders = buildRuntimeSecurityHeaders({
    config,
    surface: decision.surface,
    isDevelopmentServer: process.env.NODE_ENV === 'development',
  });

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
    return withHeaders(
      NextResponse.next({ request: { headers: forwardedHeaders } }),
      securityHeaders,
    );
  }

  // Short category links (/c/<slug>, used by banners the early demo data saved) go to the category page.
  const shortCategoryLink =
    decision.surface === 'store' ? shortCategoryLinkPattern.exec(pathname) : null;
  if (shortCategoryLink !== null) {
    const categoryUrl = new URL(
      `/categories/${shortCategoryLink[1] ?? ''}`,
      surfaces.store.publicOrigin,
    );
    return withHeaders(NextResponse.redirect(categoryUrl, 308), securityHeaders);
  }

  const redirectPath = signInRedirectPath({
    surface: decision.surface,
    pathname,
    search: request.nextUrl.search,
    hasSessionCookie: request.cookies.has(sessionCookieName(decision.surface)),
  });
  if (redirectPath !== null) {
    const signInUrl = new URL(redirectPath, surfaces[decision.surface].publicOrigin);
    return withHeaders(NextResponse.redirect(signInUrl, 307), securityHeaders);
  }

  const rewrittenUrl = request.nextUrl.clone();
  // A detail URL that cannot be shown is rewritten to a path no route matches, so the surface's
  // not-found page renders with a real 404 (the page itself would already have sent a 200 shell).
  rewrittenUrl.pathname = (await isMissingStorefrontPage(
    classifyDynamicRoute(decision.surface, pathname),
  ))
    ? `/${decision.surface}/__not-found`
    : decision.pathname;
  return withHeaders(
    NextResponse.rewrite(rewrittenUrl, { request: { headers: forwardedHeaders } }),
    securityHeaders,
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|__nextjs|favicon.ico).*)'],
};
