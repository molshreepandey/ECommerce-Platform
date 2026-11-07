import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { createRateLimiter, RateLimitExceededError } from './rate-limit';
import type { RateLimitStore, RateLimitWindow } from './rate-limit.types';
import { buildBucketKey, resolveWindow, secondsUntilWindowEnds } from './rate-limit-window';

const silentLogger = pino({ level: 'silent' });
const policy = { maxRequests: 3, windowSeconds: 60 };
const fixedNowMilliseconds = Date.UTC(2026, 10, 7, 12, 0, 30);

function inMemoryStore(storeName: RateLimitStore['storeName']): RateLimitStore & {
  windowsSeen: RateLimitWindow[];
} {
  const counts = new Map<string, number>();
  const windowsSeen: RateLimitWindow[] = [];
  return {
    storeName,
    windowsSeen,
    incrementWindowCount(window) {
      windowsSeen.push(window);
      const key = `${window.bucketKey}@${window.windowStartedAtMilliseconds}`;
      const nextCount = (counts.get(key) ?? 0) + 1;
      counts.set(key, nextCount);
      return Promise.resolve(nextCount);
    },
  };
}

function failingStore(): RateLimitStore {
  return {
    storeName: 'redis',
    incrementWindowCount: () => Promise.reject(new Error('redis is down')),
  };
}

describe('rate limit windows', () => {
  it('hashes the identifier so raw emails or IPs never become keys', () => {
    const bucketKey = buildBucketKey('customer-login', 'asha.verma@demo-store.test');
    expect(bucketKey).toMatch(/^customer-login:[0-9a-f]{64}$/);
    expect(bucketKey).not.toContain('asha');
  });

  it('keeps actions apart for the same identifier', () => {
    expect(buildBucketKey('customer-login', 'x')).not.toBe(buildBucketKey('staff-login', 'x'));
  });

  it('aligns windows to fixed boundaries and reports the seconds left', () => {
    const window = resolveWindow({
      action: 'customer-login',
      identifier: 'x',
      windowSeconds: 60,
      nowMilliseconds: fixedNowMilliseconds,
    });
    expect(window.windowStartedAtMilliseconds).toBe(Date.UTC(2026, 10, 7, 12, 0, 0));
    expect(secondsUntilWindowEnds(window, fixedNowMilliseconds)).toBe(30);
    expect(secondsUntilWindowEnds(window, fixedNowMilliseconds + 29_999)).toBe(1);
  });
});

describe('createRateLimiter', () => {
  it('allows requests up to the limit and rejects the next one', async () => {
    const store = inMemoryStore('redis');
    const consume = createRateLimiter({
      primaryStore: store,
      fallbackStore: inMemoryStore('postgres'),
      currentTimeMilliseconds: () => fixedNowMilliseconds,
      logger: () => silentLogger,
    });
    const decisions = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      decisions.push(await consume({ action: 'customer-login', identifier: 'ip|email', policy }));
    }
    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((decision) => decision.remaining)).toEqual([2, 1, 0, 0]);
    expect(decisions.at(-1)?.retryAfterSeconds).toBe(30);
    expect(decisions.every((decision) => decision.storeName === 'redis')).toBe(true);
  });

  it('starts a fresh count in the next window', async () => {
    let nowMilliseconds = fixedNowMilliseconds;
    const consume = createRateLimiter({
      primaryStore: inMemoryStore('redis'),
      fallbackStore: inMemoryStore('postgres'),
      currentTimeMilliseconds: () => nowMilliseconds,
      logger: () => silentLogger,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await consume({ action: 'customer-login', identifier: 'x', policy });
    }
    nowMilliseconds += 60_000;
    expect(
      (await consume({ action: 'customer-login', identifier: 'x', policy })).requestCount,
    ).toBe(1);
  });

  it('falls back to the second store when the first one fails, and still enforces the limit', async () => {
    const fallbackStore = inMemoryStore('postgres');
    const consume = createRateLimiter({
      primaryStore: failingStore(),
      fallbackStore,
      currentTimeMilliseconds: () => fixedNowMilliseconds,
      logger: () => silentLogger,
    });
    const decisions = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      decisions.push(await consume({ action: 'staff-login', identifier: 'x', policy }));
    }
    expect(decisions.map((decision) => decision.storeName)).toEqual([
      'postgres',
      'postgres',
      'postgres',
      'postgres',
    ]);
    expect(decisions.at(-1)?.allowed).toBe(false);
    expect(fallbackStore.windowsSeen).toHaveLength(4);
  });

  it('fails the request instead of skipping the limit when both stores fail', async () => {
    const consume = createRateLimiter({
      primaryStore: failingStore(),
      fallbackStore: failingStore(),
      currentTimeMilliseconds: () => fixedNowMilliseconds,
      logger: () => silentLogger,
    });
    await expect(consume({ action: 'customer-login', identifier: 'x', policy })).rejects.toThrow(
      'redis is down',
    );
  });
});

describe('RateLimitExceededError', () => {
  it('maps to HTTP 429 with a Retry-After header', () => {
    const error = new RateLimitExceededError(17);
    expect(error.httpStatus).toBe(429);
    expect(error.responseHeaders()).toEqual({ 'Retry-After': '17' });
    expect(error.toEnvelope().error).toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 17 },
    });
  });
});
