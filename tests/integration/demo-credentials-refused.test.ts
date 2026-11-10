import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConfigModule from '@/lib/config';
import { getDatabase } from '@/lib/db';
import { registerCustomer, loginCustomer } from '@/modules/identity/customer-account.service';
import { demoPassword } from '@/modules/identity/demo-credentials';
import { InvalidCredentialsError } from '@/modules/identity/identity.errors';
import { hashPassword } from '@/modules/identity/password-hasher';
import { loginStaff } from '@/modules/identity/staff-account.service';

import { seedDemoIdentity, testMetadata } from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';
import { deleteTestRedisKeys } from './support/test-redis';

// Simulates staging/production: the committed config for those environments has demoAccountsAllowed=false.
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return {
        ...config,
        authentication: { ...config.authentication, demoAccountsAllowed: false },
      };
    },
  };
});

const database = getDatabase();

async function failureShape(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => null,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(InvalidCredentialsError);
  return error instanceof InvalidCredentialsError
    ? { status: error.httpStatus, code: error.code, message: error.message, details: error.details }
    : null;
}

beforeEach(async () => {
  await truncateAllTestTables();
  await deleteTestRedisKeys();
  // The seed itself is allowed because APP_ENV is still "test"; only the runtime flag is switched off.
  await seedDemoIdentity();
});

describe('demo credentials when demoAccountsAllowed is false', () => {
  it('refuses every seeded staff and customer account with the ordinary 401', async () => {
    const shapes = [
      await failureShape(
        loginStaff(
          { email: 'super.admin@demo-store.test', password: demoPassword },
          testMetadata(),
        ),
      ),
      await failureShape(
        loginCustomer(
          { email: 'asha.verma@demo-store.test', password: demoPassword },
          testMetadata(),
        ),
      ),
      await failureShape(
        loginCustomer(
          { email: 'nobody@example.test', password: 'Some-Password-1' },
          testMetadata(),
        ),
      ),
    ];
    expect(shapes[0]).toEqual(shapes[2]);
    expect(shapes[1]).toEqual(shapes[2]);
    expect(await database.session.count()).toBe(0);
  });

  it('refuses the demo password even on an ordinary email', async () => {
    await database.customer.create({
      data: {
        fullName: 'Copied Hash',
        email: 'copied.hash@example.test',
        phone: '9876506000',
        passwordHash: await hashPassword(demoPassword),
      },
    });
    await expect(
      loginCustomer({ email: 'copied.hash@example.test', password: demoPassword }, testMetadata()),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(await database.session.count()).toBe(0);
  });

  it('audits refused staff attempts with their own reason', async () => {
    await loginStaff(
      { email: 'support@demo-store.test', password: demoPassword },
      testMetadata(),
    ).catch(() => undefined);
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'staff.login_failed' },
    });
    expect(audit.after).toEqual({
      email: 'support@demo-store.test',
      reason: 'DEMO_CREDENTIAL_REFUSED',
    });
  });

  it('rejects registration with the demo password or the demo email domain (400)', async () => {
    const base = { fullName: 'New Shopper', phone: '9876506001' };
    await expect(
      registerCustomer(
        { ...base, email: 'new.shopper@example.test', password: demoPassword },
        testMetadata(),
      ),
    ).rejects.toMatchObject({
      httpStatus: 400,
      code: 'VALIDATION_FAILED',
      details: { fieldErrors: { password: [expect.stringContaining('publicly known')] } },
    });
    await expect(
      registerCustomer(
        { ...base, email: 'fake@demo-store.test', password: 'Unique-Password-1' },
        testMetadata(),
      ),
    ).rejects.toMatchObject({
      details: { fieldErrors: { email: [expect.stringContaining('reserved for demo')] } },
    });
    expect(await database.customer.count({ where: { fullName: 'New Shopper' } })).toBe(0);
  });

  it('still signs in ordinary accounts', async () => {
    await registerCustomer(
      {
        fullName: 'Ordinary Shopper',
        email: 'ordinary@example.test',
        phone: '9876506002',
        password: 'Ordinary-Password-1',
      },
      testMetadata(),
    );
    await expect(
      loginCustomer(
        { email: 'ordinary@example.test', password: 'Ordinary-Password-1' },
        testMetadata(),
      ),
    ).resolves.toHaveProperty('customerId');
  });
});
