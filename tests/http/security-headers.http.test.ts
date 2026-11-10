import { describe, expect, it } from 'vitest';

import { adminHost, getPage, storeHost } from './app-server';

const isDevelopmentServer = process.env['TEST_SERVER_MODE'] === 'development';

const staticHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

describe('security headers', () => {
  it.each([
    ['store home page', storeHost, '/'],
    ['admin sign-in redirect', adminHost, '/'],
    ['admin sign-in page', adminHost, '/login'],
    ['store 404 page', storeHost, '/no-such-page'],
    ['health API', storeHost, '/api/health'],
  ])('are present on the %s', async (_label, host, pathname) => {
    const response = await getPage(host, pathname);
    for (const [name, value] of Object.entries(staticHeaders)) {
      expect(response.headers[name]).toBe(value);
    }
    const contentSecurityPolicy = String(response.headers['content-security-policy']);
    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    // next dev needs 'unsafe-eval' for React Refresh (TD-006); a production build must never send it.
    if (isDevelopmentServer) expect(contentSecurityPolicy).toContain("'unsafe-eval'");
    else expect(contentSecurityPolicy).not.toContain('unsafe-eval');
  });

  it('do not send HSTS for plain-http local origins', async () => {
    const response = await getPage(storeHost, '/');
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('lock down 404s for unknown hosts completely', async () => {
    const response = await getPage('unknown.localhost', '/');
    expect(response.status).toBe(404);
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
  });
});
