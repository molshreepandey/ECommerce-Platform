import type { StaffUserStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export const superAdminRoleCode = 'SUPER_ADMIN';

const staffListSelect = {
  id: true,
  fullName: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: { select: { code: true, name: true } } } },
} as const;

export function listStaffRows(database: DatabaseClient) {
  return database.staffUser.findMany({
    select: staffListSelect,
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    take: 200,
  });
}

export function listRoleRows(database: DatabaseClient) {
  return database.role.findMany({
    select: { id: true, code: true, name: true, description: true },
    orderBy: { code: 'asc' },
  });
}

export function findRolesByCodes(database: DatabaseClient, codes: readonly string[]) {
  return database.role.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true, code: true },
  });
}

// Serialises every staff role and status change, so the "at least one active super admin" check
// cannot be raced by two changes that each see the other super admin still active.
export async function lockStaffManagement(database: DatabaseClient): Promise<void> {
  await database.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext('staff-management'))) AS locked`;
}

export function findStaffForChange(database: DatabaseClient, staffUserId: string) {
  return database.staffUser.findUnique({
    where: { id: staffUserId },
    select: { id: true, status: true, roles: { select: { role: { select: { code: true } } } } },
  });
}

export function countOtherActiveSuperAdmins(database: DatabaseClient, staffUserId: string) {
  return database.staffUser.count({
    where: {
      id: { not: staffUserId },
      status: 'ACTIVE',
      roles: { some: { role: { code: superAdminRoleCode } } },
    },
  });
}

export function insertStaffUser(
  database: DatabaseClient,
  input: { fullName: string; email: string; passwordHash: string; roleIds: readonly string[] },
) {
  return database.staffUser.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      passwordHash: input.passwordHash,
      roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
    },
    select: { id: true },
  });
}

export async function replaceStaffRoles(
  database: DatabaseClient,
  staffUserId: string,
  roleIds: readonly string[],
): Promise<void> {
  await database.staffUserRole.deleteMany({ where: { staffUserId } });
  await database.staffUserRole.createMany({
    data: roleIds.map((roleId) => ({ staffUserId, roleId })),
  });
}

export async function setStaffStatus(
  database: DatabaseClient,
  staffUserId: string,
  status: StaffUserStatus,
): Promise<void> {
  await database.staffUser.update({
    where: { id: staffUserId },
    data: { status },
    select: { id: true },
  });
}
