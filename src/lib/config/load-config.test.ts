import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from './config.schema';
import {
  InvalidConfigError,
  loadConfigFile,
  parseConfig,
  resolveConfigFilePath,
} from './load-config';

const committedConfigDirectory = path.resolve(process.cwd(), 'config');

function readCommittedConfig(appEnvironment: string): AppConfig {
  return loadConfigFile(path.join(committedConfigDirectory, `config.${appEnvironment}.json`));
}

function configIssues(rawConfig: unknown): readonly string[] {
  try {
    parseConfig('inline.json', rawConfig);
  } catch (error) {
    if (error instanceof InvalidConfigError) return error.issues;
    throw error;
  }
  throw new Error('Expected configuration parsing to fail');
}

function cloneDevelopmentConfig(): AppConfig {
  return structuredClone(readCommittedConfig('development'));
}

describe('resolveConfigFilePath', () => {
  it('selects config/config.<APP_ENV>.json under the project root', () => {
    expect(
      resolveConfigFilePath({
        appEnvironment: 'staging',
        explicitConfigFilePath: undefined,
        projectRoot: '/srv/app',
      }),
    ).toBe('/srv/app/config/config.staging.json');
  });

  it('prefers an explicit APP_CONFIG_PATH at runtime', () => {
    expect(
      resolveConfigFilePath({
        appEnvironment: 'production',
        explicitConfigFilePath: '/etc/ecommerce/config.json',
        projectRoot: '/srv/app',
      }),
    ).toBe('/etc/ecommerce/config.json');
  });
});

describe('committed configuration files', () => {
  it.each(['development', 'test', 'staging', 'production'])('config.%s.json is valid', (name) => {
    expect(() => readCommittedConfig(name)).not.toThrow();
  });

  it.each(['staging', 'production'])('config.%s.json is safe for a hosted deployment', (name) => {
    const config = readCommittedConfig(name);
    expect(config.surfaces.store.publicOrigin).toMatch(/^https:\/\//);
    expect(config.surfaces.admin.publicOrigin).toMatch(/^https:\/\//);
    expect(config.security.strictTransportSecurityMaxAgeSeconds).toBeGreaterThan(0);
    expect(['debug', 'trace']).not.toContain(config.logging.level);
  });

  it('production uses a one-year HSTS max-age', () => {
    const config = readCommittedConfig('production');
    expect(config.security.strictTransportSecurityMaxAgeSeconds).toBeGreaterThanOrEqual(31_536_000);
  });

  it('gives every environment its own Redis key prefix and search index prefix', () => {
    const configs = ['development', 'test', 'staging', 'production'].map(readCommittedConfig);
    expect(new Set(configs.map((config) => config.redis.keyPrefix)).size).toBe(4);
    expect(new Set(configs.map((config) => config.elasticsearch.indexPrefix)).size).toBe(4);
  });
});

describe('parseConfig validation', () => {
  it('rejects unknown keys so typos are caught at startup', () => {
    const rawConfig = { ...cloneDevelopmentConfig(), loging: { level: 'info' } };
    expect(configIssues(rawConfig).join('\n')).toMatch(/loging/);
  });

  it('rejects a host shared by the store and admin surfaces', () => {
    const config = cloneDevelopmentConfig();
    config.surfaces.admin.hosts = ['store.localhost:3000'];
    expect(configIssues(config).join('\n')).toMatch(/must not share a host/);
  });

  it('rejects an empty host list for a surface', () => {
    const config = cloneDevelopmentConfig();
    config.surfaces.store.hosts = [];
    expect(configIssues(config).join('\n')).toMatch(/surfaces\.store\.hosts/);
  });

  it('rejects an unknown log level', () => {
    const config = cloneDevelopmentConfig();
    expect(configIssues({ ...config, logging: { level: 'verbose' } }).join('\n')).toMatch(
      /logging\.level/,
    );
  });

  it('rejects a Redis key prefix without a trailing colon', () => {
    const config = cloneDevelopmentConfig();
    config.redis.keyPrefix = 'ecom:dev';
    expect(configIssues(config).join('\n')).toMatch(/redis\.keyPrefix/);
  });

  it('rejects a non-https content-security source', () => {
    const config = cloneDevelopmentConfig();
    config.security.contentSecurityPolicy.imageSources = ['http://insecure.example.com'];
    expect(configIssues(config).join('\n')).toMatch(/imageSources/);
  });

  it('rejects a missing rate-limit policy', () => {
    const config = cloneDevelopmentConfig();
    const rateLimitsWithoutStaffLogin = Object.fromEntries(
      Object.entries(config.rateLimits).filter(([action]) => action !== 'staff-login'),
    );
    expect(configIssues({ ...config, rateLimits: rateLimitsWithoutStaffLogin }).join('\n')).toMatch(
      /staff-login/,
    );
  });
});

describe('loadConfigFile', () => {
  it('reports unreadable or malformed files as configuration errors', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'config-test-'));
    const malformedFilePath = path.join(directory, 'broken.json');
    writeFileSync(malformedFilePath, '{ not json');
    expect(() => loadConfigFile(malformedFilePath)).toThrow(InvalidConfigError);
    expect(() => loadConfigFile(path.join(directory, 'missing.json'))).toThrow(InvalidConfigError);
  });
});
