import { describe, expect, it } from 'vitest';

import { adminHost, getPage, placeholderAdminCookie, storeHost, visibleMarkup } from './app-server';

const storeMarkers = ['Back to the store', 'ShopSphere'];
const adminMarkers = ['This admin page does not exist', 'Back to the dashboard'];

describe('unmatched URLs on the store host', () => {
  it.each(['/no-such-page', '/deep/nested/missing/path', '/admin', '/admin/orders'])(
    '%s returns 404 with the store not-found page rendered on the server',
    async (pathname) => {
      const response = await getPage(storeHost, pathname);
      const markup = visibleMarkup(response.text);

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/^text\/html/);
      expect(markup).toContain('<title>Page not found · ShopSphere</title>');
      expect(markup).toMatch(/<h1[^>]*>Page not found<\/h1>/);
      for (const marker of storeMarkers) expect(markup).toContain(marker);
      for (const marker of adminMarkers) expect(markup).not.toContain(marker);
    },
  );

  it('returns the same 404 on a repeat request', async () => {
    const firstResponse = await getPage(storeHost, '/repeat-check');
    const secondResponse = await getPage(storeHost, '/repeat-check');
    expect([firstResponse.status, secondResponse.status]).toEqual([404, 404]);
    expect(visibleMarkup(secondResponse.text)).toContain('Back to the store');
  });
});

describe('unmatched URLs on the admin host', () => {
  it.each(['/no-such-page', '/orders/missing-order', '/store'])(
    '%s returns 404 with the admin not-found page rendered on the server',
    async (pathname) => {
      const response = await getPage(adminHost, pathname, placeholderAdminCookie);
      const markup = visibleMarkup(response.text);

      expect(response.status).toBe(404);
      expect(markup).toContain('<title>Page not found · Admin</title>');
      expect(markup).toMatch(/<h1[^>]*>Page not found<\/h1>/);
      expect(markup).toContain('<nav');
      for (const marker of adminMarkers) expect(markup).toContain(marker);
      for (const marker of storeMarkers) expect(markup).not.toContain(marker);
    },
  );
});

describe('matched pages are unaffected', () => {
  it('serves the store home page and the admin sign-in page with 200', async () => {
    const storeHome = await getPage(storeHost, '/');
    const adminSignIn = await getPage(adminHost, '/login');
    expect(storeHome.status).toBe(200);
    expect(visibleMarkup(storeHome.text)).toContain('<title>ShopSphere</title>');
    expect(adminSignIn.status).toBe(200);
    expect(visibleMarkup(adminSignIn.text)).toContain('<title>Sign in · Admin</title>');
  });

  it('sends a signed-out visitor on an unknown admin URL to sign-in instead of revealing a 404', async () => {
    const response = await getPage(adminHost, '/no-such-page');
    expect(response.status).toBe(307);
    expect(response.headers['location']).toBe(
      'http://admin.localhost:3100/login?next=%2Fno-such-page',
    );
  });
});

describe('requests that never reach a surface', () => {
  it('returns a plain 404 for an unknown host', async () => {
    const response = await getPage('localhost:3000', '/');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('Back to the store');
  });

  it('returns the JSON error envelope for an API on the wrong host', async () => {
    const response = await getPage(storeHost, '/api/admin/products');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });
});
