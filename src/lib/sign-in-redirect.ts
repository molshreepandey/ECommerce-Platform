import type { Surface } from './host-routing';

const signInPath = '/login';
const storeSignInRequiredPrefixes = ['/account', '/checkout', '/orders'] as const;
const adminPublicPaths = new Set([signInPath]);

function requiresSignIn(surface: Surface, pathname: string): boolean {
  if (surface === 'admin') return !adminPublicPaths.has(pathname);
  return storeSignInRequiredPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

// Optimistic check only: it looks at whether a session cookie exists, never whether it is valid.
// Pages and APIs still verify the session against the database.
export function signInRedirectPath(input: {
  surface: Surface;
  pathname: string;
  search: string;
  hasSessionCookie: boolean;
}): string | null {
  if (input.hasSessionCookie || !requiresSignIn(input.surface, input.pathname)) return null;
  if (input.pathname === '/') return signInPath;
  return `${signInPath}?next=${encodeURIComponent(`${input.pathname}${input.search}`)}`;
}
