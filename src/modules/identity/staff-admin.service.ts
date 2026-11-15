import { getDatabase, isUniqueViolation } from '@/lib/db';
import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';

import { assertStaffPermission, type RequestMetadata, type StaffContext } from './access-control';
import { ReservedDemoCredentialError, refusedDemoCredentialField } from './demo-credentials';
import { hashPassword } from './password-hasher';
import {
  countOtherActiveSuperAdmins,
  findRolesByCodes,
  findStaffForChange,
  insertStaffUser,
  listRoleRows,
  listStaffRows,
  lockStaffManagement,
  replaceStaffRoles,
  setStaffStatus,
  superAdminRoleCode,
} from './staff-admin.repository';
import type {
  ChangeStaffRolesInput,
  ChangeStaffStatusInput,
  CreateStaffInput,
} from './staff-admin.schema';
import { revokeAllSessionsForSubject } from './session.repository';
import type { DatabaseClient } from '@/lib/db';

const staffErrors = {
  notFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'STAFF_NOT_FOUND',
      message: 'This staff member was not found.',
    }),
  emailTaken: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'STAFF_EMAIL_TAKEN',
      message: 'A staff member with this email already exists.',
    }),
  unknownRoles: (roleCodes: readonly string[]) =>
    new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'ROLE_NOT_FOUND',
      message: 'Choose roles that exist.',
      details: { roleCodes },
    }),
  ownAccount: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'OWN_ACCOUNT',
      message: 'You cannot change your own roles or status. Ask another super admin.',
    }),
  lastSuperAdmin: () =>
    new DomainError({
      kind: 'CONFLICT',
      code: 'LAST_SUPER_ADMIN',
      message: 'At least one active super admin must remain.',
    }),
};

export function listStaffMembers(staff: StaffContext) {
  assertStaffPermission(staff, 'staff.manage');
  return listStaffRows(getDatabase());
}

export function listRoles(staff: StaffContext) {
  assertStaffPermission(staff, 'staff.manage');
  return listRoleRows(getDatabase());
}

async function roleIdsFor(database: DatabaseClient, roleCodes: readonly string[]) {
  const roles = await findRolesByCodes(database, roleCodes);
  const found = new Set(roles.map(({ code }) => code));
  const unknown = roleCodes.filter((code) => !found.has(code));
  if (unknown.length > 0) throw staffErrors.unknownRoles(unknown);
  return roles.map(({ id }) => id);
}

// D3: a super admin creates a staff account with its roles; the demo email domain and the public demo
// password are refused outside development and test, exactly as sign-in refuses them.
export async function createStaffMember(
  staff: StaffContext,
  input: CreateStaffInput,
  metadata: RequestMetadata,
): Promise<{ id: string }> {
  assertStaffPermission(staff, 'staff.manage');
  // L74: password hashing is deliberately slow, so staff writes have their own budget per super admin.
  await enforceRateLimit({ action: 'staff-write', identifier: staff.staffUserId });
  const reserved = refusedDemoCredentialField(input);
  if (reserved !== null) throw new ReservedDemoCredentialError(reserved);
  const passwordHash = await hashPassword(input.password);
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const roleIds = await roleIdsFor(transaction, input.roleCodes);
      const created = await insertStaffUser(transaction, {
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        roleIds,
      });
      await recordAuditEvent(transaction, {
        actorType: 'STAFF',
        actorId: staff.staffUserId,
        action: 'staff.created',
        entityType: 'staff_user',
        entityId: created.id,
        after: {
          email: input.email,
          fullName: input.fullName,
          roleCodes: input.roleCodes.join(','),
        },
        ipAddress: metadata.clientIp,
        requestId: metadata.requestId,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw staffErrors.emailTaken();
    throw error;
  }
}

// Role and status changes share these rules: never on one's own account, and never leaving the store
// without an active super admin (checked under one advisory lock).
async function lockTarget(transaction: DatabaseClient, staff: StaffContext, staffUserId: string) {
  if (staffUserId === staff.staffUserId) throw staffErrors.ownAccount();
  await lockStaffManagement(transaction);
  const target = await findStaffForChange(transaction, staffUserId);
  if (target === null) throw staffErrors.notFound();
  return { ...target, roleCodes: target.roles.map(({ role }) => role.code).sort() };
}

async function assertSuperAdminRemains(transaction: DatabaseClient, staffUserId: string) {
  if ((await countOtherActiveSuperAdmins(transaction, staffUserId)) === 0) {
    throw staffErrors.lastSuperAdmin();
  }
}

export async function changeStaffRoles(
  staff: StaffContext,
  staffUserId: string,
  input: ChangeStaffRolesInput,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'staff.manage');
  await getDatabase().$transaction(async (transaction) => {
    const target = await lockTarget(transaction, staff, staffUserId);
    const roleIds = await roleIdsFor(transaction, input.roleCodes);
    const losesSuperAdmin =
      target.roleCodes.includes(superAdminRoleCode) &&
      !input.roleCodes.includes(superAdminRoleCode);
    if (losesSuperAdmin && target.status === 'ACTIVE') {
      await assertSuperAdminRemains(transaction, staffUserId);
    }
    await replaceStaffRoles(transaction, staffUserId, roleIds);
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: 'staff.roles_changed',
      entityType: 'staff_user',
      entityId: staffUserId,
      before: { roleCodes: target.roleCodes.join(',') },
      after: { roleCodes: input.roleCodes.join(',') },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
  });
}

// Deactivation also revokes every session of that staff member (the session lookup refuses inactive
// accounts as well, so an open admin tab stops working on its next request).
export async function changeStaffStatus(
  staff: StaffContext,
  staffUserId: string,
  input: ChangeStaffStatusInput,
  metadata: RequestMetadata,
): Promise<void> {
  assertStaffPermission(staff, 'staff.manage');
  await getDatabase().$transaction(async (transaction) => {
    const target = await lockTarget(transaction, staff, staffUserId);
    if (target.status === input.status) return;
    if (input.status === 'DEACTIVATED' && target.roleCodes.includes(superAdminRoleCode)) {
      await assertSuperAdminRemains(transaction, staffUserId);
    }
    await setStaffStatus(transaction, staffUserId, input.status);
    const endedLogins =
      input.status === 'DEACTIVATED'
        ? await revokeAllSessionsForSubject(transaction, {
            subjectType: 'STAFF',
            subjectId: staffUserId,
          })
        : 0;
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: 'staff.status_changed',
      entityType: 'staff_user',
      entityId: staffUserId,
      before: { status: target.status },
      after: { status: input.status, endedLogins },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
  });
}
