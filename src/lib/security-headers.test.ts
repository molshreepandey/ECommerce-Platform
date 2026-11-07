import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfigFile } from '@/lib/config/load-config';
import { buildContentSecurityPolicy, buildRuntimeSecurityHeaders } from '@/lib/security-headers';

function committedConfig(name: string) {
  return loadConfigFile(path.resolve(process.cwd(), 'config', `config.${name}.json`));
}

const emptyPolicy = { imageSources: [], connectSources: [], scriptSources: [], frameSources: [] };

describe('buildContentSecurityPolicy', () => {
  it('locks down framing, plugins, base URI and form targets', () => {
    const policy = buildContentSecurityPolicy({
      policy: emptyPolicy,
      isDevelopmentServer: false,
      upgradeInsecureRequests: false,
    });
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-src 'none'");
  });

  it("allows 'unsafe-eval' only for the development server", () => {
    const productionPolicy = buildContentSecurityPolicy({
      policy: emptyPolicy,
      isDevelopmentServer: false,
      upgradeInsecureRequests: true,
    });
    const developmentPolicy = buildContentSecurityPolicy({
      policy: emptyPolicy,
      isDevelopmentServer: true,
      upgradeInsecureRequests: false,
    });
    expect(productionPolicy).not.toContain('unsafe-eval');
    expect(developmentPolicy).toContain("'unsafe-eval'");
    expect(productionPolicy).toContain('upgrade-insecure-requests');
  });

  it('adds configured sources, for example a payment provider later', () => {
    const policy = buildContentSecurityPolicy({
      policy: {
        imageSources: ['https://images.example.com'],
        connectSources: ['https://api.example.com'],
        scriptSources: ['https://checkout.example.com'],
        frameSources: ['https://pay.example.com'],
      },
      isDevelopmentServer: false,
      upgradeInsecureRequests: false,
    });
    expect(policy).toContain("img-src 'self' https://images.example.com");
    expect(policy).toContain("connect-src 'self' https://api.example.com");
    expect(policy).toContain("script-src 'self' 'unsafe-inline' https://checkout.example.com");
    expect(policy).toContain('frame-src https://pay.example.com');
  });
});

describe('buildRuntimeSecurityHeaders', () => {
  it('sends no HSTS for the local http development setup', () => {
    const headers = buildRuntimeSecurityHeaders({
      config: committedConfig('development'),
      surface: 'store',
      isDevelopmentServer: true,
    });
    expect(headers['Strict-Transport-Security']).toBeUndefined();
    expect(headers['Content-Security-Policy']).toContain('https://picsum.photos');
  });

  it('sends a one-year HSTS header with the production configuration', () => {
    const headers = buildRuntimeSecurityHeaders({
      config: committedConfig('production'),
      surface: 'admin',
      isDevelopmentServer: false,
    });
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['Content-Security-Policy']).toContain('upgrade-insecure-requests');
  });
});
