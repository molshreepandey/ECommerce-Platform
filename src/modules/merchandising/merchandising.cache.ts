import { cacheLife, cacheTag } from 'next/cache';

import { cacheTags } from '@/lib/cache-tags';

import { loadHomeMerchandising } from './merchandising.service';

// Banners and collections for the home page, expired by every merchandising change.
export async function getHomeMerchandising() {
  'use cache: remote';
  cacheTag(cacheTags.merchandising);
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  return loadHomeMerchandising();
}
