import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, parseEnvironment } from '@/lib/env';

const validSource = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ecommerce:ecommerce@localhost:5432/ecommerce',
  ELASTICSEARCH_URL: 'http://localhost:9200',
  ELASTICSEARCH_INDEX_PREFIX: 'test',
  STORE_HOSTS: 'store.localhost:3000, Shop.Example.com',
  ADMIN_HOSTS: 'admin.localhost:3000',
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
  it('parses a valid environment and normalises host lists', () => {
    const environment = parseEnvironment(validSource);
    expect(environment.STORE_HOSTS).toEqual(['store.localhost:3000', 'shop.example.com']);
    expect(environment.ADMIN_HOSTS).toEqual(['admin.localhost:3000']);
    expect(environment.LOG_LEVEL).toBe('info');
  });

  it('reports every missing required variable', () => {
    const issues = parseIssues({});
    for (const variableName of [
      'DATABASE_URL',
      'ELASTICSEARCH_URL',
      'ELASTICSEARCH_INDEX_PREFIX',
      'STORE_HOSTS',
      'ADMIN_HOSTS',
    ]) {
      expect(issues.some((issue) => issue.includes(variableName))).toBe(true);
    }
  });

  it('rejects a database URL that is not Postgres', () => {
    const issues = parseIssues({ ...validSource, DATABASE_URL: 'mysql://localhost/shop' });
    expect(issues.some((issue) => issue.includes('DATABASE_URL'))).toBe(true);
  });

  it('rejects an empty host list', () => {
    const issues = parseIssues({ ...validSource, STORE_HOSTS: ' , ' });
    expect(issues.some((issue) => issue.includes('STORE_HOSTS'))).toBe(true);
  });

  it('rejects a host configured for both surfaces', () => {
    const issues = parseIssues({ ...validSource, ADMIN_HOSTS: 'store.localhost:3000' });
    expect(issues.some((issue) => issue.includes('must not share a host'))).toBe(true);
  });

  it('rejects an unknown log level', () => {
    const issues = parseIssues({ ...validSource, LOG_LEVEL: 'verbose' });
    expect(issues.some((issue) => issue.includes('LOG_LEVEL'))).toBe(true);
  });
});
