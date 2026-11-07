import { describe, expect, it } from 'vitest';

import {
  assertConnectedDatabaseName,
  assertTestDatabaseUrl,
  assertTestRedisKeyPrefix,
  UnsafeTestTargetError,
} from './test-target-guard';

const developmentUrl = 'postgresql://ecommerce:ecommerce@localhost:5433/ecommerce';
const testUrl = 'postgresql://ecommerce:ecommerce@localhost:5433/ecommerce_test';

describe('assertTestDatabaseUrl', () => {
  it('accepts a database whose name ends with _test', () => {
    expect(assertTestDatabaseUrl(testUrl, developmentUrl)).toBe(testUrl);
  });

  it.each([
    ['the development database', developmentUrl],
    ['a name that only contains _test', 'postgresql://u:p@localhost:5433/ecommerce_test_backup'],
    ['a name with test but no underscore suffix', 'postgresql://u:p@localhost:5433/ecommercetest'],
    ['upper-case suffix tricks', 'postgresql://u:p@localhost:5433/ecommerce_TEST'],
    ['_test hidden in the query string', 'postgresql://u:p@localhost:5433/ecommerce?db=x_test'],
    ['_test hidden in the user name', 'postgresql://x_test:p@localhost:5433/ecommerce'],
    ['an empty database name', 'postgresql://u:p@localhost:5433/'],
    ['a non-Postgres URL', 'mysql://u:p@localhost:3306/shop_test'],
  ])('rejects %s', (_label, candidateUrl) => {
    expect(() => assertTestDatabaseUrl(candidateUrl, developmentUrl)).toThrow(
      UnsafeTestTargetError,
    );
  });

  it('rejects a missing TEST_DATABASE_URL', () => {
    expect(() => assertTestDatabaseUrl(undefined, developmentUrl)).toThrow(/not set/);
    expect(() => assertTestDatabaseUrl('', developmentUrl)).toThrow(/not set/);
  });

  it('rejects a test URL that names the same database as development', () => {
    const sameNameUrl = 'postgresql://other:p@otherhost:5432/shared_test';
    expect(() =>
      assertTestDatabaseUrl(sameNameUrl, 'postgresql://u:p@localhost:5433/shared_test'),
    ).toThrow(/also the development database/);
  });
});

describe('assertConnectedDatabaseName', () => {
  it('accepts a connected _test database', () => {
    expect(() => {
      assertConnectedDatabaseName('ecommerce_test');
    }).not.toThrow();
  });

  it('rejects being connected to the development database', () => {
    expect(() => {
      assertConnectedDatabaseName('ecommerce');
    }).toThrow(UnsafeTestTargetError);
  });
});

describe('assertTestRedisKeyPrefix', () => {
  it('accepts a prefix ending with test:', () => {
    expect(() => {
      assertTestRedisKeyPrefix('ecom:test:');
    }).not.toThrow();
  });

  it.each(['ecom:dev:', 'ecom:production:', 'ecom:latest:', 'ecom:test', 'ecom:contest:'])(
    'rejects %s',
    (keyPrefix) => {
      expect(() => {
        assertTestRedisKeyPrefix(keyPrefix);
      }).toThrow(UnsafeTestTargetError);
    },
  );
});
