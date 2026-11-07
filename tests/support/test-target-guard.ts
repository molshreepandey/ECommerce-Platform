export class UnsafeTestTargetError extends Error {
  constructor(reason: string) {
    super(`Refusing to touch a non-test target: ${reason}`);
    this.name = 'UnsafeTestTargetError';
  }
}

const testDatabaseNamePattern = /^[a-z0-9_]+_test$/;
const testRedisPrefixPattern = /(^|:)test:$/;

export function databaseNameFromUrl(databaseUrl: string): string {
  const parsedUrl = new URL(databaseUrl);
  if (!/^postgres(ql)?:$/.test(parsedUrl.protocol)) {
    throw new UnsafeTestTargetError(`not a PostgreSQL URL (${parsedUrl.protocol})`);
  }
  return decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''));
}

export function assertTestDatabaseUrl(
  candidateUrl: string | undefined,
  developmentDatabaseUrl: string | undefined,
): string {
  if (candidateUrl === undefined || candidateUrl === '') {
    throw new UnsafeTestTargetError('TEST_DATABASE_URL is not set');
  }
  const databaseName = databaseNameFromUrl(candidateUrl);
  if (!testDatabaseNamePattern.test(databaseName)) {
    throw new UnsafeTestTargetError(`database "${databaseName}" does not end with "_test"`);
  }
  if (
    developmentDatabaseUrl !== undefined &&
    developmentDatabaseUrl !== '' &&
    databaseNameFromUrl(developmentDatabaseUrl) === databaseName
  ) {
    throw new UnsafeTestTargetError(`database "${databaseName}" is also the development database`);
  }
  return candidateUrl;
}

export function assertConnectedDatabaseName(currentDatabaseName: string): void {
  if (!testDatabaseNamePattern.test(currentDatabaseName)) {
    throw new UnsafeTestTargetError(`connected to "${currentDatabaseName}", not a _test database`);
  }
}

export function assertTestRedisKeyPrefix(keyPrefix: string): void {
  if (!testRedisPrefixPattern.test(keyPrefix)) {
    throw new UnsafeTestTargetError(`Redis key prefix "${keyPrefix}" does not end with "test:"`);
  }
}
