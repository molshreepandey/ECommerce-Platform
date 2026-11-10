import { isIP } from 'node:net';

// Each trusted proxy appends the address it received the request from, so the client is the entry
// `trustedProxyHopCount` places from the right; anything further left was written by the client.
export function clientIpAddress(headers: Headers, trustedProxyHopCount: number): string | null {
  if (!Number.isSafeInteger(trustedProxyHopCount) || trustedProxyHopCount < 1) return null;
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor === null) return null;
  const clientEntry = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .at(-trustedProxyHopCount);
  if (clientEntry === undefined || isIP(clientEntry) === 0) return null;
  return clientEntry;
}
