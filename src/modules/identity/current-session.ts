import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { DomainError } from '@/lib/errors';
import type { Surface } from '@/lib/host-routing';
import { sessionCookieName } from '@/lib/session-cookie';

import {
  type CustomerContext,
  customerFromSessionToken,
  optionalCustomerFromSessionToken,
  type StaffContext,
  staffFromSessionToken,
} from './access-control';

async function sessionTokenFromCookies(surface: Surface): Promise<string | null> {
  return (await cookies()).get(sessionCookieName(surface))?.value ?? null;
}

function signInLocation(nextPath: string): string {
  return nextPath === '/' ? '/login' : `/login?next=${encodeURIComponent(nextPath)}`;
}

// For Server Components behind a <Suspense> boundary: an invalid or expired session redirects to sign-in.
export async function currentCustomerOrRedirect(nextPath: string): Promise<CustomerContext> {
  try {
    return await customerFromSessionToken(await sessionTokenFromCookies('store'));
  } catch (error) {
    if (error instanceof DomainError) redirect(signInLocation(nextPath));
    throw error;
  }
}

export async function currentStaffOrRedirect(nextPath: string): Promise<StaffContext> {
  try {
    return await staffFromSessionToken(await sessionTokenFromCookies('admin'));
  } catch (error) {
    if (error instanceof DomainError) redirect(signInLocation(nextPath));
    throw error;
  }
}

export async function currentCustomerOrGuest(): Promise<CustomerContext | null> {
  return optionalCustomerFromSessionToken(await sessionTokenFromCookies('store'));
}
