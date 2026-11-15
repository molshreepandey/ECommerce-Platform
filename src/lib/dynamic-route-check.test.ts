import { describe, expect, it } from 'vitest';
import { classifyDynamicRoute } from './dynamic-route-check';

describe('classifyDynamicRoute', () => {
  it('asks for a database check on store product, category and collection slugs', () => {
    expect(classifyDynamicRoute('store', '/collections/festive-edit')).toEqual({
      kind: 'store-collection',
      slug: 'festive-edit',
    });
    expect(classifyDynamicRoute('store', '/products/linen-kurta')).toEqual({
      kind: 'store-product',
      slug: 'linen-kurta',
    });
    expect(classifyDynamicRoute('store', '/categories/women')).toEqual({
      kind: 'store-category',
      slug: 'women',
    });
  });

  it('answers not found for slugs that cannot exist', () => {
    expect(classifyDynamicRoute('store', '/products/Bad_Slug')).toEqual({ kind: 'not-found' });
    expect(classifyDynamicRoute('store', `/products/${'a'.repeat(121)}`)).toEqual({
      kind: 'not-found',
    });
  });

  it('leaves every other store path alone', () => {
    for (const pathname of ['/', '/products', '/products/a/b', '/search', '/orders/abc', '/cart']) {
      expect(classifyDynamicRoute('store', pathname)).toEqual({ kind: 'none' });
    }
  });

  it('refuses admin order and customer ids that are not UUIDs, without a lookup', () => {
    expect(classifyDynamicRoute('admin', '/orders/missing-order')).toEqual({ kind: 'not-found' });
    expect(classifyDynamicRoute('admin', '/customers/42')).toEqual({ kind: 'not-found' });
    expect(classifyDynamicRoute('admin', '/orders/0195f0a0-0000-7000-8000-000000000001')).toEqual({
      kind: 'none',
    });
    expect(classifyDynamicRoute('admin', '/products/anything')).toEqual({ kind: 'none' });
  });
});
