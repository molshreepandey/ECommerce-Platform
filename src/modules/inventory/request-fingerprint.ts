import { createHash } from 'node:crypto';

import { canonicalJson } from '@/lib/canonical-json';

export { canonicalJson } from '@/lib/canonical-json';

export type StockRequestOperation =
  'ADJUST_ADD' | 'ADJUST_REMOVE' | 'ADJUST_SET' | 'RECEIPT' | 'TRANSFER';

// SHA-256 (lower-case hex, the format inventory_change_requests.request_fingerprint enforces) of the
// operation type and the validated, normalised input: the same key reused for another operation or
// with different content never matches.
export function fingerprintStockRequest(operation: StockRequestOperation, input: unknown): string {
  return createHash('sha256').update(canonicalJson({ operation, input })).digest('hex');
}
