import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { suggestProductsInPostgres } from '@/modules/search/postgres-product-search.repository';
import {
  refreshProductSearchIndex,
  syncProductsToSearchIndex,
} from '@/modules/search/product-search-index.service';
import { productSearchAlias } from '@/modules/search/product-search-index';
import { resetSearchFallbackCooldown } from '@/modules/search/product-search.service';
import { suggestQuerySchema, suggestSearch } from '@/modules/search/search-suggest.service';
import { loadStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.service';

import { createVariantRow } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function namedProduct(name: string, slug: string) {
  const created = await createVariantRow();
  await database.product.update({ where: { id: created.productId }, data: { name, slug } });
  return created.productId;
}

async function category(name: string, slug: string) {
  return database.category.create({
    data: { name, slug, level: 1, path: `/${slug}/` },
    select: { id: true },
  });
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('search autocomplete (C14)', () => {
  it('suggests sellable products by name prefix from Elasticsearch, and matching categories', async () => {
    const client = getElasticsearchClient();
    const existing = Object.keys(
      await client.indices.get({ index: `${productSearchAlias()}_v*`, allow_no_indices: true }),
    );
    if (existing.length > 0) await client.indices.delete({ index: existing });
    const kurta = await namedProduct('Linen Kurta Indigo', 'linen-kurta-indigo');
    const shirt = await namedProduct('Linen Shirt', 'linen-shirt');
    const archived = await namedProduct('Linen Dupatta', 'linen-dupatta');
    await database.product.update({
      where: { id: archived },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await namedProduct('Silk Saree', 'silk-saree');
    await category('Linen wear', 'linen-wear');
    await syncProductsToSearchIndex([kurta, shirt, archived]);
    await refreshProductSearchIndex();
    resetSearchFallbackCooldown();
    const suggestions = await suggestSearch('line', await loadStorefrontCategoryTree());
    expect(suggestions.products.map(({ slug }) => slug).sort()).toEqual([
      'linen-kurta-indigo',
      'linen-shirt',
    ]);
    expect(suggestions.categories).toEqual([{ name: 'Linen wear', slug: 'linen-wear' }]);
    expect((await suggestSearch('linen ku', [])).products.map(({ slug }) => slug)).toEqual([
      'linen-kurta-indigo',
    ]);
  });

  it('the PostgreSQL fallback suggests the same sellable products, prefix matches first', async () => {
    await namedProduct('Kurta Linen', 'kurta-linen');
    await namedProduct('Linen Kurta', 'linen-kurta');
    const archived = await namedProduct('Linen Archive', 'linen-archive');
    await database.product.update({
      where: { id: archived },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    expect((await suggestProductsInPostgres(database, 'linen', 6)).map(({ slug }) => slug)).toEqual(
      ['linen-kurta', 'kurta-linen'],
    );
    expect(await suggestProductsInPostgres(database, '%', 6)).toEqual([]);
  });

  it('needs 2 to 100 characters', () => {
    expect(suggestQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(suggestQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(suggestQuerySchema.parse({ q: '  ku ' })).toEqual({ q: 'ku' });
  });
});
