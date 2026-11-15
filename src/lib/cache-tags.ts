import type { Logger } from 'pino';

import { getLogger } from '@/lib/logger';
import { buildRedisKey, runRedisCommand } from '@/lib/redis';

// Tags carried by the 'use cache: remote' catalogue reads (docs/redis-design.md §4).
export const cacheTags = {
  categories: 'categories',
  productTypes: 'product-types',
  storeSettings: 'store-settings',
  storeBranding: 'store-branding',
  merchandising: 'merchandising',
  product: (productId: string) => `product:${productId.toLowerCase()}`,
  productGroup: (groupId: string) => `product-group:${groupId.toLowerCase()}`,
} as const;

// The Redis hash the remote cache handler (cache-handlers/redis-cache-handler.mjs) reads on every request:
// field = tag, value = {"stale": ms, "expired": ms}. Both must use the same key and value format.
export function cacheTagHashKey(): string {
  return buildRedisKey('cache', 'v1', 'tags');
}

// Expires the tags at once for every app instance. Unlike revalidateTag, it works outside a request
// (after(), the search:sync script). Throws when Redis is unavailable, so a caller can retry later.
export async function expireCacheTags(tags: readonly string[]): Promise<void> {
  const uniqueTags = [...new Set(tags)];
  if (uniqueTags.length === 0) return;
  const now = Date.now();
  const timestamps = JSON.stringify({ stale: now, expired: now });
  await runRedisCommand((client) =>
    client.hSet(cacheTagHashKey(), Object.fromEntries(uniqueTags.map((tag) => [tag, timestamps]))),
  );
}

// After a committed admin change to rarely changing reference data: a Redis outage only leaves the cached
// copy until its own expiry (docs/redis-design.md §5.2), so the failure is logged, not thrown.
export async function expireCacheTagsAfterCommit(
  tags: readonly string[],
  logger: Logger = getLogger(),
): Promise<void> {
  try {
    await expireCacheTags(tags);
  } catch (error) {
    logger.warn({ err: error, tags }, 'cache tag invalidation failed');
  }
}
