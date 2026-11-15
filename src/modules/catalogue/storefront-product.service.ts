import { z } from 'zod';

import { type DatabaseClient, getDatabase } from '@/lib/db';
import { findAvailabilityForVariants } from '@/modules/inventory/inventory-query.service';

import { listAttributeDefinitions } from './product-type.repository';
import {
  findProductIdBySlug,
  findStorefrontProductRow,
  listFilterableDefinitionLabels,
  listGroupSwatchRows,
} from './storefront-product.repository';

export interface StorefrontAttribute {
  code: string;
  label: string;
  value: string;
}

export interface StorefrontOption {
  code: string;
  label: string;
  values: string[];
}

export interface StorefrontVariant {
  id: string;
  sku: string;
  optionValues: Record<string, string>;
  pricePaise: number;
  mrpPaise: number;
}

export interface StorefrontSwatch {
  productId: string;
  slug: string;
  name: string;
  label: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isCurrent: boolean;
}

export interface StorefrontProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  brand: { name: string; slug: string };
  categoryId: string | null;
  productGroupId: string | null;
  attributes: StorefrontAttribute[];
  options: StorefrontOption[];
  variants: StorefrontVariant[];
  media: { id: string; url: string; altText: string; variantId: string | null }[];
  swatches: StorefrontSwatch[];
}

const optionValuesSchema = z.record(z.string(), z.string());
const attributesSchema = z.record(z.string(), z.unknown());

// How a stored attribute value reads on the product page; empty values are left out.
export function formatAttributeValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts = value.map(formatAttributeValue).filter((part) => part !== null);
    return parts.length === 0 ? null : parts.join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  return null;
}

// Option values in the definition's own order (allowed values), keeping only those an active variant
// has; values outside the allowed list (older data) come last.
export function orderedOptionValues(
  allowedValues: readonly string[] | null,
  used: ReadonlySet<string>,
): string[] {
  const ordered = (allowedValues ?? []).filter((value) => used.has(value));
  const extra = [...used].filter((value) => !ordered.includes(value)).sort();
  return [...ordered, ...extra];
}

export async function findStorefrontProductId(slug: string): Promise<string | null> {
  return (await findProductIdBySlug(getDatabase(), slug))?.id ?? null;
}

// The product page's static data (C15, C16, C18), or null when the storefront must not show the product
// (not ACTIVE, or no ACTIVE variant). Availability is not part of it: it is read live on every request.
export async function loadStorefrontProduct(
  productId: string,
  database: DatabaseClient = getDatabase(),
): Promise<StorefrontProduct | null> {
  const row = await findStorefrontProductRow(database, productId);
  if (row === null || row.status !== 'ACTIVE' || row.variants.length === 0) return null;
  const definitions = (await listAttributeDefinitions(database, row.productTypeId)).filter(
    (definition) => definition.archivedAt === null,
  );
  const attributes = attributesSchema.parse(row.attributes);
  const variants = row.variants.map((variant) => ({
    ...variant,
    optionValues: optionValuesSchema.parse(variant.optionValues),
  }));
  const swatchRows =
    row.productGroupId === null ? [] : await listGroupSwatchRows(database, row.productGroupId);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    brand: row.brand,
    categoryId: row.categoryId,
    productGroupId: row.productGroupId,
    attributes: definitions
      .filter((definition) => definition.scope === 'PRODUCT')
      .flatMap((definition) => {
        const value = formatAttributeValue(attributes[definition.code]);
        return value === null ? [] : [{ code: definition.code, label: definition.label, value }];
      }),
    options: definitions
      .filter((definition) => definition.scope === 'VARIANT_OPTION')
      .map((definition) => ({
        code: definition.code,
        label: definition.label,
        values: orderedOptionValues(
          definition.allowedValues,
          new Set(variants.flatMap((variant) => variant.optionValues[definition.code] ?? [])),
        ),
      }))
      .filter((option) => option.values.length > 0),
    variants,
    media: row.media,
    swatches:
      swatchRows.length < 2
        ? []
        : swatchRows.map((swatch) => ({
            productId: swatch.id,
            slug: swatch.slug,
            name: swatch.name,
            label: swatch.groupSwatchLabel ?? swatch.name,
            imageUrl: swatch.media[0]?.url ?? null,
            imageAlt: swatch.media[0]?.altText ?? null,
            isCurrent: swatch.id === row.id,
          })),
  };
}

// Live availability per variant (C17): available stock summed over active warehouses; no warehouse is
// named to the customer.
export async function loadVariantAvailability(
  variantIds: readonly string[],
): Promise<Record<string, number>> {
  return Object.fromEntries(await findAvailabilityForVariants(getDatabase(), variantIds));
}

// Labels for attribute filters by code; when product types share a code, the first by display order wins.
export async function loadAttributeFilterLabels(
  database: DatabaseClient = getDatabase(),
): Promise<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const definition of await listFilterableDefinitionLabels(database)) {
    labels[definition.code] ??= definition.label;
  }
  return labels;
}
