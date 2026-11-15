import { z } from 'zod';

import { type DatabaseClient, getDatabase } from '@/lib/db';

import { findPurchasableVariantRows } from './storefront-product.repository';

export interface PurchasableVariant {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  brandName: string;
  sku: string;
  optionValues: Record<string, string>;
  imageUrl: string | null;
  imageAlt: string | null;
  unitPricePaise: number;
  mrpPaise: number;
  taxRateBasisPoints: number;
  isSellable: boolean;
  weightGrams: number;
  lengthMm: number;
  breadthMm: number;
  heightMm: number;
  category: { id: string; name: string; path: string } | null;
  productGroupId: string | null;
}

const optionValuesSchema = z.record(z.string(), z.string());

// Variant details the cart and checkout need, keyed by lower-case variant id. A variant is sellable only
// while it and its product are ACTIVE; missing ids are simply absent from the map.
export async function findPurchasableVariants(
  variantIds: readonly string[],
  database: DatabaseClient = getDatabase(),
): Promise<Map<string, PurchasableVariant>> {
  if (variantIds.length === 0) return new Map();
  const rows = await findPurchasableVariantRows(database, [
    ...new Set(variantIds.map((variantId) => variantId.toLowerCase())),
  ]);
  return new Map(
    rows.map((row) => {
      const image = row.media[0] ?? row.product.media[0] ?? null;
      return [
        row.id,
        {
          variantId: row.id,
          productId: row.product.id,
          productSlug: row.product.slug,
          productName: row.product.name,
          brandName: row.product.brand.name,
          sku: row.sku,
          optionValues: optionValuesSchema.parse(row.optionValues),
          imageUrl: image?.url ?? null,
          imageAlt: image?.altText ?? null,
          unitPricePaise: row.pricePaise,
          mrpPaise: row.mrpPaise,
          taxRateBasisPoints: row.product.taxRateBasisPoints,
          isSellable: row.status === 'ACTIVE' && row.product.status === 'ACTIVE',
          weightGrams: row.weightGrams,
          lengthMm: row.lengthMm,
          breadthMm: row.breadthMm,
          heightMm: row.heightMm,
          category: row.product.category,
          productGroupId: row.product.productGroupId,
        },
      ];
    }),
  );
}
