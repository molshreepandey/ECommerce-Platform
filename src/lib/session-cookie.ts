import type { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import type { Surface } from '@/lib/host-routing';

const cookieBaseNames: Record<Surface, string> = {
  store: 'store_session',
  admin: 'admin_session',
};

// The __Host- prefix makes browsers insist on Secure, Path=/ and no Domain, so it is only used with HTTPS.
export function sessionCookieName(surface: Surface): string {
  const baseName = cookieBaseNames[surface];
  return getConfig().authentication.secureCookies ? `__Host-${baseName}` : baseName;
}

export function readSessionToken(request: NextRequest, surface: Surface): string | null {
  return request.cookies.get(sessionCookieName(surface))?.value ?? null;
}

export function setSessionCookie(
  response: NextResponse,
  surface: Surface,
  session: { sessionToken: string; expiresAt: Date },
): void {
  response.cookies.set({
    name: sessionCookieName(surface),
    value: session.sessionToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: getConfig().authentication.secureCookies,
    path: '/',
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse, surface: Surface): void {
  response.cookies.set({
    name: sessionCookieName(surface),
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: getConfig().authentication.secureCookies,
    path: '/',
    maxAge: 0,
  });
}
