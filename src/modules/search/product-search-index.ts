import type { estypes } from '@elastic/elasticsearch';

import { buildIndexName } from '@/lib/elasticsearch';

// The storefront reads the alias; each full reindex builds `<alias>_v<n+1>` and swaps the alias to it.
export function productSearchAlias(): string {
  return buildIndexName('products');
}

export function productSearchIndexName(version: number): string {
  return `${productSearchAlias()}_v${String(version)}`;
}

const textWithKeyword = {
  type: 'text',
  analyzer: 'product_text',
  fields: { keyword: { type: 'keyword', ignore_above: 256 } },
} as const;

export const productSearchSettings: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  analysis: {
    analyzer: {
      product_text: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding'],
      },
    },
  },
};

// Plan §9.5. Filterable attributes are nested {code, value} pairs, so a new attribute never adds a field
// to the mapping; `dynamic: strict` refuses any document that does not match it.
export const productSearchMappings: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    productId: { type: 'keyword' },
    slug: { type: 'keyword' },
    name: textWithKeyword,
    brand: {
      properties: { id: { type: 'keyword' }, name: textWithKeyword, slug: { type: 'keyword' } },
    },
    categoryIds: { type: 'keyword' },
    categoryNames: { type: 'text', analyzer: 'product_text' },
    productType: { properties: { id: { type: 'keyword' }, code: { type: 'keyword' } } },
    attributes: {
      type: 'nested',
      properties: { code: { type: 'keyword' }, value: { type: 'keyword' } },
    },
    searchableText: { type: 'text', analyzer: 'product_text' },
    minPricePaise: { type: 'integer' },
    maxPricePaise: { type: 'integer' },
    mrpPaise: { type: 'integer' },
    availableQuantity: { type: 'integer' },
    inStock: { type: 'boolean' },
    rating: { type: 'float' },
    reviewCount: { type: 'integer' },
    groupId: { type: 'keyword' },
    status: { type: 'keyword' },
    createdAt: { type: 'date' },
    imageUrl: { type: 'keyword', index: false },
    imageAlt: { type: 'keyword', index: false },
  },
};
