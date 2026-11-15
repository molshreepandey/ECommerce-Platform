import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { searchProductsInPostgres } from '@/modules/search/postgres-product-search.repository';
import type { ProductSearchInput } from '@/modules/search/product-search.schema';
import {
  refreshProductSearchIndex,
  syncProductsToSearchIndex,
} from '@/modules/search/product-search-index.service';
import { productSearchAlias } from '@/modules/search/product-search-index';
import {
  resetSearchFallbackCooldown,
  searchProducts,
} from '@/modules/search/product-search.service';

import {
  createStockLevelRow,
  createVariantRow,
  createWarehouseRow,
} from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

function query(overrides: Partial<ProductSearchInput> = {}): ProductSearchInput {
  return {
    text: undefined,
    category: null,
    brandSlugs: [],
    minPricePaise: undefined,
    maxPricePaise: undefined,
    inStockOnly: false,
    minimumRating: undefined,
    sort: 'relevance',
    page: 1,
    attributeFilters: [],
    ...overrides,
  };
}

async function category(slug: string, parent: { id: string; path: string; level: number } | null) {
  return database.category.create({
    data: {
      slug,
      name: slug,
      parentId: parent?.id ?? null,
      level: (parent?.level ?? 0) + 1,
      path: `${parent?.path ?? '/'}${slug}/`,
    },
    select: { id: true, path: true, level: true },
  });
}

// A sellable product with a filterable "fabric" attribute, a price and optional stock and category.
async function product(input: {
  pricePaise: number;
  fabric: string;
  categoryId?: string;
  stock?: number;
}) {
  const created = await createVariantRow();
  const productRow = await database.product.update({
    where: { id: created.productId },
    data: {
      attributes: { fabric: input.fabric },
      ...(input.categoryId === undefined
        ? {}
        : { categoryId: input.categoryId, taggingStatus: 'TAGGED' }),
    },
    select: { productTypeId: true, slug: true },
  });
  await database.attributeDefinition.create({
    data: {
      productTypeId: productRow.productTypeId,
      code: 'fabric',
      label: 'Fabric',
      dataType: 'ENUM',
      scope: 'PRODUCT',
      isFilterable: true,
      allowedValues: ['Cotton', 'Silk'],
    },
  });
  await database.productVariant.update({
    where: { id: created.variantId },
    data: { pricePaise: input.pricePaise, mrpPaise: input.pricePaise + 10_000 },
  });
  if (input.stock !== undefined) {
    const warehouse = await createWarehouseRow();
    await createStockLevelRow({
      variantId: created.variantId,
      warehouseId: warehouse.id,
      onHandQuantity: input.stock,
    });
  }
  return { ...created, slug: productRow.slug };
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('PostgreSQL search (the fallback while Elasticsearch is down)', () => {
  it('a category includes its descendants (C7)', async () => {
    const apparel = await category('apparel', null);
    const women = await category('women', apparel);
    const shoes = await category('shoes', null);
    const kurta = await product({ pricePaise: 50_000, fabric: 'Cotton', categoryId: women.id });
    await product({ pricePaise: 60_000, fabric: 'Silk', categoryId: shoes.id });
    const result = await searchProductsInPostgres(
      database,
      query({ category: { id: apparel.id, path: apparel.path } }),
    );
    expect(result.hits.map(({ productId }) => productId)).toEqual([kurta.productId]);
  });

  it('sorts by price, filters by attribute and hides archived products', async () => {
    const cheap = await product({ pricePaise: 30_000, fabric: 'Cotton' });
    const dear = await product({ pricePaise: 90_000, fabric: 'Silk' });
    const archived = await product({ pricePaise: 10_000, fabric: 'Cotton' });
    await database.product.update({
      where: { id: archived.productId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    const ascending = await searchProductsInPostgres(database, query({ sort: 'price_asc' }));
    expect(ascending.hits.map(({ productId }) => productId)).toEqual([
      cheap.productId,
      dear.productId,
    ]);
    const silk = await searchProductsInPostgres(
      database,
      query({ attributeFilters: [{ code: 'fabric', values: ['Silk'] }] }),
    );
    expect(silk.hits.map(({ productId }) => productId)).toEqual([dear.productId]);
  });

  it('returns facet counts for brands and attribute values (C10)', async () => {
    await product({ pricePaise: 30_000, fabric: 'Cotton' });
    await product({ pricePaise: 40_000, fabric: 'Cotton' });
    await product({ pricePaise: 50_000, fabric: 'Silk' });
    const result = await searchProductsInPostgres(database, query());
    expect(result.facets.attributes).toEqual([
      {
        code: 'fabric',
        values: [
          { value: 'Cotton', count: 2 },
          { value: 'Silk', count: 1 },
        ],
      },
    ]);
    expect(result.facets.brands.every(({ count }) => count === 1)).toBe(true);
  });

  it('in-stock only leaves out products with nothing available', async () => {
    const stocked = await product({ pricePaise: 30_000, fabric: 'Cotton', stock: 3 });
    await product({ pricePaise: 40_000, fabric: 'Cotton' });
    const result = await searchProductsInPostgres(database, query({ inStockOnly: true }));
    expect(result.hits.map(({ productId }) => productId)).toEqual([stocked.productId]);
  });
});

describe('Elasticsearch search', () => {
  it('a product appears after sync with facet counts, and disappears once archived', async () => {
    const client = getElasticsearchClient();
    const existing = Object.keys(
      await client.indices.get({ index: `${productSearchAlias()}_v*`, allow_no_indices: true }),
    );
    if (existing.length > 0) await client.indices.delete({ index: existing });
    const first = await product({ pricePaise: 30_000, fabric: 'Cotton', stock: 2 });
    const second = await product({ pricePaise: 40_000, fabric: 'Silk' });
    await syncProductsToSearchIndex([first.productId, second.productId]);
    await refreshProductSearchIndex();
    resetSearchFallbackCooldown();
    const result = await searchProducts(query({ sort: 'price_asc' }));
    expect(result.source).toBe('elasticsearch');
    expect(result.hits.map(({ productId }) => productId)).toEqual([
      first.productId,
      second.productId,
    ]);
    expect(result.facets.attributes[0]?.values).toEqual([
      { value: 'Cotton', count: 1 },
      { value: 'Silk', count: 1 },
    ]);

    await database.product.update({
      where: { id: first.productId },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await syncProductsToSearchIndex([first.productId]);
    await refreshProductSearchIndex();
    const after = await searchProducts(query());
    expect(after.hits.map(({ productId }) => productId)).toEqual([second.productId]);
  });
});
