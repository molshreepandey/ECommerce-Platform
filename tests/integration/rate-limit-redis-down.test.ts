import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
    const { maxRequests } = getConfig().rateLimits['customer-register'];

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
});
