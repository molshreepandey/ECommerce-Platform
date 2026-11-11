import { describe, expect, it } from 'vitest';

import { Prisma } from '@/generated/prisma/client';
import { isTransactionTimeout } from '@/lib/db';

import { TransactionTimeoutError } from './errors';

function prismaError(code: string, message: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
    ...(meta === undefined ? {} : { meta }),
  });
}

// P2028 messages built from the templates in Prisma 7.10.1 (runtime/client.js: TransactionManagerError and
// its subclasses). Template placeholders are filled with example values (timings, adapter name, the
// internal-consistency detail); the classification depends only on the fixed wording.
const expired =
  'Transaction API error: A query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5512 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.';
const notStarted = 'Transaction API error: Unable to start a transaction in the given time.';
const notTimeouts = [
  'Transaction API error: Transaction already closed: A query cannot be executed on a committed transaction.',
  'Transaction API error: Transaction already closed: A commit cannot be executed on a transaction that was rolled back.',
  'Transaction API error: Nested transactions are not supported by adapter "@prisma/adapter-pg" (postgres): createSavepoint is not implemented.',
  'Transaction API error: Internal Consistency Error: something unexpected',
  "Transaction API error: Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting.",
];

describe('transaction timeouts', () => {
  it('recognises the two genuine timeouts: an expired transaction and one that could not start in time', () => {
    expect(
      isTransactionTimeout(
        prismaError('P2028', expired, { operation: 'query', timeout: 5000, timeTaken: 5512 }),
      ),
    ).toBe(true);
    expect(isTransactionTimeout(prismaError('P2028', notStarted))).toBe(true);
  });

  it('does not treat other P2028 errors, other codes or plain errors as timeouts', () => {
    for (const message of notTimeouts) {
      expect(isTransactionTimeout(prismaError('P2028', message)), message).toBe(false);
    }
    expect(isTransactionTimeout(prismaError('P2002', expired))).toBe(false);
    expect(isTransactionTimeout(new Error(expired))).toBe(false);
  });

  it('answers 503 TRANSACTION_TIMEOUT, retryable, with Retry-After and no internal detail', () => {
    const error = new TransactionTimeoutError();
    expect(error.httpStatus).toBe(503);
    expect(error.responseHeaders()).toEqual({ 'Retry-After': '1' });
    expect(error.toEnvelope()).toEqual({
      error: {
        code: 'TRANSACTION_TIMEOUT',
        message: 'The server was busy and nothing was changed. Try again.',
        details: { retryable: true },
      },
    });
  });
});
