import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import type { StorefrontCategory } from '@/modules/taxonomy/storefront-category.service';

import { suggestProductsInPostgres } from './postgres-product-search.repository';
import { productSearchAlias } from './product-search-index';
import { maximumSearchTextLength } from './product-search.schema';
import { withPostgresFallback } from './product-search.service';

const productSuggestionLimit = 6;
const categorySuggestionLimit = 4;

export const suggestQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(maximumSearchTextLength),
});

export interface SearchSuggestions {
  products: { name: string; slug: string }[];
  categories: { name: string; slug: string }[];
}

const suggestionHitsSchema = z.object({
  hits: z.object({
    hits: z.array(z.object({ _source: z.object({ name: z.string(), slug: z.string() }) })),
  }),
});

async function productsFromElasticsearch(text: string) {
  const response = await getElasticsearchClient().search({
    index: productSearchAlias(),
    size: productSuggestionLimit,
    _source: ['name', 'slug'],
    query: {
      bool: {
        must: [{ match_phrase_prefix: { name: { query: text, max_expansions: 50 } } }],
        filter: [{ term: { status: 'ACTIVE' } }],
      },
    },
  });
  return suggestionHitsSchema.parse(response).hits.hits.map(({ _source }) => _source);
}

function matchingCategories(
  tree: readonly StorefrontCategory[],
  text: string,
): { name: string; slug: string }[] {
  const lower = text.toLowerCase();
  const flat: StorefrontCategory[] = [];
  const walk = (nodes: readonly StorefrontCategory[]) => {
    for (const node of nodes) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(tree);
  return flat
    .filter(({ name }) => name.toLowerCase().includes(lower))
    .sort(
      (left, right) =>
        Number(right.name.toLowerCase().startsWith(lower)) -
          Number(left.name.toLowerCase().startsWith(lower)) || left.level - right.level,
    )
    .slice(0, categorySuggestionLimit)
    .map(({ name, slug }) => ({ name, slug }));
}

// C14 (Wave 16): product names by prefix from Elasticsearch (PostgreSQL while it is down) and matching
// storefront categories. Only sellable products and active categories are suggested.
export async function suggestSearch(
  text: string,
  categoryTree: readonly StorefrontCategory[],
): Promise<SearchSuggestions> {
  const products = await withPostgresFallback(
    () => productsFromElasticsearch(text),
    () => suggestProductsInPostgres(getDatabase(), text, productSuggestionLimit),
  );
  return { products, categories: matchingCategories(categoryTree, text) };
}
