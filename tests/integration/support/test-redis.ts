import { getConfig } from '@/lib/config';
import { runRedisCommand } from '@/lib/redis';

import { assertTestRedisKeyPrefix } from '../../support/test-target-guard';

export async function deleteTestRedisKeys(): Promise<number> {
  const { keyPrefix } = getConfig().redis;
  assertTestRedisKeyPrefix(keyPrefix);
  return runRedisCommand(async (client) => {
    let deletedKeyCount = 0;
    for await (const keys of client.scanIterator({ MATCH: `${keyPrefix}*`, COUNT: 200 })) {
      if (keys.length > 0) deletedKeyCount += await client.unlink(keys);
    }
    return deletedKeyCount;
  });
}
