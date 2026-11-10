import pino from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getConfig } from '@/lib/config';
import { getDatabase } from '@/lib/db';
import {
  createRateLimiter,
  enforceRateLimit,
  RateLimitExceededError,
} from '@/lib/rate-limit/rate-limit';
import type { RateLimitStore } from '@/lib/rate-limit/rate-limit.types';
import { resolveWindow } from '@/lib/rate-limit/rate-limit-window';

import { waitForFreshRateLimitWindow } from './support/rate-limit-window';
import { postgresRateLimitStore } from '@/lib/rate-limit/rate-limit.repository';
import {
  buildRateLimitRedisKey,
  redisRateLimitStore,
} from '@/lib/rate-limit/redis-rate-limit-store';
import { closeRedisClient, runRedisCommand } from '@/lib/redis';

import { truncateAllTestTables } from './support/test-database';
import { deleteTestRedisKeys } from './support/test-redis';

const silentLogger = pino({ level: 'silent' });
const policy = { maxRequests: 5, windowSeconds: 60 };
const parallelRequests = 50;

const unavailableStore: RateLimitStore = {
  storeName: 'redis',
  incrementWindowCount: () => Promise.reject(new Error('simulated Redis failure')),
};

function limiterWith(primaryStore: RateLimitStore) {
  return createRateLimiter({
    primaryStore,
    fallbackStore: postgresRateLimitStore,
    currentTimeMilliseconds: () => Date.now(),
    logger: () => silentLogger,
  });
}

async function fireInParallel(primaryStore: RateLimitStore, identifier: string) {
  const consume = limiterWith(primaryStore);
  return Promise.all(
    Array.from({ length: parallelRequests }, () =>
      consume({ action: 'customer-login', identifier, policy }),
    ),
  );
}

beforeEach(async () => {
  await truncateAllTestTables();
  await deleteTestRedisKeys();
});

afterAll(async () => {
  await deleteTestRedisKeys();
  await closeRedisClient();
});

describe('Redis rate limit store', () => {
  it(`allows exactly the limit out of ${parallelRequests} parallel requests`, async () => {
    const decisions = await fireInParallel(redisRateLimitStore, '203.0.113.7|asha@example.test');
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(policy.maxRequests);
    expect(decisions.every((decision) => decision.storeName === 'redis')).toBe(true);
    expect(new Set(decisions.map((decision) => decision.requestCount)).size).toBe(parallelRequests);
    expect(await getDatabase().rateLimitCounter.count()).toBe(0);
  });

  it('always stores the counter with an expiry and without the raw identifier', async () => {
    await fireInParallel(redisRateLimitStore, '203.0.113.8|neha@example.test');
    const window = resolveWindow({
      action: 'customer-login',
      identifier: '203.0.113.8|neha@example.test',
      windowSeconds: policy.windowSeconds,
      nowMilliseconds: Date.now(),
    });
    const key = buildRateLimitRedisKey(window);
    expect(key.startsWith(getConfig().redis.keyPrefix)).toBe(true);
    expect(key).not.toContain('neha');
    const remainingMilliseconds = await runRedisCommand((client) => client.pTTL(key));
    expect(remainingMilliseconds).toBeGreaterThan(0);
    expect(remainingMilliseconds).toBeLessThanOrEqual(policy.windowSeconds * 1_000 + 1_000);
  });
});

describe('Postgres rate limit store', () => {
  it(`allows exactly the limit out of ${parallelRequests} parallel requests on its own`, async () => {
    const decisions = await fireInParallel(
      postgresRateLimitStore,
      '203.0.113.9|rahul@example.test',
    );
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(policy.maxRequests);
    const [counter] = await getDatabase().rateLimitCounter.findMany({
      select: { bucketKey: true, requestCount: true },
    });
    expect(counter?.requestCount).toBe(parallelRequests);
    expect(counter?.bucketKey).not.toContain('rahul');
  });

  it('takes over when Redis fails and still enforces the exact limit', async () => {
    const decisions = await fireInParallel(unavailableStore, '203.0.113.10|fallback@example.test');
    expect(decisions.every((decision) => decision.storeName === 'postgres')).toBe(true);
    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(policy.maxRequests);
  });
});

describe('enforceRateLimit with the test configuration', () => {
  it('throws RateLimitExceededError with Retry-After once the configured limit is used up', async () => {
    const { maxRequests, windowSeconds } = getConfig().rateLimits['staff-login'];
    await waitForFreshRateLimitWindow(windowSeconds);
    for (let attempt = 0; attempt < maxRequests; attempt += 1) {
      await enforceRateLimit({ action: 'staff-login', identifier: 'staff@example.test' });
    }
    const rejection = enforceRateLimit({ action: 'staff-login', identifier: 'staff@example.test' });
    await expect(rejection).rejects.toBeInstanceOf(RateLimitExceededError);
    await rejection.catch((error: unknown) => {
      if (!(error instanceof RateLimitExceededError)) throw error;
      expect(Number(error.responseHeaders()['Retry-After'])).toBeGreaterThan(0);
    });
  });
});
