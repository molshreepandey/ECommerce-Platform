import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { requireStaff } from '@/modules/identity/access-control';
import { InvalidCredentialsError } from '@/modules/identity/identity.errors';
import { getStaffProfile, loginStaff } from '@/modules/identity/staff-account.service';

import { staffUsers } from '../../prisma/seed/identity.seed';
import {
  demoPassword,
  expectAuditTrailFreeOf,
  seedDemoIdentity,
  testMetadata,
} from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';
import { deleteTestRedisKeys } from './support/test-redis';

const database = getDatabase();

function adminRequest(sessionToken: string): NextRequest {
  return new NextRequest('http://admin.localhost:3100/api/probe', {
    headers: { cookie: `admin_session=${sessionToken}` },
  });
}

const expectedPermissionCounts: Record<string, number> = {
  SUPER_ADMIN: 19,
};

beforeEach(async () => {
  await truncateAllTestTables();
  await deleteTestRedisKeys();
  await seedDemoIdentity();
});

describe('staff login', () => {
  it.each(staffUsers.map((staff) => [staff.roleCode, staff.email] as const))(
    '%s (%s) signs in with the demo password and gets only its role permissions',
    async (roleCode, email) => {
      const { staffUserId, session } = await loginStaff(
        { email, password: demoPassword },
        testMetadata('203.0.113.60'),
      );
      const context = await requireStaff(adminRequest(session.sessionToken));
      const profile = await getStaffProfile(context);
      expect(profile.id).toBe(staffUserId);
      expect(profile.roles.map(({ code }) => code)).toEqual([roleCode]);

      const rolePermissions = await database.rolePermission.findMany({
        where: { role: { code: roleCode } },
        select: { permission: { select: { code: true } } },
      });
      expect(profile.permissionCodes).toEqual(
        rolePermissions.map(({ permission }) => permission.code).sort(),
      );
      const expectedCount = expectedPermissionCounts[roleCode];
      if (expectedCount !== undefined) expect(profile.permissionCodes).toHaveLength(expectedCount);

      const stored = await database.staffUser.findUniqueOrThrow({ where: { id: staffUserId } });
      expect(stored.lastLoginAt).not.toBeNull();
      const audit = await database.auditLog.findFirstOrThrow({
        where: { action: 'staff.login_succeeded' },
      });
      expect(audit).toMatchObject({
        actorType: 'STAFF',
        actorId: staffUserId,
        entityId: staffUserId,
        ipAddress: '203.0.113.60',
      });
      await expectAuditTrailFreeOf([demoPassword, session.sessionToken]);
    },
  );

  it('audits each kind of failure with a reason, and answers every one identically', async () => {
    const support = await database.staffUser.findUniqueOrThrow({
      where: { email: 'support@demo-store.test' },
    });
    const attempts = [
      { email: 'nobody@demo-store.test', password: demoPassword },
      { email: 'support@demo-store.test', password: 'Not-The-Password-1' },
    ];
    const errors: unknown[] = [];
    for (const attempt of attempts) {
      errors.push(await loginStaff(attempt, testMetadata()).catch((error: unknown) => error));
    }
    await database.staffUser.update({ where: { id: support.id }, data: { status: 'DEACTIVATED' } });
    errors.push(
      await loginStaff(
        { email: 'support@demo-store.test', password: demoPassword },
        testMetadata(),
      ).catch((error: unknown) => error),
    );

    for (const error of errors) {
      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect(error).toMatchObject({ httpStatus: 401, code: 'INVALID_CREDENTIALS' });
    }
    expect(await database.session.count()).toBe(0);

    const failures = await database.auditLog.findMany({
      where: { action: 'staff.login_failed' },
      orderBy: { createdAt: 'asc' },
      select: { actorType: true, actorId: true, entityId: true, after: true },
    });
    expect(failures).toEqual([
      {
        actorType: 'SYSTEM',
        actorId: null,
        entityId: 'unknown',
        after: { email: 'nobody@demo-store.test', reason: 'UNKNOWN_EMAIL' },
      },
      {
        actorType: 'SYSTEM',
        actorId: null,
        entityId: support.id,
        after: { email: 'support@demo-store.test', reason: 'WRONG_PASSWORD' },
      },
      {
        actorType: 'SYSTEM',
        actorId: null,
        entityId: support.id,
        after: { email: 'support@demo-store.test', reason: 'ACCOUNT_DEACTIVATED' },
      },
    ]);
    await expectAuditTrailFreeOf([demoPassword, 'Not-The-Password-1']);
  });

  it('does not let a customer account sign in to the admin site', async () => {
    await expect(
      loginStaff({ email: 'asha.verma@demo-store.test', password: demoPassword }, testMetadata()),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
