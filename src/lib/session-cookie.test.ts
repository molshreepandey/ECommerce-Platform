import { NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadWithSecureCookies(secureCookies: boolean) {
  vi.resetModules();
  vi.doMock('@/lib/config', () => ({
    getConfig: () => ({ authentication: { secureCookies } }),
  }));
  return import('@/lib/session-cookie');
}

afterEach(() => {
  vi.doUnmock('@/lib/config');
});

describe('session cookies', () => {
  it('use plain names and no Secure flag over local http', async () => {
    const { sessionCookieName, setSessionCookie } = await loadWithSecureCookies(false);
    expect(sessionCookieName('store')).toBe('store_session');
    expect(sessionCookieName('admin')).toBe('admin_session');
    const response = NextResponse.json({});
    setSessionCookie(response, 'store', {
      sessionToken: 'abc',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/^store_session=abc;/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/Domain=/i);
    expect(header).not.toMatch(/Secure/i);
  });

  it('use the __Host- prefix and Secure in staging and production', async () => {
    const { sessionCookieName, setSessionCookie } = await loadWithSecureCookies(true);
    expect(sessionCookieName('admin')).toBe('__Host-admin_session');
    const response = NextResponse.json({});
    setSessionCookie(response, 'admin', {
      sessionToken: 'abc',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/^__Host-admin_session=abc;/);
    expect(header).toMatch(/Secure/i);
  });

  it('clear the cookie with Max-Age=0', async () => {
    const { clearSessionCookie } = await loadWithSecureCookies(false);
    const response = NextResponse.json({});
    clearSessionCookie(response, 'store');
    expect(response.headers.get('set-cookie') ?? '').toMatch(/^store_session=;.*Max-Age=0/i);
  });
});
