import type { Surface } from './host-routing';

export type DynamicRouteCheck =
  | { kind: 'store-product'; slug: string }
  | { kind: 'store-category'; slug: string }
  | { kind: 'store-collection'; slug: string }
  | { kind: 'not-found' }
  | { kind: 'none' };

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const adminUuidRoutes = /^\/(orders|customers)\/([^/]+)$/;

// With Cache Components and partial prefetching, a dynamic page sends its static shell (and a 200) before
// it can call notFound(), so the proxy decides real 404s for the public detail URLs (Next docs: "check
// the slug in Proxy"). Only the shape is checked here; the proxy looks store slugs up in the database.
export function classifyDynamicRoute(surface: Surface, pathname: string): DynamicRouteCheck {
  if (surface === 'admin') {
    const match = adminUuidRoutes.exec(pathname);
    if (match === null) return { kind: 'none' };
    return uuidPattern.test(match[2] ?? '') ? { kind: 'none' } : { kind: 'not-found' };
  }
  const match = /^\/(products|categories|collections)\/([^/]+)$/.exec(pathname);
  if (match === null) return { kind: 'none' };
  const slug = decodeURIComponent(match[2] ?? '');
  if (slug.length > 120 || !slugPattern.test(slug)) return { kind: 'not-found' };
  if (match[1] === 'products') return { kind: 'store-product', slug };
  if (match[1] === 'collections') return { kind: 'store-collection', slug };
  return { kind: 'store-category', slug };
}
