import { afterAll, describe, expect, it } from 'vitest';

import { getConfig } from '@/lib/config';
import { closeRedisClient, runRedisCommand } from '@/lib/redis';

import { UnsafeTestTargetError } from '../support/test-target-guard';
import { currentDatabaseName, truncateAllTestTables } from './support/test-database';
import { deleteTestRedisKeys } from './support/test-redis';

const developmentKeyPrefix = 'ecom:dev:';
const decoyDevelopmentKey = `${developmentKeyPrefix}integration-harness-decoy`;

afterAll(async () => {
  await runRedisCommand((client) => client.del(decoyDevelopmentKey));
  await closeRedisClient();
});

describe('integration test harness', () => {
  it('runs against the _test database with the test configuration', async () => {
    expect(await currentDatabaseName()).toBe('ecommerce_test');
    expect(getConfig().redis.keyPrefix).toBe('ecom:test:');
  });

  it('refuses to truncate when DATABASE_URL points at the development database', async () => {
    const testDatabaseUrl = process.env['DATABASE_URL'];
    process.env['DATABASE_URL'] = process.env['INTEGRATION_DEVELOPMENT_DATABASE_URL'];
    try {
      await expect(truncateAllTestTables()).rejects.toThrow(UnsafeTestTargetError);
    } finally {
      process.env['DATABASE_URL'] = testDatabaseUrl;
    }
  });

  it('truncates every table in the test database except migration history', async () => {
    await truncateAllTestTables();
    const counts = await import('@/lib/db').then(({ getDatabase }) =>
      Promise.all([getDatabase().customer.count(), getDatabase().rateLimitCounter.count()]),
    );
    expect(counts).toEqual([0, 0]);
  });

  it('deletes only keys under the test Redis prefix', async () => {
    const testKey = `${getConfig().redis.keyPrefix}integration-harness-probe`;
    await runRedisCommand((client) => client.set(testKey, '1'));
    await runRedisCommand((client) => client.set(decoyDevelopmentKey, '1'));

    const deletedKeyCount = await deleteTestRedisKeys();

    expect(deletedKeyCount).toBeGreaterThanOrEqual(1);
    expect(await runRedisCommand((client) => client.exists(testKey))).toBe(0);
    expect(await runRedisCommand((client) => client.exists(decoyDevelopmentKey))).toBe(1);
  });
});
