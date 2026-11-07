export type Surface = 'store' | 'admin';

export interface SurfaceHosts {
  storeHosts: readonly string[];
  adminHosts: readonly string[];
}

export type HostRoutingDecision =
  | { kind: 'rewrite'; pathname: string; surface: Surface }
  | { kind: 'continue'; surface: Surface }
  | { kind: 'not_found' };

const sharedApiPrefixes = ['/api/health'] as const;
const apiPrefixesBySurface: Record<Surface, readonly string[]> = {
  store: ['/api/store/'],
  admin: ['/api/admin/', '/api/webhooks/'],
};

export function resolveSurfaceForHost(host: string, surfaceHosts: SurfaceHosts): Surface | null {
  const normalizedHost = host.trim().toLowerCase();
  if (surfaceHosts.storeHosts.includes(normalizedHost)) return 'store';
  if (surfaceHosts.adminHosts.includes(normalizedHost)) return 'admin';
  return null;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

function isApiPathAllowedOnSurface(pathname: string, surface: Surface): boolean {
  if (sharedApiPrefixes.some((prefix) => matchesPrefix(pathname, prefix))) return true;
  return apiPrefixesBySurface[surface].some((prefix) => pathname.startsWith(prefix));
}

export function decideHostRouting(
  request: { host: string | null; pathname: string },
  surfaceHosts: SurfaceHosts,
): HostRoutingDecision {
  if (request.host === null) return { kind: 'not_found' };
  const surface = resolveSurfaceForHost(request.host, surfaceHosts);
  if (surface === null) return { kind: 'not_found' };

  if (matchesPrefix(request.pathname, '/api')) {
    return isApiPathAllowedOnSurface(request.pathname, surface)
      ? { kind: 'continue', surface }
      : { kind: 'not_found' };
  }

  const surfacePathname =
    request.pathname === '/' ? `/${surface}` : `/${surface}${request.pathname}`;
  return { kind: 'rewrite', pathname: surfacePathname, surface };
}
