import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import {
  createFirstSuperAdmin,
  FirstAdminRefusedError,
} from '@/modules/identity/first-admin.service';
import { verifyPassword } from '@/modules/identity/password-hasher';
import { permissionCodes } from '@/modules/identity/permissions';

import { expectAuditTrailFreeOf, seedDemoIdentity } from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const password = 'Railway-First-Admin-2026!';
const input = { fullName: 'Owner Admin', email: 'owner@example.com', password };

async function refusalOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: unknown) => {
      if (error instanceof FirstAdminRefusedError) return error.message;
      throw error;
    },
  );
}

beforeEach(async () => {
  // A fresh deployment database: migrations only, no seed (no roles, permissions or staff).
  await truncateAllTestTables();
});

describe('first super admin bootstrap', () => {
  it('creates the RBAC catalogue and one active super admin with every permission', async () => {
    expect(await database.role.count()).toBe(0);
    const created = await createFirstSuperAdmin(database, input);

    const staff = await database.staffUser.findUniqueOrThrow({
      where: { id: created.staffUserId },
      select: {
        email: true,
        status: true,
        passwordHash: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
    expect(staff.email).toBe('owner@example.com');
    expect(staff.status).toBe('ACTIVE');
    expect(staff.passwordHash).not.toContain(password);
    expect(await verifyPassword(staff.passwordHash, password)).toBe(true);
    expect(staff.roles.map(({ role }) => role.code)).toEqual(['SUPER_ADMIN']);
    const granted = staff.roles[0]?.role.permissions.map(({ permission }) => permission.code) ?? [];
    expect(new Set(granted)).toEqual(new Set(permissionCodes));
    expect(await database.role.count()).toBe(5);

    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'staff.bootstrapped', entityId: created.staffUserId },
      select: { actorType: true, after: true },
    });
    expect(audit).toMatchObject({ actorType: 'SYSTEM', after: { roleCodes: 'SUPER_ADMIN' } });
    await expectAuditTrailFreeOf([password, staff.passwordHash]);
  });

  it('is one-time: a second run is refused and changes nothing', async () => {
    await createFirstSuperAdmin(database, input);
    const message = await refusalOf(
      createFirstSuperAdmin(database, { ...input, email: 'second@example.com' }),
    );
    expect(message).toMatch(/already exist/);
    expect(await database.staffUser.count()).toBe(1);
  });

  it('two bootstraps at the same time create exactly one admin', async () => {
    const results = await Promise.allSettled([
      createFirstSuperAdmin(database, { ...input, email: 'first@example.com' }),
      createFirstSuperAdmin(database, { ...input, email: 'second@example.com' }),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      FirstAdminRefusedError,
    );
    expect(await database.staffUser.count()).toBe(1);
  });

  it('is refused on a database that already has staff (e.g. a seeded one)', async () => {
    await seedDemoIdentity();
    const staffBefore = await database.staffUser.count();
    expect(staffBefore).toBeGreaterThan(0);
    expect(await refusalOf(createFirstSuperAdmin(database, input))).toMatch(/already exist/);
    expect(await database.staffUser.count()).toBe(staffBefore);
    expect(await database.staffUser.count({ where: { email: input.email } })).toBe(0);
  });
});
