import { cacheLife, cacheTag } from 'next/cache';

import { cacheTags } from '@/lib/cache-tags';

import type { StoreBranding } from './store-branding.schema';
import { loadStoreBranding } from './store-branding.service';

export async function getStoreBranding(): Promise<StoreBranding> {
  'use cache: remote';
  cacheTag(cacheTags.storeBranding);
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  return loadStoreBranding();
}
