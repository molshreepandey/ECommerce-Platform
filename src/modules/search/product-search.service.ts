import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { getLogger } from '@/lib/logger';

import {
  buildElasticsearchProductQuery,
  mapElasticsearchProductResponse,
} from './elasticsearch-product-query';
import { searchProductsInPostgres } from './postgres-product-search.repository';
import type { ProductSearchInput, ProductSearchResult } from './product-search.schema';
import { productSearchAlias } from './product-search-index';

const elasticsearchCooldownMilliseconds = 5_000;
let skipElasticsearchUntil = 0;

// Elasticsearch first; on any failure (unreachable, timeout, missing index, bad response) the same
// request runs on PostgreSQL. After a failure, requests go straight to PostgreSQL for 5 seconds, so an
// outage costs one timeout, not one per request. Shared by search and autocomplete (C14).
export async function withPostgresFallback<Result>(
  elasticsearch: () => Promise<Result>,
  postgres: () => Promise<Result>,
): Promise<Result> {
  if (Date.now() >= skipElasticsearchUntil) {
    try {
      return await elasticsearch();
    } catch (error) {
      skipElasticsearchUntil = Date.now() + elasticsearchCooldownMilliseconds;
      getLogger().warn({ err: error }, 'elasticsearch request failed; using the postgres fallback');
    }
  }
  return postgres();
}

export function searchProducts(input: ProductSearchInput): Promise<ProductSearchResult> {
  return withPostgresFallback(
    async () =>
      mapElasticsearchProductResponse(
        await getElasticsearchClient().search({
          index: productSearchAlias(),
          ...buildElasticsearchProductQuery(input),
        }),
        input.page,
      ),
    () => searchProductsInPostgres(getDatabase(), input),
  );
}

export function resetSearchFallbackCooldown(): void {
  skipElasticsearchUntil = 0;
}
