import { cacheLife, cacheTag } from 'next/cache';

import { cacheTags } from '@/lib/cache-tags';

import {
  loadAttributeFilterLabels,
  loadStorefrontProduct,
  type StorefrontProduct,
} from './storefront-product.service';

// Product page static data (docs/redis-design.md §4: 5 min revalidate, 1 h expiry), expired by the search
// outbox after every change to the product or a member of its group. Keyed by id, never by slug, so a
// missing slug is never cached.
export async function getStorefrontProduct(productId: string): Promise<StorefrontProduct | null> {
  'use cache: remote';
  cacheTag(cacheTags.product(productId), cacheTags.productTypes);
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  const product = await loadStorefrontProduct(productId);
  if (product !== null && product.productGroupId !== null) {
    cacheTag(cacheTags.productGroup(product.productGroupId));
  }
  return product;
}

export async function getAttributeFilterLabels(): Promise<Record<string, string>> {
  'use cache: remote';
  cacheTag(cacheTags.productTypes);
  cacheLife({ stale: 300, revalidate: 3600, expire: 86_400 });
  return loadAttributeFilterLabels();
}
