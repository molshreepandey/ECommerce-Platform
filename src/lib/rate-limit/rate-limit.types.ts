import type { RateLimitAction, RateLimitPolicy } from '@/lib/config';

export type RateLimitStoreName = 'redis' | 'postgres';

export interface RateLimitWindow {
  bucketKey: string;
  windowStartedAtMilliseconds: number;
  windowSeconds: number;
}

export interface RateLimitStore {
  readonly storeName: RateLimitStoreName;
  incrementWindowCount(window: RateLimitWindow): Promise<number>;
}

export interface RateLimitRequest {
  action: RateLimitAction;
  identifier: string;
  policy: RateLimitPolicy;
}

export interface RateLimitDecision {
  allowed: boolean;
  requestCount: number;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  storeName: RateLimitStoreName;
}
