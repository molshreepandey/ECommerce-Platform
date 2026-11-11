import type { z } from 'zod';

import { DomainError } from '@/lib/errors';

export const idempotencyKeyHeader = 'Idempotency-Key';

// Reads the Idempotency-Key header that a retried request must repeat unchanged. The caller supplies the
// rule for the key (each feature stores keys in its own table with its own CHECK).
export function idempotencyKeyFrom<Schema extends z.ZodType<string>>(
  request: Request,
  schema: Schema,
): z.infer<Schema> {
  const value = request.headers.get(idempotencyKeyHeader);
  if (value === null || value === '') {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: `Send an ${idempotencyKeyHeader} header with this request.`,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: `The ${idempotencyKeyHeader} header is not valid.`,
      details: { issues: parsed.error.issues.map(({ message }) => message) },
    });
  }
  return parsed.data;
}
