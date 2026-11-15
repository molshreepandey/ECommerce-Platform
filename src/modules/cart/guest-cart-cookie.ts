import type { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

import { type GuestCartLine, parseGuestCart, serializeGuestCart } from './guest-cart';

const guestCartMaxAgeSeconds = 30 * 24 * 60 * 60;

export function guestCartCookieName(): string {
  return getConfig().authentication.secureCookies ? '__Host-store_guest_cart' : 'store_guest_cart';
}

export function readGuestCart(request: NextRequest): GuestCartLine[] {
  return parseGuestCart(request.cookies.get(guestCartCookieName())?.value);
}

export function writeGuestCart(response: NextResponse, lines: readonly GuestCartLine[]): void {
  if (lines.length === 0) {
    clearGuestCart(response);
    return;
  }
  response.cookies.set({
    name: guestCartCookieName(),
    value: serializeGuestCart(lines),
    httpOnly: true,
    sameSite: 'lax',
    secure: getConfig().authentication.secureCookies,
    path: '/',
    maxAge: guestCartMaxAgeSeconds,
  });
}

export function clearGuestCart(response: NextResponse): void {
  response.cookies.set({
    name: guestCartCookieName(),
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: getConfig().authentication.secureCookies,
    path: '/',
    maxAge: 0,
  });
}
