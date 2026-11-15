import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import type { RequestMetadata } from '@/modules/identity/access-control';

// Policy `public-search` (L5): search and autocomplete are public, so the budget is per client IP. With no
// trusted proxy hop configured the IP is unknown, and one shared bucket would let a single client switch
// search off for everyone, so then nothing is limited (the same rule as guest cart writes).
export async function limitPublicSearch(metadata: RequestMetadata): Promise<void> {
  if (metadata.clientIp === null) return;
  await enforceRateLimit({ action: 'public-search', identifier: metadata.clientIp });
}
