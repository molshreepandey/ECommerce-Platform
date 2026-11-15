import { z } from 'zod';

import { maximumCartLines, maximumQuantityPerLine } from './cart.schema';

export interface GuestCartLine {
  variantId: string;
  quantity: number;
}

const guestCartSchema = z
  .array(
    z.tuple([
      z.uuid().transform((value) => value.toLowerCase()),
      z.int().min(1).max(maximumQuantityPerLine),
    ]),
  )
  .max(maximumCartLines);

// The guest cart (C22) lives in an httpOnly cookie as [[variantId, quantity], …]. Anything malformed is
// treated as an empty cart: the server re-checks every line, so a tampered cookie gains nothing.
export function parseGuestCart(cookieValue: string | undefined): GuestCartLine[] {
  if (cookieValue === undefined || cookieValue === '') return [];
  try {
    const parsed = guestCartSchema.safeParse(
      JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8')),
    );
    if (!parsed.success) return [];
    const quantityByVariant = new Map<string, number>();
    for (const [variantId, quantity] of parsed.data) {
      quantityByVariant.set(
        variantId,
        Math.min(maximumQuantityPerLine, (quantityByVariant.get(variantId) ?? 0) + quantity),
      );
    }
    return [...quantityByVariant].map(([variantId, quantity]) => ({ variantId, quantity }));
  } catch {
    return [];
  }
}

export function serializeGuestCart(lines: readonly GuestCartLine[]): string {
  return Buffer.from(
    JSON.stringify(lines.map((line) => [line.variantId, line.quantity])),
    'utf8',
  ).toString('base64url');
}
