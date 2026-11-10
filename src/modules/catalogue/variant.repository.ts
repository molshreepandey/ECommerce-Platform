import type { Prisma } from '@/generated/prisma/client';
import type { ProductVariantStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

import { variantSelect, type VariantRow } from './product.repository';

export interface VariantWrite {
  sku: string;
  optionValues: Prisma.InputJsonObject;
  optionSignature: string;
  mrpPaise: number;
  pricePaise: number;
  weightGrams: number;
  lengthMm: number;
  breadthMm: number;
  heightMm: number;
}

export function findVariant(
  database: DatabaseClient,
  variantId: string,
): Promise<VariantRow | null> {
  return database.productVariant.findUnique({ where: { id: variantId }, select: variantSelect });
}

export function insertVariant(
  database: DatabaseClient,
  productId: string,
  data: VariantWrite,
): Promise<VariantRow> {
  return database.productVariant.create({ data: { productId, ...data }, select: variantSelect });
}

// No skipDuplicates: a SKU clash must fail loudly (409), not be skipped silently.
export function insertVariants(
  database: DatabaseClient,
  productId: string,
  rows: readonly VariantWrite[],
): Promise<VariantRow[]> {
  return database.productVariant.createManyAndReturn({
    data: rows.map((row) => ({ productId, ...row })),
    select: variantSelect,
  });
}

// Includes archived variants: their combinations stay taken (restore them instead).
export async function listOptionSignatures(
  database: DatabaseClient,
  productId: string,
): Promise<Set<string>> {
  const rows = await database.productVariant.findMany({
    where: { productId },
    select: { optionSignature: true },
  });
  return new Set(rows.map(({ optionSignature }) => optionSignature));
}

export function updateVariantRow(
  database: DatabaseClient,
  variantId: string,
  data: Partial<
    Pick<
      VariantRow,
      'mrpPaise' | 'pricePaise' | 'weightGrams' | 'lengthMm' | 'breadthMm' | 'heightMm'
    >
  > & { status?: ProductVariantStatus },
): Promise<VariantRow> {
  return database.productVariant.update({ where: { id: variantId }, data, select: variantSelect });
}
