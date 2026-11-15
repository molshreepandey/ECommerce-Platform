import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import type { CustomerContext, RequestMetadata } from '@/modules/identity/access-control';

// Policy `cart-write` (config rateLimits): one budget per signed-in customer, or per client IP for a guest
// cart. Applied to every cart change, including coupon attempts, so codes cannot be probed quickly.
// A guest whose IP is unknown (no trusted proxy hop configured) is not limited: one shared bucket would let
// a single client block add-to-cart for every guest, and a guest cart only lives in its own cookie (no
// server write; coupons need sign-in). Setting `trustedProxyHopCount` restores the per-IP guest limit.
export async function limitCartWrites(
  customer: CustomerContext | null,
  metadata: RequestMetadata,
): Promise<void> {
  if (customer !== null) {
    await enforceRateLimit({ action: 'cart-write', identifier: `customer|${customer.customerId}` });
    return;
  }
  if (metadata.clientIp === null) return;
  await enforceRateLimit({ action: 'cart-write', identifier: `guest|${metadata.clientIp}` });
}
