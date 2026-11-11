import { createHash } from 'node:crypto';

export type StockRequestOperation = 'ADJUST_ADD' | 'ADJUST_REMOVE' | 'ADJUST_SET' | 'RECEIPT';

// Canonical JSON: object keys sorted at every level and undefined properties left out, so the same
// request always serialises the same way. Only plain JSON values are accepted.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Only finite numbers can be fingerprinted');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  throw new TypeError(`Cannot fingerprint a value of type ${typeof value}`);
}

// SHA-256 (lower-case hex, the format inventory_change_requests.request_fingerprint enforces) of the
// operation type and the validated, normalised input: the same key reused for another operation or
// with different content never matches.
export function fingerprintStockRequest(operation: StockRequestOperation, input: unknown): string {
  return createHash('sha256').update(canonicalJson({ operation, input })).digest('hex');
}
