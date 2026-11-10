import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ConfigModule from '@/lib/config';
import { getDatabase } from '@/lib/db';
import { getLogger } from '@/lib/logger';
import { RateLimitExceededError } from '@/lib/rate-limit/rate-limit';
import { requestMetadata } from '@/modules/identity/access-control';
import { loginCustomer, registerCustomer } from '@/modules/identity/customer-account.service';
import { InvalidCredentialsError } from '@/modules/identity/identity.errors';
import { loginStaff } from '@/modules/identity/staff-account.service';

import { seedDemoIdentity } from './support/identity-fixtures';
import { waitForFreshRateLimitWindow } from './support/rate-limit-window';
import { truncateAllTestTables } from './support/test-database';
import { deleteTestRedisKeys } from './support/test-redis';

// One trusted proxy in front of the app, with small limits so "limit + 1" stays inside one window.
vi.mock('@/lib/config', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>();
  return {
    ...actual,
    getConfig: () => {
      const config = actual.getConfig();
      return {
        ...config,
        authentication: { ...config.authentication, trustedProxyHopCount: 1 },
        rateLimits: {
          'customer-login': { maxRequests: 3, windowSeconds: 60 },
          'customer-register': { maxRequests: 2, windowSeconds: 60 },
          'staff-login': { maxRequests: 3, windowSeconds: 60 },
        },
      };
    },
  };
});

const signInLimit = 3;
const registrationLimit = 2;
const windowSeconds = 60;
const realClientIp = '203.0.113.7';

function metadataFor(forwardedFor: string | null) {
  const headers = new Headers();
  if (forwardedFor !== null) headers.set('x-forwarded-for', forwardedFor);
  const request = new NextRequest('http://store.localhost:3100/api/store/auth/login', { headers });
  return requestMetadata(request, { requestId: 'client-ip-trust-test', logger: getLogger() });
}

function forgedThenReal(attempt: number): string {
  return `198.51.100.${attempt}, ${realClientIp}`;
}

async function rejectionOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => null,
    (rejection: unknown) => rejection,
  );
}

beforeEach(async () => {
  await truncateAllTestTables();
  await deleteTestRedisKeys();
});

describe('client IP behind one trusted proxy', () => {
  it('uses the address the proxy appended, not the one the client sent', () => {
    expect(metadataFor(forgedThenReal(99)).clientIp).toBe(realClientIp);
  });

  it('never falls back to the leftmost entry when the selected entry is not an IP address', () => {
    expect(metadataFor(`${realClientIp}, not-an-ip`).clientIp).toBeNull();
  });

  it('rate-limits customer sign-in per real client even when every request forges a new address', async () => {
    await waitForFreshRateLimitWindow(windowSeconds);
    for (let attempt = 1; attempt <= signInLimit; attempt += 1) {
      const rejection = await rejectionOf(
        loginCustomer(
          { email: 'forged.customer@example.test', password: 'Wrong-Password-1' },
          metadataFor(forgedThenReal(attempt)),
        ),
      );
      expect(rejection).toBeInstanceOf(InvalidCredentialsError);
    }
    const overLimit = await rejectionOf(
      loginCustomer(
        { email: 'forged.customer@example.test', password: 'Wrong-Password-1' },
        metadataFor(forgedThenReal(signInLimit + 1)),
      ),
    );
    expect(overLimit).toBeInstanceOf(RateLimitExceededError);
  });

  it('rate-limits staff sign-in per real client even when every request forges a new address', async () => {
    await waitForFreshRateLimitWindow(windowSeconds);
    for (let attempt = 1; attempt <= signInLimit; attempt += 1) {
      const rejection = await rejectionOf(
        loginStaff(
          { email: 'forged.staff@example.test', password: 'Wrong-Password-1' },
          metadataFor(forgedThenReal(attempt)),
        ),
      );
      expect(rejection).toBeInstanceOf(InvalidCredentialsError);
    }
    const overLimit = await rejectionOf(
      loginStaff(
        { email: 'forged.staff@example.test', password: 'Wrong-Password-1' },
        metadataFor(forgedThenReal(signInLimit + 1)),
      ),
    );
    expect(overLimit).toBeInstanceOf(RateLimitExceededError);
  });

  it('rate-limits registration per real client even when every request forges a new address', async () => {
    await waitForFreshRateLimitWindow(windowSeconds);
    for (let attempt = 1; attempt <= registrationLimit; attempt += 1) {
      await registerCustomer(
        {
          fullName: `Forged Header ${attempt}`,
          email: `forged.registration.${attempt}@example.test`,
          phone: `987650000${attempt}`,
          password: 'Strong-Password-1',
        },
        metadataFor(forgedThenReal(attempt)),
      );
    }
    const overLimit = await rejectionOf(
      registerCustomer(
        {
          fullName: 'Forged Header Extra',
          email: 'forged.registration.extra@example.test',
          phone: '9876500099',
          password: 'Strong-Password-1',
        },
        metadataFor(forgedThenReal(registrationLimit + 1)),
      ),
    );
    expect(overLimit).toBeInstanceOf(RateLimitExceededError);
    expect(await getDatabase().customer.count()).toBe(registrationLimit);
  });

  it('records the real client address, not the forged one, in the audit trail', async () => {
    await seedDemoIdentity();
    await rejectionOf(
      loginStaff(
        { email: 'super.admin@demo-store.test', password: 'Wrong-Password-1' },
        metadataFor(forgedThenReal(42)),
      ),
    );
    const auditRows = await getDatabase().auditLog.findMany({
      where: { action: 'staff.login_failed' },
      select: { ipAddress: true },
    });
    expect(auditRows).toEqual([{ ipAddress: realClientIp }]);
  });

  it('keeps separate buckets for different real clients signing in to the same account', async () => {
    await waitForFreshRateLimitWindow(windowSeconds);
    for (let attempt = 1; attempt <= signInLimit; attempt += 1) {
      await rejectionOf(
        loginCustomer(
          { email: 'shared.account@example.test', password: 'Wrong-Password-1' },
          metadataFor('203.0.113.10'),
        ),
      );
    }
    const otherClient = await rejectionOf(
      loginCustomer(
        { email: 'shared.account@example.test', password: 'Wrong-Password-1' },
        metadataFor('203.0.113.20'),
      ),
    );
    expect(otherClient).toBeInstanceOf(InvalidCredentialsError);
  });

  it('keeps the per-email fallback bucket when the header is missing', async () => {
    expect(metadataFor(null).clientIp).toBeNull();
    await waitForFreshRateLimitWindow(windowSeconds);
    for (let attempt = 1; attempt <= signInLimit; attempt += 1) {
      await rejectionOf(
        loginCustomer(
          { email: 'no.header@example.test', password: 'Wrong-Password-1' },
          metadataFor(null),
        ),
      );
    }
    const overLimit = await rejectionOf(
      loginCustomer(
        { email: 'no.header@example.test', password: 'Wrong-Password-1' },
        metadataFor(null),
      ),
    );
    expect(overLimit).toBeInstanceOf(RateLimitExceededError);
  });
});
