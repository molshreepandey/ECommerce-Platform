import type { NextRequest } from 'next/server';
import type { z } from 'zod';

// Query strings arrive as text; the schema coerces (for example z.coerce.number()) and validates once.
export function parseSearchParams<Schema extends z.ZodType>(
  request: NextRequest,
  schema: Schema,
): z.infer<Schema> {
  return schema.parse(Object.fromEntries(request.nextUrl.searchParams));
}
