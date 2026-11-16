import type { z } from 'zod';

import { DomainError } from '@/lib/errors';

// Every JSON route reads at most this much. The largest legitimate body is a CSV import (1 MB of text,
// which JSON escaping and UTF-8 can roughly triple), so 4 MB refuses nothing real while keeping an
// unauthenticated client from making the server buffer an arbitrarily large body (API-7).
export const maximumJsonBodyBytes = 4 * 1024 * 1024;

export async function parseJsonBody<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const text = await readTextWithin(request, maximumJsonBodyBytes);
  if (text === null) {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'BODY_TOO_LARGE',
      message: 'The request body is too large.',
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'INVALID_JSON',
      message: 'The request body must be valid JSON.',
    });
  }
  return schema.parse(body);
}

// The raw text of a body of at most `maximumBytes`, or null when it is larger. A declared Content-Length
// is checked before anything is read, and streaming stops as soon as the limit is passed, so an oversized
// (or chunked) body is never buffered whole.
export async function readTextWithin(
  request: Request,
  maximumBytes: number,
): Promise<string | null> {
  const declaredLength = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
