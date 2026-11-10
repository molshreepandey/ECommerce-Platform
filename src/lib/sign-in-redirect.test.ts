import { describe, expect, it } from 'vitest';

import { signInRedirectPath } from './sign-in-redirect';

const signedOut = { search: '', hasSessionCookie: false } as const;

describe('signInRedirectPath on the store', () => {
  it.each(['/', '/login', '/register', '/products', '/accounting'])(
    'leaves the public page %s alone',
    (pathname) => {
      expect(signInRedirectPath({ ...signedOut, surface: 'store', pathname })).toBeNull();
    },
  );

  it('sends a signed-out visitor from an account page to sign-in, remembering where they were', () => {
    expect(
      signInRedirectPath({
        surface: 'store',
        pathname: '/account/addresses',
        search: '?from=checkout',
        hasSessionCookie: false,
      }),
    ).toBe('/login?next=%2Faccount%2Faddresses%3Ffrom%3Dcheckout');
    expect(signInRedirectPath({ ...signedOut, surface: 'store', pathname: '/account' })).toBe(
      '/login?next=%2Faccount',
    );
  });

  it('lets a visitor with a session cookie through for the page to verify', () => {
    expect(
      signInRedirectPath({
        surface: 'store',
        pathname: '/account',
        search: '',
        hasSessionCookie: true,
      }),
    ).toBeNull();
  });
});

describe('signInRedirectPath on the admin site', () => {
  it('protects every admin page except sign-in by default', () => {
    expect(signInRedirectPath({ ...signedOut, surface: 'admin', pathname: '/' })).toBe('/login');
    expect(signInRedirectPath({ ...signedOut, surface: 'admin', pathname: '/orders/42' })).toBe(
      '/login?next=%2Forders%2F42',
    );
    expect(signInRedirectPath({ ...signedOut, surface: 'admin', pathname: '/login' })).toBeNull();
  });

  it('lets a visitor with a session cookie through', () => {
    expect(
      signInRedirectPath({ surface: 'admin', pathname: '/', search: '', hasSessionCookie: true }),
    ).toBeNull();
  });
});
