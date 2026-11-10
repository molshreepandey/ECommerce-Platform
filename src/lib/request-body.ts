import type { z } from 'zod';

import { DomainError } from '@/lib/errors';

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'INVALID_JSON',
      message: 'The request body must be valid JSON.',
    });
  }
  return schema.parse(body);
}
