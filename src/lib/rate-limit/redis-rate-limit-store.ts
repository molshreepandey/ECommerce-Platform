import { z } from 'zod';

import { buildRedisKey, runRedisCommand } from '@/lib/redis';

import type { RateLimitStore, RateLimitWindow } from './rate-limit.types';

const keyExpiryGraceMilliseconds = 1_000;

// One round trip and atomic: the expiry is set when the key is created, and repaired if a key ever lacks one.
const incrementWindowScript = `
local requestCount = redis.call('INCR', KEYS[1])
if requestCount == 1 or redis.call('PTTL', KEYS[1]) == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return requestCount
`;

const requestCountReplySchema = z.int().min(1);

export function buildRateLimitRedisKey(window: RateLimitWindow): string {
  return buildRedisKey(
    'ratelimit',
    'v1',
    window.bucketKey,
    String(window.windowStartedAtMilliseconds),
  );
}

export const redisRateLimitStore: RateLimitStore = {
  storeName: 'redis',
  async incrementWindowCount(window) {
    const expiryMilliseconds = window.windowSeconds * 1_000 + keyExpiryGraceMilliseconds;
    const reply = await runRedisCommand((client) =>
      client.eval(incrementWindowScript, {
        keys: [buildRateLimitRedisKey(window)],
        arguments: [String(expiryMilliseconds)],
      }),
    );
    return requestCountReplySchema.parse(reply);
  },
};
