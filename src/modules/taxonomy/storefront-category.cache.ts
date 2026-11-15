import { cacheLife, cacheTag } from 'next/cache';

import { cacheTags } from '@/lib/cache-tags';

import { loadStorefrontCategoryTree, type StorefrontCategory } from './storefront-category.service';

// Category tree for the storefront: Redis-backed, expired by every category change (docs/redis-design.md
// §4: 1 h revalidate, 1 day expiry).
export async function getStorefrontCategoryTree(): Promise<StorefrontCategory[]> {
  'use cache: remote';
  cacheTag(cacheTags.categories);
  cacheLife({ stale: 300, revalidate: 3600, expire: 86_400 });
  return loadStorefrontCategoryTree();
}
