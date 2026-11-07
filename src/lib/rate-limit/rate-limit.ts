import type { Logger } from 'pino';

import { getConfig, type RateLimitAction } from '@/lib/config';
import { DomainError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';

import { postgresRateLimitStore } from './rate-limit.repository';
import type { RateLimitDecision, RateLimitRequest, RateLimitStore } from './rate-limit.types';
import { resolveWindow, secondsUntilWindowEnds } from './rate-limit-window';
import { redisRateLimitStore } from './redis-rate-limit-store';

export class RateLimitExceededError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super({
      kind: 'RATE_LIMITED',
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please wait and try again.',
      details: { retryAfterSeconds },
    });
  }

  override responseHeaders(): Record<string, string> {
    return { 'Retry-After': String(this.retryAfterSeconds) };
  }
}

export interface RateLimiterDependencies {
  primaryStore: RateLimitStore;
  fallbackStore: RateLimitStore;
  currentTimeMilliseconds: () => number;
  logger: () => Logger;
}

const fallbackLogIntervalMilliseconds = 30_000;
let lastFallbackLoggedAt = 0;
let fallbacksSinceLastLog = 0;

function logFallback(dependencies: RateLimiterDependencies, error: unknown): void {
  fallbacksSinceLastLog += 1;
  const now = dependencies.currentTimeMilliseconds();
  if (now - lastFallbackLoggedAt < fallbackLogIntervalMilliseconds) return;
  dependencies.logger().warn(
    {
      reason: error instanceof Error ? error.message : String(error),
      fallbackStore: dependencies.fallbackStore.storeName,
      fallbacksSinceLastLog,
    },
    'rate limit store fallback',
  );
  lastFallbackLoggedAt = now;
  fallbacksSinceLastLog = 0;
}

async function incrementWithFallback(
  dependencies: RateLimiterDependencies,
  window: Parameters<RateLimitStore['incrementWindowCount']>[0],
): Promise<{ requestCount: number; store: RateLimitStore }> {
  try {
    return {
      requestCount: await dependencies.primaryStore.incrementWindowCount(window),
      store: dependencies.primaryStore,
    };
  } catch (error) {
    logFallback(dependencies, error);
    return {
      requestCount: await dependencies.fallbackStore.incrementWindowCount(window),
      store: dependencies.fallbackStore,
    };
  }
}

export function createRateLimiter(dependencies: RateLimiterDependencies) {
  return async function consumeRateLimit(request: RateLimitRequest): Promise<RateLimitDecision> {
    const nowMilliseconds = dependencies.currentTimeMilliseconds();
    const window = resolveWindow({
      action: request.action,
      identifier: request.identifier,
      windowSeconds: request.policy.windowSeconds,
      nowMilliseconds,
    });
    const { requestCount, store } = await incrementWithFallback(dependencies, window);
    return {
      allowed: requestCount <= request.policy.maxRequests,
      requestCount,
      limit: request.policy.maxRequests,
      remaining: Math.max(0, request.policy.maxRequests - requestCount),
      retryAfterSeconds: secondsUntilWindowEnds(window, nowMilliseconds),
      storeName: store.storeName,
    };
  };
}

const consumeWithDefaultStores = createRateLimiter({
  primaryStore: redisRateLimitStore,
  fallbackStore: postgresRateLimitStore,
  currentTimeMilliseconds: () => Date.now(),
  logger: getLogger,
});

export async function enforceRateLimit(input: {
  action: RateLimitAction;
  identifier: string;
}): Promise<RateLimitDecision> {
  const decision = await consumeWithDefaultStores({
    ...input,
    policy: getConfig().rateLimits[input.action],
  });
  if (!decision.allowed) throw new RateLimitExceededError(decision.retryAfterSeconds);
  return decision;
}
