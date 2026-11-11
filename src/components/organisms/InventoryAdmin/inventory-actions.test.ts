import { describe, expect, it } from 'vitest';

import type { ApiFailure } from '@/lib/api-client';

import { inventoryFailureMessage } from './inventory-actions';

function failure(status: number, code: string, details: unknown = null): ApiFailure {
  return { status, code, message: `server says ${code}`, fieldErrors: {}, details };
}

describe('inventoryFailureMessage', () => {
  it('names the numbers in stock conflicts', () => {
    expect(
      inventoryFailureMessage(
        failure(409, 'STALE_STOCK', { expectedOnHandQuantity: 7, currentOnHandQuantity: 12 }),
      ),
    ).toBe(
      'The stock changed while you were editing: on hand is now 12, not 7. Check the new number and try again.',
    );
    expect(
      inventoryFailureMessage(
        failure(409, 'STOCK_BELOW_RESERVED', {
          onHandQuantity: 4,
          reservedQuantity: 3,
          requestedOnHandQuantity: 2,
        }),
      ),
    ).toBe('This would leave 2 on hand, but 3 are reserved for orders.');
    expect(
      inventoryFailureMessage(
        failure(409, 'STOCK_BELOW_RESERVED', {
          onHandQuantity: 10,
          reservedQuantity: 0,
          requestedOnHandQuantity: -40,
        }),
      ),
    ).toBe('You cannot remove more than is on hand (10).');
    expect(
      inventoryFailureMessage(
        failure(422, 'ON_HAND_LIMIT_EXCEEDED', { maximumOnHandQuantity: 1_000_000 }),
      ),
    ).toContain('(10,00,000)');
  });

  it('tells the person how long to wait when rate limited', () => {
    expect(inventoryFailureMessage(failure(429, 'RATE_LIMITED', { retryAfterSeconds: 7 }))).toBe(
      'Too many changes in a short time. Wait 7 seconds and try again.',
    );
  });

  it('keeps a timeout message, hides other server errors, and explains permission refusals', () => {
    expect(inventoryFailureMessage(failure(503, 'TRANSACTION_TIMEOUT'))).toBe(
      'server says TRANSACTION_TIMEOUT',
    );
    for (const unknown of [
      failure(500, 'INTERNAL_ERROR'),
      failure(502, 'UNEXPECTED_RESPONSE'),
      failure(0, 'NETWORK_ERROR'),
    ]) {
      expect(inventoryFailureMessage(unknown), unknown.code).toBe(
        'The server did not confirm this change, so it may or may not have been saved. Check the numbers on the page; sending the same change again will not apply it twice.',
      );
    }
    expect(inventoryFailureMessage(failure(403, 'PERMISSION_DENIED'))).toBe(
      'You do not have permission to make this change.',
    );
    expect(inventoryFailureMessage(failure(422, 'NO_STOCK_CHANGE'))).toBe(
      'server says NO_STOCK_CHANGE',
    );
  });
});
