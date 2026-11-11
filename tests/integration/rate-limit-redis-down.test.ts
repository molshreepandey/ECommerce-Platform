import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { waitForFreshRateLimitWindow } from './support/rate-limit-window';
import { truncateAllTestTables } from './support/test-database';

const closedRedisPort = 'redis://127.0.0.1:6399';

beforeAll(() => {
  vi.stubEnv('REDIS_URL', closedRedisPort);
});

afterAll(async () => {
  const { closeRedisClient } = await import('@/lib/redis');
  await closeRedisClient();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('rate limiting with Redis unreachable (real connection failure)', () => {
  it('falls back to Postgres, enforces the limit, and only the first request waits for Redis', async () => {
    const { enforceRateLimit, RateLimitExceededError } =
      await import('@/lib/rate-limit/rate-limit');
    const { getConfig } = await import('@/lib/config');
    const { getDatabase } = await import('@/lib/db');
    const { maxRequests, windowSeconds } = getConfig().rateLimits['customer-register'];
    await waitForFreshRateLimitWindow(windowSeconds);

    const startedAt = performance.now();
    const decisions = [];
    for (let attempt = 0; attempt < maxRequests; attempt += 1) {
      decisions.push(
        await enforceRateLimit({ action: 'customer-register', identifier: '198.51.100.4' }),
      );
    }
    await expect(
      enforceRateLimit({ action: 'customer-register', identifier: '198.51.100.4' }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(decisions.every((decision) => decision.storeName === 'postgres')).toBe(true);
    const [counter] = await getDatabase().rateLimitCounter.findMany({
      select: { requestCount: true },
    });
    expect(counter?.requestCount).toBe(maxRequests + 1);
    const { connectTimeoutMilliseconds } = getConfig().redis;
    expect(elapsedMilliseconds).toBeLessThan(connectTimeoutMilliseconds + 500);
  });

  it('falls back to Postgres for the inventory write limit too, keyed by a hash of the staff id', async () => {
    const { RateLimitExceededError } = await import('@/lib/rate-limit/rate-limit');
    const { limitInventoryWrites } = await import('@/modules/inventory/inventory-rate-limit');
    const { getConfig } = await import('@/lib/config');
    const { getDatabase } = await import('@/lib/db');
    const { staffUserIdSchema } = await import('@/lib/ids');
    const { maxRequests, windowSeconds } = getConfig().rateLimits['inventory-write'];
    const staffUserId = staffUserIdSchema.parse('0195f2a0-0000-7000-8000-00000000abcd');
    const staff = { staffUserId, sessionId: 'session', permissionCodes: new Set<never>() };
    const other = {
      ...staff,
      staffUserId: staffUserIdSchema.parse('0195f2a0-0000-7000-8000-00000000dcba'),
    };
    await waitForFreshRateLimitWindow(windowSeconds, 8_000);

    for (let attempt = 0; attempt < maxRequests; attempt += 1) await limitInventoryWrites(staff);
    await expect(limitInventoryWrites(staff)).rejects.toBeInstanceOf(RateLimitExceededError);
    await expect(limitInventoryWrites(other)).resolves.toBeUndefined();

    const counters = await getDatabase().rateLimitCounter.findMany({
      select: { bucketKey: true, requestCount: true },
      orderBy: { requestCount: 'desc' },
    });
    // The bucket keys are exactly the SHA-256 of each staff id, never the id itself.
    const hashOf = (value: string) => createHash('sha256').update(value).digest('hex');
    expect(counters).toEqual([
      { bucketKey: `inventory-write:${hashOf(staffUserId)}`, requestCount: maxRequests + 1 },
      { bucketKey: `inventory-write:${hashOf(other.staffUserId)}`, requestCount: 1 },
    ]);
  });
});
