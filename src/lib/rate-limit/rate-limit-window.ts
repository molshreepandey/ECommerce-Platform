import { createHash } from 'node:crypto';

import type { RateLimitAction } from '@/lib/config';

import type { RateLimitWindow } from './rate-limit.types';

const millisecondsPerSecond = 1_000;

export function buildBucketKey(action: RateLimitAction, identifier: string): string {
  const identifierHash = createHash('sha256').update(identifier).digest('hex');
  return `${action}:${identifierHash}`;
}

export function resolveWindow(input: {
  action: RateLimitAction;
  identifier: string;
  windowSeconds: number;
  nowMilliseconds: number;
}): RateLimitWindow {
  const windowMilliseconds = input.windowSeconds * millisecondsPerSecond;
  return {
    bucketKey: buildBucketKey(input.action, input.identifier),
    windowStartedAtMilliseconds:
      Math.floor(input.nowMilliseconds / windowMilliseconds) * windowMilliseconds,
    windowSeconds: input.windowSeconds,
  };
}

export function secondsUntilWindowEnds(window: RateLimitWindow, nowMilliseconds: number): number {
  const windowEndsAtMilliseconds =
    window.windowStartedAtMilliseconds + window.windowSeconds * millisecondsPerSecond;
  return Math.max(
    1,
    Math.ceil((windowEndsAtMilliseconds - nowMilliseconds) / millisecondsPerSecond),
  );
}
