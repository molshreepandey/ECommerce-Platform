import type { NextRequest } from 'next/server';

import type { RequestContext } from '@/lib/api-handler';
import { clientIpAddress } from '@/lib/client-ip';
import { getConfig } from '@/lib/config';
import { getDatabase } from '@/lib/db';
import { type CustomerId, customerIdSchema, type StaffUserId, staffUserIdSchema } from '@/lib/ids';
import { readSessionToken } from '@/lib/session-cookie';

import {
  PermissionDeniedError,
  UnauthenticatedError,
  WrongAccountTypeError,
} from './identity.errors';
import { isPermissionCode, type PermissionCode } from './permissions';
import { findPermissionCodesForStaff } from './session.repository';
import { findActiveSession } from './session.service';

export interface RequestMetadata {
  requestId: string;
  clientIp: string | null;
}

export interface CustomerContext {
  customerId: CustomerId;
  sessionId: string;
}

export interface StaffContext {
  staffUserId: StaffUserId;
  sessionId: string;
  permissionCodes: ReadonlySet<PermissionCode>;
}

export function requestMetadata(
  request: NextRequest,
  requestContext: RequestContext,
): RequestMetadata {
  return {
    requestId: requestContext.requestId,
    clientIp: clientIpAddress(request.headers, getConfig().authentication.trustedProxyHopCount),
  };
}

async function resolveActiveSession(sessionToken: string | null) {
  if (sessionToken === null) throw new UnauthenticatedError();
  const session = await findActiveSession(sessionToken);
  if (session === null || !session.subject_is_active) throw new UnauthenticatedError();
  return session;
}

// Token-based versions serve Server Components, which read cookies() instead of a NextRequest.
export async function customerFromSessionToken(
  sessionToken: string | null,
): Promise<CustomerContext> {
  const session = await resolveActiveSession(sessionToken);
  if (session.subject_type !== 'CUSTOMER') throw new WrongAccountTypeError();
  return { customerId: customerIdSchema.parse(session.subject_id), sessionId: session.session_id };
}

export async function staffFromSessionToken(sessionToken: string | null): Promise<StaffContext> {
  const session = await resolveActiveSession(sessionToken);
  if (session.subject_type !== 'STAFF') throw new WrongAccountTypeError();
  const staffUserId = staffUserIdSchema.parse(session.subject_id);
  const permissionCodes = await findPermissionCodesForStaff(getDatabase(), staffUserId);
  return {
    staffUserId,
    sessionId: session.session_id,
    permissionCodes: new Set(permissionCodes.filter(isPermissionCode)),
  };
}

export function requireCustomer(request: NextRequest): Promise<CustomerContext> {
  return customerFromSessionToken(readSessionToken(request, 'store'));
}

export function requireStaff(request: NextRequest): Promise<StaffContext> {
  return staffFromSessionToken(readSessionToken(request, 'admin'));
}

export async function requirePermission(
  request: NextRequest,
  permissionCode: PermissionCode,
): Promise<StaffContext> {
  const staff = await requireStaff(request);
  assertStaffPermission(staff, permissionCode);
  return staff;
}

// Services call this too, so a route handler that forgets requirePermission still cannot bypass RBAC.
export function assertStaffPermission(staff: StaffContext, permissionCode: PermissionCode): void {
  if (!staff.permissionCodes.has(permissionCode)) throw new PermissionDeniedError(permissionCode);
}

// Store routes and pages that also serve guests (the cart): a missing, expired or revoked session is a guest.
export async function optionalCustomerFromSessionToken(
  sessionToken: string | null,
): Promise<CustomerContext | null> {
  if (sessionToken === null) return null;
  try {
    return await customerFromSessionToken(sessionToken);
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof WrongAccountTypeError)
      return null;
    throw error;
  }
}

export function optionalCustomer(request: NextRequest): Promise<CustomerContext | null> {
  return optionalCustomerFromSessionToken(readSessionToken(request, 'store'));
}
