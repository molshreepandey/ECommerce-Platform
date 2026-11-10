import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  requireCustomer,
  requirePermission,
  requireStaff,
} from '@/modules/identity/access-control';
import {
  PermissionDeniedError,
  UnauthenticatedError,
  WrongAccountTypeError,
} from '@/modules/identity/identity.errors';
import { insertSession } from '@/modules/identity/session.repository';
import { endSession, startSession } from '@/modules/identity/session.service';
import { hashSessionToken } from '@/modules/identity/session-token';

import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

function requestWithCookie(host: string, cookieName: string, sessionToken: string): NextRequest {
  return new NextRequest(`http://${host}/api/probe`, {
    headers: { cookie: `${cookieName}=${sessionToken}` },
  });
}
const storeRequest = (token: string) =>
  requestWithCookie('store.localhost:3100', 'store_session', token);
const adminRequest = (token: string) =>
  requestWithCookie('admin.localhost:3100', 'admin_session', token);

async function createCustomer() {
  return database.customer.create({
    data: {
      fullName: 'Session Customer',
      email: 'session.customer@example.test',
      phone: '9876500200',
      passwordHash: 'not-a-real-hash',
    },
    select: { id: true },
  });
}

async function createStaffWithPermissions(permissionCodes: string[]) {
  const role = await database.role.create({
    data: { code: 'TEST_ROLE', name: 'Test role' },
    select: { id: true },
  });
  for (const code of permissionCodes) {
    const permission = await database.permission.create({
      data: { code, description: code },
      select: { id: true },
    });
    await database.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });
  }
  const staff = await database.staffUser.create({
    data: { fullName: 'Session Staff', email: 'session.staff@example.test', passwordHash: 'x' },
    select: { id: true },
  });
  await database.staffUserRole.create({ data: { staffUserId: staff.id, roleId: role.id } });
  return staff;
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('sessions', () => {
  it('stores only the SHA-256 hash of the token and resolves the customer', async () => {
    const customer = await createCustomer();
    const session = await startSession(database, {
      subjectType: 'CUSTOMER',
      subjectId: customer.id,
    });
    const [stored] = await database.session.findMany({
      select: { tokenHash: true, expiresAt: true },
    });
    expect(stored?.tokenHash).toBe(hashSessionToken(session.sessionToken));
    expect(stored?.tokenHash).not.toBe(session.sessionToken);
    const lifetimeDays = ((stored?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(lifetimeDays).toBeGreaterThan(29.9);
    expect(lifetimeDays).toBeLessThanOrEqual(30);
    await expect(requireCustomer(storeRequest(session.sessionToken))).resolves.toMatchObject({
      customerId: customer.id,
    });
  });

  it('gives staff sessions a 12-hour lifetime', async () => {
    const staff = await createStaffWithPermissions([]);
    const session = await startSession(database, { subjectType: 'STAFF', subjectId: staff.id });
    const lifetimeHours = (session.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(lifetimeHours).toBeGreaterThan(11.9);
    expect(lifetimeHours).toBeLessThanOrEqual(12);
  });

  it('rejects a missing, unknown, expired or revoked session with 401', async () => {
    const customer = await createCustomer();
    await expect(
      requireCustomer(new NextRequest('http://store.localhost:3100/api/probe')),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(requireCustomer(storeRequest('made-up-token'))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );

    await insertSession(database, {
      tokenHash: hashSessionToken('expired-token'),
      subjectType: 'CUSTOMER',
      subjectId: customer.id,
      expiresAt: new Date(Date.now() - 1_000),
    });
    await expect(requireCustomer(storeRequest('expired-token'))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );

    const session = await startSession(database, {
      subjectType: 'CUSTOMER',
      subjectId: customer.id,
    });
    await endSession(session.sessionToken);
    await expect(requireCustomer(storeRequest(session.sessionToken))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('rejects existing sessions as soon as a customer is blocked or staff is deactivated', async () => {
    const customer = await createCustomer();
    const customerSession = await startSession(database, {
      subjectType: 'CUSTOMER',
      subjectId: customer.id,
    });
    await database.customer.update({ where: { id: customer.id }, data: { status: 'BLOCKED' } });
    await expect(
      requireCustomer(storeRequest(customerSession.sessionToken)),
    ).rejects.toBeInstanceOf(UnauthenticatedError);

    const staff = await createStaffWithPermissions(['orders.read']);
    const staffSession = await startSession(database, {
      subjectType: 'STAFF',
      subjectId: staff.id,
    });
    await database.staffUser.update({ where: { id: staff.id }, data: { status: 'DEACTIVATED' } });
    await expect(requireStaff(adminRequest(staffSession.sessionToken))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });
});

describe('access control', () => {
  it('answers 403 when a customer session is used on the admin site', async () => {
    const customer = await createCustomer();
    const session = await startSession(database, {
      subjectType: 'CUSTOMER',
      subjectId: customer.id,
    });
    const rejection = requireStaff(adminRequest(session.sessionToken));
    await expect(rejection).rejects.toBeInstanceOf(WrongAccountTypeError);
    await rejection.catch((error: unknown) => {
      if (error instanceof WrongAccountTypeError) expect(error.httpStatus).toBe(403);
    });
  });

  it('answers 403 when a staff session is used on the store site', async () => {
    const staff = await createStaffWithPermissions([]);
    const session = await startSession(database, { subjectType: 'STAFF', subjectId: staff.id });
    await expect(requireCustomer(storeRequest(session.sessionToken))).rejects.toBeInstanceOf(
      WrongAccountTypeError,
    );
  });

  it('allows a permission the role has and refuses one it lacks', async () => {
    const staff = await createStaffWithPermissions(['orders.read', 'customers.read']);
    const session = await startSession(database, { subjectType: 'STAFF', subjectId: staff.id });
    const context = await requirePermission(adminRequest(session.sessionToken), 'orders.read');
    expect([...context.permissionCodes].sort()).toEqual(['customers.read', 'orders.read']);
    const rejection = requirePermission(adminRequest(session.sessionToken), 'orders.write');
    await expect(rejection).rejects.toBeInstanceOf(PermissionDeniedError);
    await rejection.catch((error: unknown) => {
      if (error instanceof PermissionDeniedError) {
        expect(error.httpStatus).toBe(403);
        expect(error.details).toEqual({ requiredPermission: 'orders.write' });
      }
    });
  });
});

describe('audit writer', () => {
  it('rolls the audit row back together with the change it describes', async () => {
    const customer = await createCustomer();
    await expect(
      database.$transaction(async (transaction) => {
        await transaction.customer.update({
          where: { id: customer.id },
          data: { fullName: 'Changed' },
        });
        await recordAuditEvent(transaction, {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          action: 'customer.profile_updated',
          entityType: 'customer',
          entityId: customer.id,
          after: { fullName: 'Changed', password: 'must never be stored' },
          ipAddress: '203.0.113.5',
          requestId: 'request-under-test',
        });
        throw new Error('simulated failure after the audit row');
      }),
    ).rejects.toThrow('simulated failure');
    expect(await database.auditLog.count()).toBe(0);
    expect(
      (await database.customer.findUniqueOrThrow({ where: { id: customer.id } })).fullName,
    ).toBe('Session Customer');
  });

  it('commits a sanitised audit row with the change', async () => {
    const customer = await createCustomer();
    await database.$transaction(async (transaction) => {
      await recordAuditEvent(transaction, {
        actorType: 'CUSTOMER',
        actorId: customer.id,
        action: 'customer.profile_updated',
        entityType: 'customer',
        entityId: customer.id,
        after: { fullName: 'Changed', passwordHash: 'must never be stored' },
        ipAddress: 'not-an-ip',
        requestId: 'request-under-test',
      });
    });
    const [row] = await database.auditLog.findMany({
      select: { after: true, ipAddress: true, requestId: true, action: true },
    });
    expect(row).toEqual({
      after: { fullName: 'Changed' },
      ipAddress: null,
      requestId: 'request-under-test',
      action: 'customer.profile_updated',
    });
  });
});
