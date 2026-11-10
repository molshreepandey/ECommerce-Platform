import type { StaffUserStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export function findStaffCredentialsByEmail(
  database: DatabaseClient,
  email: string,
): Promise<{ id: string; passwordHash: string; status: StaffUserStatus } | null> {
  return database.staffUser.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, status: true },
  });
}

export async function recordStaffLogin(
  database: DatabaseClient,
  staffUserId: string,
): Promise<void> {
  await database.staffUser.update({
    where: { id: staffUserId },
    data: { lastLoginAt: new Date() },
    select: { id: true },
  });
}

export function findStaffProfile(database: DatabaseClient, staffUserId: string) {
  return database.staffUser.findUnique({
    where: { id: staffUserId },
    select: {
      id: true,
      fullName: true,
      email: true,
      roles: { select: { role: { select: { code: true, name: true } } } },
    },
  });
}
