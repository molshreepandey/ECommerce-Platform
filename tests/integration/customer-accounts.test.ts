import { beforeEach, describe, expect, it } from 'vitest';

import { getConfig } from '@/lib/config';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { RateLimitExceededError } from '@/lib/rate-limit/rate-limit';
import { requireCustomer } from '@/modules/identity/access-control';
import {
  getCustomerProfile,
  loginCustomer,
  logoutCustomerEverywhere,
  registerCustomer,
  updateCustomerProfile,
} from '@/modules/identity/customer-account.service';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  PhoneAlreadyRegisteredError,
  UnauthenticatedError,
} from '@/modules/identity/identity.errors';
import {
  loginSchema,
  registerCustomerSchema,
  updateProfileSchema,
} from '@/modules/identity/identity.schema';
import { hashSessionToken } from '@/modules/identity/session-token';
import { NextRequest } from 'next/server';

import { expectAuditTrailFreeOf, testMetadata } from './support/identity-fixtures';
import { waitForFreshRateLimitWindow } from './support/rate-limit-window';
import { truncateAllTestTables } from './support/test-database';
import { deleteTestRedisKeys } from './support/test-redis';

const database = getDatabase();
const password = 'Correct-Horse-2026';

function registration(
  overrides: Partial<Record<'fullName' | 'email' | 'phone' | 'password', string>> = {},
) {
  return registerCustomerSchema.parse({
    fullName: 'Priya Nair',
    email: 'Priya.Nair@Example.test',
    phone: '9876501000',
    password,
    ...overrides,
  });
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

function storeRequest(sessionToken: string): NextRequest {
  return new NextRequest('http://store.localhost:3100/api/probe', {
    headers: { cookie: `store_session=${sessionToken}` },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
  await deleteTestRedisKeys();
});

describe('customer registration', () => {
  it('stores a lower-cased email, an Argon2id hash, a session and one audit row', async () => {
    const { customer, session } = await registerCustomer(
      registration(),
      testMetadata('203.0.113.20'),
    );
    expect(customer).toMatchObject({ email: 'priya.nair@example.test', fullName: 'Priya Nair' });
    expect(customer).not.toHaveProperty('passwordHash');

    const stored = await database.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored.passwordHash).not.toContain(password);

    const sessions = await database.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(hashSessionToken(session.sessionToken));

    const audits = await database.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'customer.registered',
      actorType: 'CUSTOMER',
      actorId: customer.id,
      entityId: customer.id,
      after: { email: 'priya.nair@example.test', fullName: 'Priya Nair' },
      ipAddress: '203.0.113.20',
    });
    await expectAuditTrailFreeOf([password, session.sessionToken]);
  });

  it('answers 409 for an email already registered in any letter case, and leaves no trace', async () => {
    await registerCustomer(registration(), testMetadata());
    const error = await captureError(
      registerCustomer(
        registration({ email: 'PRIYA.NAIR@EXAMPLE.TEST', phone: '9876501001' }),
        testMetadata(),
      ),
    );
    expect(error).toBeInstanceOf(EmailAlreadyRegisteredError);
    expect(error).toMatchObject({ httpStatus: 409, code: 'EMAIL_ALREADY_REGISTERED' });
    expect(await database.customer.count()).toBe(1);
    expect(await database.session.count()).toBe(1);
    expect(await database.auditLog.count()).toBe(1);
  });

  it('answers 409 for a phone number already registered', async () => {
    await registerCustomer(registration(), testMetadata());
    const error = await captureError(
      registerCustomer(registration({ email: 'someone.else@example.test' }), testMetadata()),
    );
    expect(error).toBeInstanceOf(PhoneAlreadyRegisteredError);
    expect(error).toMatchObject({ httpStatus: 409, code: 'PHONE_ALREADY_REGISTERED' });
  });

  it('creates exactly one account when ten registrations for one email race', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_unused, index) =>
        registerCustomer(
          registration({
            email: index % 2 === 0 ? 'race@example.test' : 'RACE@example.test',
            phone: `98765020${String(index).padStart(2, '0')}`,
          }),
          testMetadata(`203.0.113.${100 + index}`),
        ),
      ),
    );
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejections = attempts.flatMap((attempt): unknown[] =>
      attempt.status === 'rejected' ? [attempt.reason] : [],
    );
    expect(rejections).toHaveLength(9);
    for (const reason of rejections) expect(reason).toBeInstanceOf(EmailAlreadyRegisteredError);
    expect(await database.customer.count()).toBe(1);
    expect(await database.session.count()).toBe(1);
    expect(await database.auditLog.count()).toBe(1);
  });

  it('rate-limits registrations from one client with 429 and a Retry-After value', async () => {
    const { maxRequests, windowSeconds } = getConfig().rateLimits['customer-register'];
    await waitForFreshRateLimitWindow(windowSeconds);
    const clientIp = '203.0.113.30';
    for (let attempt = 0; attempt < maxRequests; attempt += 1) {
      // After the first success these are duplicates (409), which still count against the limit.
      await registerCustomer(registration(), testMetadata(clientIp)).catch(() => undefined);
    }
    const error = await captureError(
      registerCustomer(
        registration({ email: 'late@example.test', phone: '9876501999' }),
        testMetadata(clientIp),
      ),
    );
    expect(error).toBeInstanceOf(RateLimitExceededError);
    if (error instanceof RateLimitExceededError) {
      expect(error.httpStatus).toBe(429);
      expect(error.retryAfterSeconds).toBeGreaterThan(0);
      expect(error.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });
});

describe('customer login', () => {
  async function registeredCustomer() {
    const { customer } = await registerCustomer(registration(), testMetadata());
    await database.session.deleteMany();
    return customer;
  }

  it('starts a new session for the correct password, with the email in any case', async () => {
    const customer = await registeredCustomer();
    const { customerId, session } = await loginCustomer(
      loginSchema.parse({ email: ' PRIYA.nair@example.test ', password }),
      testMetadata(),
    );
    expect(customerId).toBe(customer.id);
    await expect(requireCustomer(storeRequest(session.sessionToken))).resolves.toMatchObject({
      customerId: customer.id,
    });
  });

  it('gives the same 401 for an unknown email, a wrong password and a blocked account, and creates no session', async () => {
    const customer = await registeredCustomer();
    const unknownEmail = await captureError(
      loginCustomer({ email: 'nobody@example.test', password }, testMetadata()),
    );
    const wrongPassword = await captureError(
      loginCustomer(
        { email: 'priya.nair@example.test', password: 'Wrong-Password-1' },
        testMetadata(),
      ),
    );
    await database.customer.update({ where: { id: customer.id }, data: { status: 'BLOCKED' } });
    const blocked = await captureError(
      loginCustomer({ email: 'priya.nair@example.test', password }, testMetadata()),
    );

    const shapes = [unknownEmail, wrongPassword, blocked].map((error) => {
      expect(error).toBeInstanceOf(InvalidCredentialsError);
      return error instanceof InvalidCredentialsError
        ? {
            status: error.httpStatus,
            code: error.code,
            message: error.message,
            details: error.details,
          }
        : null;
    });
    expect(shapes[0]).toEqual({
      status: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'The email or password is incorrect.',
      details: null,
    });
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
    expect(await database.session.count()).toBe(0);
  });

  it('rate-limits repeated attempts for one email from one client', async () => {
    await registeredCustomer();
    const { maxRequests, windowSeconds } = getConfig().rateLimits['customer-login'];
    await waitForFreshRateLimitWindow(windowSeconds);
    const clientIp = '203.0.113.40';
    for (let attempt = 0; attempt < maxRequests; attempt += 1) {
      await captureError(
        loginCustomer(
          { email: 'priya.nair@example.test', password: 'Wrong-1' },
          testMetadata(clientIp),
        ),
      );
    }
    const error = await captureError(
      loginCustomer({ email: 'priya.nair@example.test', password }, testMetadata(clientIp)),
    );
    expect(error).toBeInstanceOf(RateLimitExceededError);
    // A different client is not affected by the first client's bucket.
    await expect(
      loginCustomer({ email: 'priya.nair@example.test', password }, testMetadata('203.0.113.41')),
    ).resolves.toHaveProperty('customerId');
  });
});

describe('logout everywhere', () => {
  it('revokes every session of this customer only, and audits the count', async () => {
    const { customer, session } = await registerCustomer(registration(), testMetadata());
    const other = await registerCustomer(
      registration({ email: 'other@example.test', phone: '9876501002' }),
      testMetadata(),
    );
    await loginCustomer({ email: 'priya.nair@example.test', password }, testMetadata());
    await loginCustomer({ email: 'priya.nair@example.test', password }, testMetadata());

    const context = await requireCustomer(storeRequest(session.sessionToken));
    expect(await logoutCustomerEverywhere(context, testMetadata())).toBe(3);

    await expect(requireCustomer(storeRequest(session.sessionToken))).rejects.toMatchObject({
      httpStatus: 401,
    });
    await expect(requireCustomer(storeRequest(other.session.sessionToken))).resolves.toMatchObject({
      customerId: other.customer.id,
    });
    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'customer.logout_everywhere' },
    });
    expect(audit).toMatchObject({ actorId: customer.id, after: { revokedCount: 3 } });
    await expectAuditTrailFreeOf([password, session.sessionToken]);
  });
});

describe('customer profile', () => {
  it('updates only changed fields and audits before and after values', async () => {
    const { customer, session } = await registerCustomer(registration(), testMetadata());
    const context = await requireCustomer(storeRequest(session.sessionToken));

    const updated = await updateCustomerProfile(
      context,
      updateProfileSchema.parse({ fullName: '  Priya N. Nair ', phone: '9876501000' }),
      testMetadata(),
    );
    expect(updated).toEqual({
      id: customer.id,
      fullName: 'Priya N. Nair',
      email: 'priya.nair@example.test',
      phone: '9876501000',
    });
    expect(await getCustomerProfile(context)).toEqual(updated);

    const audit = await database.auditLog.findFirstOrThrow({
      where: { action: 'customer.profile_updated' },
    });
    expect(audit.before).toEqual({ fullName: 'Priya Nair' });
    expect(audit.after).toEqual({ fullName: 'Priya N. Nair' });
  });

  it('writes nothing when nothing changes', async () => {
    const { session } = await registerCustomer(registration(), testMetadata());
    const context = await requireCustomer(storeRequest(session.sessionToken));
    await updateCustomerProfile(context, { fullName: 'Priya Nair' }, testMetadata());
    expect(await database.auditLog.count({ where: { action: 'customer.profile_updated' } })).toBe(
      0,
    );
  });

  it("refuses another customer's phone number with 409 and leaves the profile unchanged", async () => {
    const { session } = await registerCustomer(registration(), testMetadata());
    await registerCustomer(
      registration({ email: 'other@example.test', phone: '9876501003' }),
      testMetadata(),
    );
    const context = await requireCustomer(storeRequest(session.sessionToken));
    await expect(
      updateCustomerProfile(
        context,
        { phone: '9876501003', currentPassword: password },
        testMetadata(),
      ),
    ).rejects.toBeInstanceOf(PhoneAlreadyRegisteredError);
    expect((await getCustomerProfile(context)).phone).toBe('9876501000');
    expect(await database.auditLog.count({ where: { action: 'customer.profile_updated' } })).toBe(
      0,
    );
  });

  it('changes the phone only with the current password and signs out other sessions (M2)', async () => {
    const { session } = await registerCustomer(registration(), testMetadata());
    const other = await loginCustomer(
      { email: 'priya.nair@example.test', password },
      testMetadata(),
    );
    const context = await requireCustomer(storeRequest(session.sessionToken));
    const refusal = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => (error instanceof DomainError ? error.code : String(error)),
      );
    expect(
      await refusal(updateCustomerProfile(context, { phone: '9876501009' }, testMetadata())),
    ).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(
      await refusal(
        updateCustomerProfile(
          context,
          { phone: '9876501009', currentPassword: 'Wrong-Password-2026' },
          testMetadata(),
        ),
      ),
    ).toBe('CURRENT_PASSWORD_INCORRECT');
    expect((await getCustomerProfile(context)).phone).toBe('9876501000');
    // A name-only change still needs no password.
    await updateCustomerProfile(context, { fullName: 'Priya R. Nair' }, testMetadata());

    await updateCustomerProfile(
      context,
      { phone: '9876501009', currentPassword: password },
      testMetadata(),
    );
    expect((await getCustomerProfile(context)).phone).toBe('9876501009');
    // The other device is signed out; this one stays signed in.
    await expect(requireCustomer(storeRequest(other.session.sessionToken))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await requireCustomer(storeRequest(session.sessionToken));
    const audit = await database.auditLog.findFirstOrThrow({
      where: {
        action: 'customer.profile_updated',
        after: { path: ['phone'], equals: '9876501009' },
      },
    });
    expect(audit.after).toEqual({ phone: '9876501009', endedLogins: 1 });
    await expectAuditTrailFreeOf([password, session.sessionToken]);
  });
});
