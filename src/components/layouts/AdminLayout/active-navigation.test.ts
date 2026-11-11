import { describe, expect, it } from 'vitest';

import { activeNavigationHref } from './active-navigation';

const hrefs = ['/', '/products', '/inventory', '/inventory/movements', '/inventory/low-stock'];

describe('activeNavigationHref', () => {
  it('picks the most specific matching entry', () => {
    expect(activeNavigationHref('/inventory', hrefs)).toBe('/inventory');
    expect(activeNavigationHref('/inventory/movements', hrefs)).toBe('/inventory/movements');
    expect(activeNavigationHref('/inventory/low-stock', hrefs)).toBe('/inventory/low-stock');
    expect(activeNavigationHref('/products/abc', hrefs)).toBe('/products');
  });

  it('matches the dashboard only on its own path, and nothing for an unknown path', () => {
    expect(activeNavigationHref('/', hrefs)).toBe('/');
    expect(activeNavigationHref('/inventory-old', hrefs)).toBeNull();
    expect(activeNavigationHref('/orders', hrefs)).toBeNull();
  });
});
