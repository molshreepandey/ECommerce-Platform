import type { ProductDocumentRow } from './product-search-document.repository';

export interface ProductSearchDocument {
  productId: string;
  slug: string;
  name: string;
  brand: { id: string; name: string; slug: string };
  categoryIds: string[];
  categoryNames: string[];
  productType: { id: string; code: string };
  attributes: { code: string; value: string }[];
  searchableText: string[];
  minPricePaise: number;
  maxPricePaise: number;
  mrpPaise: number;
  availableQuantity: number;
  inStock: boolean;
  rating: number | null;
  reviewCount: number;
  groupId: string | null;
  status: 'ACTIVE';
  createdAt: string;
  imageUrl: string | null;
  imageAlt: string | null;
}

// A stored attribute value as filter text: arrays (MULTI_ENUM) give one value each; numbers and booleans
// become their text form. Anything else is not filterable.
export function attributeValueTexts(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(attributeValueTexts);
  if (typeof value === 'string') return value.trim() === '' ? [] : [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  return [];
}

function uniquePairs(pairs: readonly { code: string; value: string }[]) {
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.code}\u0000${pair.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Shown on the storefront only when ACTIVE with at least one ACTIVE variant; otherwise null, and the
// product is removed from the index.
export function buildProductSearchDocument(row: ProductDocumentRow): ProductSearchDocument | null {
  const [cheapest] = row.variants;
  if (row.status !== 'ACTIVE' || cheapest === undefined) return null;
  const productPairs = (
    scopeFilter: (definition: ProductDocumentRow['definitions'][number]) => boolean,
  ) =>
    row.definitions.filter(scopeFilter).flatMap((definition) =>
      definition.scope === 'PRODUCT'
        ? attributeValueTexts(row.attributes[definition.code]).map((value) => ({
            code: definition.code,
            value,
          }))
        : row.variants.flatMap((variant) =>
            attributeValueTexts(variant.optionValues[definition.code]).map((value) => ({
              code: definition.code,
              value,
            })),
          ),
    );
  const availableQuantity = row.variants.reduce(
    (total, variant) => total + Math.max(0, variant.availableQuantity),
    0,
  );
  return {
    productId: row.id,
    slug: row.slug,
    name: row.name,
    brand: { id: row.brand_id, name: row.brand_name, slug: row.brand_slug },
    categoryIds: row.categories.map(({ id }) => id),
    categoryNames: row.categories.map(({ name }) => name),
    productType: { id: row.product_type_id, code: row.product_type_code },
    attributes: uniquePairs(productPairs((definition) => definition.isFilterable)),
    searchableText: [
      ...new Set(productPairs((definition) => definition.isSearchable).map(({ value }) => value)),
    ],
    minPricePaise: cheapest.pricePaise,
    maxPricePaise: Math.max(...row.variants.map((variant) => variant.pricePaise)),
    mrpPaise: cheapest.mrpPaise,
    availableQuantity,
    inStock: availableQuantity > 0,
    rating: row.rating,
    reviewCount: row.review_count,
    groupId: row.product_group_id,
    status: 'ACTIVE',
    createdAt: row.created_at.toISOString(),
    imageUrl: row.image_url,
    imageAlt: row.image_alt,
  };
}
