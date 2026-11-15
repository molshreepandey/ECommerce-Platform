import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { staffUserIdSchema } from '@/lib/ids';
import { type StaffContext, staffFromSessionToken } from '@/modules/identity/access-control';
import { permissionCodes } from '@/modules/identity/permissions';
import { loginStaff } from '@/modules/identity/staff-account.service';
import {
  changeStaffRolesSchema,
  changeStaffStatusSchema,
  createStaffSchema,
} from '@/modules/identity/staff-admin.schema';
import {
  changeStaffRoles,
  changeStaffStatus,
  createStaffMember,
  listStaffMembers,
} from '@/modules/identity/staff-admin.service';

import { createStaffMember as createStaffRow } from './support/inventory-fixtures';
import {
  expectAuditTrailFreeOf,
  seedDemoIdentity,
  testMetadata,
} from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const password = 'Staff-Password-2026!';

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

async function superAdmin(): Promise<StaffContext> {
  const row = await database.staffUser.findUniqueOrThrow({
    where: { email: 'super.admin@demo-store.test' },
    select: { id: true },
  });
  return {
    staffUserId: staffUserIdSchema.parse(row.id),
    sessionId: 'not-used',
    permissionCodes: new Set(permissionCodes),
  };
}

function create(actor: StaffContext, email: string, roleCodes: string[]) {
  return createStaffMember(
    actor,
    createStaffSchema.parse({ fullName: 'New Staff', email, password, roleCodes }),
    testMetadata(),
  );
}

function setStatus(actor: StaffContext, staffUserId: string, status: 'ACTIVE' | 'DEACTIVATED') {
  return changeStaffStatus(
    actor,
    staffUserId,
    changeStaffStatusSchema.parse({ status }),
    testMetadata(),
  );
}

function setRoles(actor: StaffContext, staffUserId: string, roleCodes: string[]) {
  return changeStaffRoles(
    actor,
    staffUserId,
    changeStaffRolesSchema.parse({ roleCodes }),
    testMetadata(),
  );
}

async function signIn(email: string) {
  const { session } = await loginStaff({ email, password }, testMetadata());
  return session.sessionToken;
}

beforeEach(async () => {
  await truncateAllTestTables();
  await seedDemoIdentity();
});

describe('staff management (D3)', () => {
  it('creates a staff member with a role; they sign in with that role’s permissions; the audit has no secret', async () => {
    const admin = await superAdmin();
    const created = await create(admin, 'packer@example.test', ['order_ops']);
    const staff = await staffFromSessionToken(await signIn('packer@example.test'));
    expect(staff.staffUserId).toBe(created.id);
    expect(staff.permissionCodes.has('orders.write')).toBe(true);
    expect(staff.permissionCodes.has('staff.manage')).toBe(false);
    expect(
      await database.auditLog.count({ where: { action: 'staff.created', entityId: created.id } }),
    ).toBe(1);
    await expectAuditTrailFreeOf([password]);
    expect((await listStaffMembers(admin)).map(({ email }) => email)).toContain(
      'packer@example.test',
    );
  });

  it('refuses a taken email (409), an unknown role (422) and staff without staff.manage (403)', async () => {
    const admin = await superAdmin();
    await create(admin, 'twice@example.test', ['SUPPORT']);
    expect(await failure(create(admin, 'TWICE@example.test', ['SUPPORT']))).toBe(
      '409 STAFF_EMAIL_TAKEN',
    );
    expect(await failure(create(admin, 'role@example.test', ['NO_SUCH_ROLE']))).toBe(
      '422 ROLE_NOT_FOUND',
    );
    const orderOps = await createStaffRow(['orders.read', 'orders.write']);
    expect(await failure(create(orderOps, 'nope@example.test', ['SUPPORT']))).toBe(
      '403 PERMISSION_DENIED',
    );
  });

  it('a role change applies to an open session on its next request', async () => {
    const admin = await superAdmin();
    const created = await create(admin, 'mover@example.test', ['SUPPORT']);
    const token = await signIn('mover@example.test');
    expect((await staffFromSessionToken(token)).permissionCodes.has('inventory.write')).toBe(false);
    await setRoles(admin, created.id, ['INVENTORY_MANAGER']);
    expect((await staffFromSessionToken(token)).permissionCodes.has('inventory.write')).toBe(true);
    expect(
      await database.auditLog.count({
        where: { action: 'staff.roles_changed', entityId: created.id },
      }),
    ).toBe(1);
  });

  it('deactivation ends every session and blocks sign-in; reactivation allows it again', async () => {
    const admin = await superAdmin();
    const created = await create(admin, 'leaver@example.test', ['SUPPORT']);
    const token = await signIn('leaver@example.test');
    await setStatus(admin, created.id, 'DEACTIVATED');
    expect(await failure(staffFromSessionToken(token))).toBe('401 UNAUTHENTICATED');
    expect(
      await database.session.count({ where: { subjectId: created.id, revokedAt: null } }),
    ).toBe(0);
    expect(await failure(signIn('leaver@example.test'))).toBe('401 INVALID_CREDENTIALS');
    await setStatus(admin, created.id, 'ACTIVE');
    await staffFromSessionToken(await signIn('leaver@example.test'));
  });

  it('nobody changes their own roles or status (409), and the last active super admin stays', async () => {
    const admin = await superAdmin();
    expect(await failure(setRoles(admin, admin.staffUserId, ['SUPPORT']))).toBe('409 OWN_ACCOUNT');
    expect(await failure(setStatus(admin, admin.staffUserId, 'DEACTIVATED'))).toBe(
      '409 OWN_ACCOUNT',
    );
    const manager = await createStaffRow(['staff.manage']);
    expect(await failure(setStatus(manager, admin.staffUserId, 'DEACTIVATED'))).toBe(
      '409 LAST_SUPER_ADMIN',
    );
    expect(await failure(setRoles(manager, admin.staffUserId, ['SUPPORT']))).toBe(
      '409 LAST_SUPER_ADMIN',
    );
    const second = await create(admin, 'second.admin@example.test', ['SUPER_ADMIN']);
    await setRoles(manager, admin.staffUserId, ['SUPPORT']);
    expect(await failure(setStatus(manager, second.id, 'DEACTIVATED'))).toBe(
      '409 LAST_SUPER_ADMIN',
    );
  });

  it('two managers deactivating the only two super admins at once: exactly one succeeds', async () => {
    const admin = await superAdmin();
    const second = await create(admin, 'other.admin@example.test', ['SUPER_ADMIN']);
    const [first, other] = [
      await createStaffRow(['staff.manage']),
      await createStaffRow(['staff.manage']),
    ];
    const outcomes = await Promise.all([
      failure(setStatus(first, admin.staffUserId, 'DEACTIVATED')),
      failure(setStatus(other, second.id, 'DEACTIVATED')),
    ]);
    expect(outcomes.sort()).toEqual(['409 LAST_SUPER_ADMIN', 'null']);
    expect(
      await database.staffUser.count({
        where: { status: 'ACTIVE', roles: { some: { role: { code: 'SUPER_ADMIN' } } } },
      }),
    ).toBe(1);
  });

  it('limits staff creation per super admin (L74): the write after the budget is 429', async () => {
    const manager = await createStaffRow(['staff.manage']);
    const outcomes: string[] = [];
    for (let index = 0; index < 31; index += 1) {
      outcomes.push(
        await failure(create(manager, `budget.${String(index)}@example.test`, ['SUPPORT'])),
      );
    }
    expect(outcomes.slice(0, 30).every((outcome) => outcome === 'null')).toBe(true);
    expect(outcomes[30]).toBe('429 RATE_LIMITED');
  });
});
