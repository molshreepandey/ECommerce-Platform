import { type DatabaseClient, getDatabase } from '@/lib/db';
import type { StaffContext } from '@/modules/identity/access-control';

import { findChangeRequest, insertChangeRequestIfNew } from './change-request.repository';
import { inventoryErrors } from './inventory.errors';
import { movementsForChangeRequest } from './inventory-movement.repository';
import { fingerprintStockRequest, type StockRequestOperation } from './request-fingerprint';
import {
  type RecordedMovement,
  stockRequestResult,
  type StockRequestResult,
} from './stock-request-result';

// Runs one staff stock request exactly once per (staff member, idempotency key), inside the caller's
// transaction, so the request row, the stock change, the movements and the audit rows commit or roll
// back together. The fingerprint covers the operation type and the validated input.
//
// - New key: `apply` runs with the new request id; its movements must reference that id.
// - Key already used with the same fingerprint: nothing is applied; the original result is rebuilt from
//   that request's own movements and returned with `replayed: true`.
// - Key already used with a different fingerprint (other content or another operation): 422.
// - A duplicate arriving while the first is still running waits on the unique index: it replays if the
//   first commits, and runs as a new request if the first rolls back (a failure leaves no request row).
export async function runIdempotentStockRequest(
  transaction: DatabaseClient,
  request: {
    staff: StaffContext;
    idempotencyKey: string;
    operation: StockRequestOperation;
    input: unknown;
  },
  apply: (changeRequestId: string) => Promise<readonly RecordedMovement[]>,
): Promise<StockRequestResult> {
  const requestFingerprint = fingerprintStockRequest(request.operation, request.input);
  const identity = {
    staffUserId: request.staff.staffUserId,
    idempotencyKey: request.idempotencyKey,
  };
  const changeRequestId = await insertChangeRequestIfNew(transaction, {
    ...identity,
    requestFingerprint,
  });
  if (changeRequestId !== null) {
    const movements = await apply(changeRequestId);
    return stockRequestResult({
      changeRequestId,
      operation: request.operation,
      replayed: false,
      movements,
    });
  }
  // The insert found a committed row for this key (a statement after it sees that commit).
  const existing = await findChangeRequest(transaction, identity);
  if (existing === null) {
    throw new Error('An idempotency conflict was reported but no request row is visible');
  }
  if (existing.requestFingerprint !== requestFingerprint)
    throw inventoryErrors.idempotencyKeyReused();
  return stockRequestResult({
    changeRequestId: existing.id,
    operation: request.operation,
    replayed: true,
    movements: await movementsForChangeRequest(transaction, existing.id),
  });
}

// Opens the one transaction that holds the request row, the stock change, the movements and their audit
// rows. Any error inside `apply` rolls all of it back, including the request row.
export function idempotentStockChange(
  request: Parameters<typeof runIdempotentStockRequest>[1],
  apply: (
    transaction: DatabaseClient,
    changeRequestId: string,
  ) => Promise<readonly RecordedMovement[]>,
): Promise<StockRequestResult> {
  return getDatabase().$transaction((transaction) =>
    runIdempotentStockRequest(transaction, request, (changeRequestId) =>
      apply(transaction, changeRequestId),
    ),
  );
}
