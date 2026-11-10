import { getDatabase } from '@/lib/db';
import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { recordAuditEvent } from '@/modules/audit/audit.service';

import type { RequestMetadata, StaffContext } from './access-control';
import { refusedDemoCredentialField } from './demo-credentials';
import { InvalidCredentialsError, UnauthenticatedError } from './identity.errors';
import type { LoginInput } from './identity.schema';
import { verifyAgainstDummyHash, verifyPassword } from './password-hasher';
import type { PermissionCode } from './permissions';
import { type StartedSession, startSession } from './session.service';
import {
  findStaffCredentialsByEmail,
  findStaffProfile,
  recordStaffLogin,
} from './staff-account.repository';

type StaffLoginFailureReason =
  'UNKNOWN_EMAIL' | 'WRONG_PASSWORD' | 'ACCOUNT_DEACTIVATED' | 'DEMO_CREDENTIAL_REFUSED';

async function auditFailedStaffLogin(
  input: LoginInput,
  failure: { reason: StaffLoginFailureReason; staffUserId: string | null },
  metadata: RequestMetadata,
): Promise<void> {
  await recordAuditEvent(getDatabase(), {
    actorType: 'SYSTEM',
    actorId: null,
    action: 'staff.login_failed',
    entityType: 'staff_user',
    entityId: failure.staffUserId ?? 'unknown',
    after: { email: input.email, reason: failure.reason },
    ipAddress: metadata.clientIp,
    requestId: metadata.requestId,
  });
}

export async function loginStaff(
  input: LoginInput,
  metadata: RequestMetadata,
): Promise<{ staffUserId: string; session: StartedSession }> {
  await enforceRateLimit({
    action: 'staff-login',
    identifier: `${metadata.clientIp ?? 'unknown-client'}|${input.email}`,
  });
  const account = await findStaffCredentialsByEmail(getDatabase(), input.email);
  if (refusedDemoCredentialField(input) !== null) {
    await verifyAgainstDummyHash(input.password);
    await auditFailedStaffLogin(
      input,
      { reason: 'DEMO_CREDENTIAL_REFUSED', staffUserId: account?.id ?? null },
      metadata,
    );
    throw new InvalidCredentialsError();
  }
  if (account === null) {
    await verifyAgainstDummyHash(input.password);
    await auditFailedStaffLogin(input, { reason: 'UNKNOWN_EMAIL', staffUserId: null }, metadata);
    throw new InvalidCredentialsError();
  }
  const passwordMatches = await verifyPassword(account.passwordHash, input.password);
  if (!passwordMatches || account.status !== 'ACTIVE') {
    const reason = passwordMatches ? 'ACCOUNT_DEACTIVATED' : 'WRONG_PASSWORD';
    await auditFailedStaffLogin(input, { reason, staffUserId: account.id }, metadata);
    throw new InvalidCredentialsError();
  }
  const session = await getDatabase().$transaction(async (transaction) => {
    await recordStaffLogin(transaction, account.id);
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: account.id,
      action: 'staff.login_succeeded',
      entityType: 'staff_user',
      entityId: account.id,
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
    return startSession(transaction, { subjectType: 'STAFF', subjectId: account.id });
  });
  return { staffUserId: account.id, session };
}

export async function getStaffProfile(staff: StaffContext): Promise<{
  id: string;
  fullName: string;
  email: string;
  roles: { code: string; name: string }[];
  permissionCodes: PermissionCode[];
}> {
  const profile = await findStaffProfile(getDatabase(), staff.staffUserId);
  if (profile === null) throw new UnauthenticatedError();
  return {
    id: profile.id,
    fullName: profile.fullName,
    email: profile.email,
    roles: profile.roles.map(({ role }) => role),
    permissionCodes: [...staff.permissionCodes].sort(),
  };
}
