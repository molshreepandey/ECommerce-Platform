import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DomainError } from '@/lib/errors';

import { idempotencyKeyFrom, idempotencyKeyHeader } from './request-idempotency';

const keySchema = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/);

function requestWith(key?: string): Request {
  const headers = new Headers();
  if (key !== undefined) headers.set(idempotencyKeyHeader, key);
  return new Request('https://admin.example.test/api/admin/inventory/adjustments', {
    method: 'POST',
    headers,
  });
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DomainError) return `${error.httpStatus} ${error.code}`;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('idempotencyKeyFrom', () => {
  it('returns a key that matches the rule, whatever the header case', () => {
    const request = new Request('https://admin.example.test/x', {
      method: 'POST',
      headers: { 'idempotency-key': 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' },
    });
    expect(idempotencyKeyFrom(request, keySchema)).toBe('a1b2c3d4-e5f6-7890-abcd-ef0123456789');
  });

  it('answers 400 IDEMPOTENCY_KEY_REQUIRED when the header is missing or empty', () => {
    expect(codeOf(() => idempotencyKeyFrom(requestWith(), keySchema))).toBe(
      '400 IDEMPOTENCY_KEY_REQUIRED',
    );
    expect(codeOf(() => idempotencyKeyFrom(requestWith(''), keySchema))).toBe(
      '400 IDEMPOTENCY_KEY_REQUIRED',
    );
  });

  it('answers 400 IDEMPOTENCY_KEY_INVALID for a key that breaks the rule', () => {
    for (const key of [
      'short',
      'has spaces in the key!!',
      'x'.repeat(101),
      'kéy-with-accents-123',
    ]) {
      expect(
        codeOf(() => idempotencyKeyFrom(requestWith(key), keySchema)),
        key,
      ).toBe('400 IDEMPOTENCY_KEY_INVALID');
    }
  });
});
