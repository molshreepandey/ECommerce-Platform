import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, parseEnvironment } from '@/lib/env';

const validSource = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://ecommerce:ecommerce@localhost:5433/ecommerce_test',
  ELASTICSEARCH_URL: 'http://localhost:9200',
  REDIS_URL: 'redis://localhost:6379',
};

function parseIssues(source: Record<string, string | undefined>): readonly string[] {
  try {
    parseEnvironment(source);
  } catch (error) {
    if (error instanceof InvalidEnvironmentError) return error.issues;
    throw error;
  }
  throw new Error('Expected environment parsing to fail');
}

describe('parseEnvironment', () => {
  it('parses a valid environment', () => {
    const environment = parseEnvironment(validSource);
    expect(environment.APP_ENV).toBe('test');
    expect(environment.APP_CONFIG_PATH).toBeUndefined();
  });

  it('accepts an explicit configuration file path', () => {
    const environment = parseEnvironment({ ...validSource, APP_CONFIG_PATH: '/etc/app.json' });
    expect(environment.APP_CONFIG_PATH).toBe('/etc/app.json');
  });

  it('reports every missing required variable', () => {
    const issues = parseIssues({});
    for (const variableName of ['APP_ENV', 'DATABASE_URL', 'ELASTICSEARCH_URL', 'REDIS_URL']) {
      expect(issues.some((issue) => issue.includes(variableName))).toBe(true);
    }
  });

  it('rejects an unknown application environment', () => {
    const issues = parseIssues({ ...validSource, APP_ENV: 'prod' });
    expect(issues.some((issue) => issue.includes('APP_ENV'))).toBe(true);
  });

  it('rejects a database URL that is not Postgres', () => {
    const issues = parseIssues({ ...validSource, DATABASE_URL: 'mysql://localhost/shop' });
    expect(issues.some((issue) => issue.includes('DATABASE_URL'))).toBe(true);
  });

  it('accepts TLS Redis URLs and rejects other protocols', () => {
    expect(
      parseEnvironment({ ...validSource, REDIS_URL: 'rediss://cache.example.com:6380' }).REDIS_URL,
    ).toBe('rediss://cache.example.com:6380');
    const issues = parseIssues({ ...validSource, REDIS_URL: 'http://localhost:6379' });
    expect(issues.some((issue) => issue.includes('REDIS_URL'))).toBe(true);
  });

  it('rejects an Elasticsearch URL that is not http or https', () => {
    const issues = parseIssues({ ...validSource, ELASTICSEARCH_URL: 'ftp://localhost:9200' });
    expect(issues.some((issue) => issue.includes('ELASTICSEARCH_URL'))).toBe(true);
  });
});
