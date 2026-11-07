import { describe, expect, it } from 'vitest';

import { decideHostRouting, resolveSurfaceForHost } from '@/lib/host-routing';

const surfaceHosts = {
  storeHosts: ['store.localhost:3000', 'shop.example.com'],
  adminHosts: ['admin.localhost:3000', 'admin.example.com'],
};

function route(host: string | null, pathname: string) {
  return decideHostRouting({ host, pathname }, surfaceHosts);
}

describe('resolveSurfaceForHost', () => {
  it('matches hosts case-insensitively', () => {
    expect(resolveSurfaceForHost('STORE.localhost:3000', surfaceHosts)).toBe('store');
    expect(resolveSurfaceForHost('admin.example.com', surfaceHosts)).toBe('admin');
  });

  it('returns null for an unknown host', () => {
    expect(resolveSurfaceForHost('localhost:3000', surfaceHosts)).toBeNull();
  });
});

describe('decideHostRouting on the store host', () => {
  it('rewrites the home page to the store surface', () => {
    expect(route('store.localhost:3000', '/')).toEqual({
      kind: 'rewrite',
      pathname: '/store',
      surface: 'store',
    });
  });

  it('rewrites nested pages under the store surface', () => {
    expect(route('shop.example.com', '/products/blue-kurta')).toEqual({
      kind: 'rewrite',
      pathname: '/store/products/blue-kurta',
      surface: 'store',
    });
  });

  it('keeps admin pages unreachable by rewriting them inside the store surface', () => {
    expect(route('store.localhost:3000', '/admin')).toEqual({
      kind: 'rewrite',
      pathname: '/store/admin',
      surface: 'store',
    });
  });

  it('allows store APIs and the health check', () => {
    expect(route('store.localhost:3000', '/api/store/cart')).toEqual({
      kind: 'continue',
      surface: 'store',
    });
    expect(route('store.localhost:3000', '/api/health')).toEqual({
      kind: 'continue',
      surface: 'store',
    });
  });

  it('returns not found for admin APIs and courier webhooks', () => {
    expect(route('store.localhost:3000', '/api/admin/products')).toEqual({ kind: 'not_found' });
    expect(route('store.localhost:3000', '/api/webhooks/courier/demo_courier')).toEqual({
      kind: 'not_found',
    });
  });
});

describe('decideHostRouting on the admin host', () => {
  it('rewrites pages to the admin surface', () => {
    expect(route('admin.localhost:3000', '/orders')).toEqual({
      kind: 'rewrite',
      pathname: '/admin/orders',
      surface: 'admin',
    });
  });

  it('allows admin APIs and courier webhooks', () => {
    expect(route('admin.example.com', '/api/admin/orders')).toEqual({
      kind: 'continue',
      surface: 'admin',
    });
    expect(route('admin.example.com', '/api/webhooks/courier/demo_courier')).toEqual({
      kind: 'continue',
      surface: 'admin',
    });
  });

  it('returns not found for store APIs', () => {
    expect(route('admin.localhost:3000', '/api/store/cart')).toEqual({ kind: 'not_found' });
  });
});

describe('decideHostRouting on an unknown host', () => {
  it('returns not found for pages and APIs', () => {
    expect(route('localhost:3000', '/')).toEqual({ kind: 'not_found' });
    expect(route('evil.example.com', '/api/health')).toEqual({ kind: 'not_found' });
  });

  it('returns not found when the host header is missing', () => {
    expect(route(null, '/')).toEqual({ kind: 'not_found' });
  });

  it('does not treat lookalike API prefixes as allowed', () => {
    expect(route('store.localhost:3000', '/api/healthcheck')).toEqual({ kind: 'not_found' });
    expect(route('store.localhost:3000', '/api/storefront')).toEqual({ kind: 'not_found' });
  });
});
