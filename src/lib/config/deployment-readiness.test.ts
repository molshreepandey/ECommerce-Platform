import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { demoCredentialsPermitted } from '@/modules/identity/demo-credentials';

import { rateLimitActions } from './config.schema';
import { loadConfigFile } from './load-config';

// Wave 15 local deployment-readiness checks: the committed staging and production configuration keeps
// every safety property a deployment relies on (checked without starting a server or touching a database).
const load = (name: string) =>
  loadConfigFile(path.resolve(process.cwd(), 'config', `config.${name}.json`));

describe.each(['staging', 'production'])('config.%s.json is safe to deploy', (name) => {
  const config = load(name);

  it('refuses demo accounts, even if a flag were flipped, and uses secure cookies', () => {
    expect(config.authentication.demoAccountsAllowed).toBe(false);
    expect(demoCredentialsPermitted({ configAllows: true, appEnvironment: name })).toBe(false);
    expect(config.authentication.secureCookies).toBe(true);
  });

  it('trusts no proxy headers until the real proxy topology is verified (owner rule)', () => {
    expect(config.authentication.trustedProxyHopCount).toBe(0);
  });

  it('loads no third-party scripts, frames or connections and only https images', () => {
    expect(config.security.contentSecurityPolicy.scriptSources).toEqual([]);
    expect(config.security.contentSecurityPolicy.frameSources).toEqual([]);
    expect(config.security.contentSecurityPolicy.connectSources).toEqual([]);
    for (const source of config.security.contentSecurityPolicy.imageSources) {
      expect(source).toMatch(/^(https:\/\/|data:$|blob:$)/);
    }
  });

  it('rate-limits every limited action and hashes passwords at the OWASP minimum or above', () => {
    expect(Object.keys(config.rateLimits).sort()).toEqual([...rateLimitActions].sort());
    expect(config.authentication.passwordHashing.memoryCostKib).toBeGreaterThanOrEqual(19_456);
  });
});

describe('production specifics', () => {
  it('keeps HSTS for a year', () => {
    expect(load('production').security.strictTransportSecurityMaxAgeSeconds).toBeGreaterThanOrEqual(
      31_536_000,
    );
  });
});
