import { beforeAll, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { searchProductsInPostgres } from '@/modules/search/postgres-product-search.repository';
import { productSearchAlias } from '@/modules/search/product-search-index';
import {
  refreshProductSearchIndex,
  syncProductsToSearchIndex,
} from '@/modules/search/product-search-index.service';
import type {
  ProductSearchInput,
  ProductSearchResult,
  ProductSort,
} from '@/modules/search/product-search.schema';
import {
  resetSearchFallbackCooldown,
  searchProducts,
} from '@/modules/search/product-search.service';

import { seedDemoCatalogue } from '../../prisma/seed/demo-catalogue.seed';

import { truncateAllTestTables } from './support/test-database';

// Every storefront filter and sort, on the 40-product demo catalogue, through both engines: the
// PostgreSQL fallback (what a deployment without Elasticsearch serves) and Elasticsearch.
const database = getDatabase();

type Engine = 'postgres' | 'elasticsearch';
const engines: readonly Engine[] = ['postgres', 'elasticsearch'];

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

async function search(engine: Engine, input: ProductSearchInput): Promise<ProductSearchResult> {
  if (engine === 'postgres') return searchProductsInPostgres(database, input);
  resetSearchFallbackCooldown();
  const result = await searchProducts(input);
  expect(result.source).toBe('elasticsearch');
  return result;
}

async function categoryFilter(slug: string): Promise<{ id: string; path: string }> {
  return database.category.findUniqueOrThrow({ where: { slug }, select: { id: true, path: true } });
}

async function allSlugs(engine: Engine, input: ProductSearchInput): Promise<string[]> {
  const first = await search(engine, input);
  const slugs = first.hits.map(({ slug }) => slug);
  for (let page = 2; page <= first.pageCount; page += 1) {
    slugs.push(...(await search(engine, { ...input, page })).hits.map(({ slug }) => slug));
  }
  return slugs;
}

const discountOf = (hit: { minPricePaise: number; mrpPaise: number }) =>
  hit.mrpPaise > 0 ? (hit.mrpPaise - hit.minPricePaise) / hit.mrpPaise : 0;

beforeAll(async () => {
  await truncateAllTestTables();
  const seeded = await seedDemoCatalogue(database);
  if (seeded.outcome !== 'seeded') throw new Error('the demo catalogue was not loaded');
  const client = getElasticsearchClient();
  const existing = Object.keys(
    await client.indices.get({ index: `${productSearchAlias()}_v*`, allow_no_indices: true }),
  );
  if (existing.length > 0) await client.indices.delete({ index: existing });
  await syncProductsToSearchIndex(seeded.productIds);
  await refreshProductSearchIndex();
});

describe.each(engines)('storefront filters and sorting (%s)', (engine) => {
  it('lists only active products, 24 per page, and pages through all of them', async () => {
    const active = await database.product.count({ where: { status: 'ACTIVE' } });
    const first = await search(engine, query({ sort: 'price_asc' }));
    expect(first.totalCount).toBe(active);
    expect(first.hits).toHaveLength(24);
    const slugs = await allSlugs(engine, query({ sort: 'price_asc' }));
    expect(new Set(slugs).size).toBe(active);
  });

  it('brand, price range, in stock and category filters narrow the results and combine', async () => {
    const electronics = await categoryFilter('electronics');
    const input = query({
      category: electronics,
      brandSlugs: ['voltix'],
      minPricePaise: 100_000,
      maxPricePaise: 5_000_000,
      inStockOnly: true,
      sort: 'price_asc',
    });
    const result = await search(engine, input);
    expect(result.totalCount).toBeGreaterThan(0);
    for (const hit of result.hits) {
      expect(hit.brandName).toBe('Voltix');
      expect(hit.minPricePaise).toBeGreaterThanOrEqual(100_000);
      expect(hit.minPricePaise).toBeLessThanOrEqual(5_000_000);
      expect(hit.inStock).toBe(true);
    }
    const everything = await search(engine, query({ category: electronics }));
    expect(result.totalCount).toBeLessThan(everything.totalCount);
    const beauty = await allSlugs(engine, query({ category: await categoryFilter('beauty') }));
    expect(beauty.length).toBeGreaterThan(0);
    expect(beauty.every((slug) => !result.hits.some((hit) => hit.slug === slug))).toBe(true);
  });

  it('a subcategory includes only its own products', async () => {
    const lipsticks = await allSlugs(
      engine,
      query({ category: await categoryFilter('lipsticks') }),
    );
    expect(new Set(lipsticks)).toEqual(
      new Set(['velvet-matte-lipstick', 'creme-satin-lipstick', 'tinted-lip-balm']),
    );
  });

  it('every facet count equals the number of products that choosing it shows', async () => {
    const base = query({ category: await categoryFilter('electronics'), brandSlugs: ['voltix'] });
    const result = await search(engine, base);
    const colour = result.facets.attributes.find(({ code }) => code === 'colour');
    const connectivity = result.facets.attributes.find(({ code }) => code === 'connectivity');
    expect(colour?.values.length).toBeGreaterThan(0);
    expect(connectivity?.values.length).toBeGreaterThan(0);
    for (const facet of [colour, connectivity]) {
      for (const { value, count } of facet?.values ?? []) {
        const narrowed = await search(engine, {
          ...base,
          attributeFilters: [{ code: facet?.code ?? '', values: [value] }],
        });
        expect(narrowed.totalCount, `${facet?.code ?? ''}=${value}`).toBe(count);
      }
    }
    // Brand counts ignore the brand choice itself, so other brands can be added; each count is what
    // choosing only that brand would show.
    for (const { slug, count } of result.facets.brands) {
      const narrowed = await search(engine, { ...base, brandSlugs: [slug] });
      expect(narrowed.totalCount, slug).toBe(count);
    }
    expect(result.facets.brands.map(({ slug }) => slug)).toEqual(['nimbus-tech', 'voltix']);
  });

  it('a chosen colour keeps the other colours selectable, with counts under the other filters', async () => {
    const base = query({
      category: await categoryFilter('electronics'),
      attributeFilters: [{ code: 'colour', values: ['White'] }],
      inStockOnly: true,
    });
    const result = await search(engine, base);
    expect(result.hits.length).toBeGreaterThan(0);
    const colours = result.facets.attributes.find(({ code }) => code === 'colour')?.values ?? [];
    expect(colours.map(({ value }) => value)).toContain('Black');
    const black = colours.find(({ value }) => value === 'Black');
    const blackOnly = await search(engine, {
      ...base,
      attributeFilters: [{ code: 'colour', values: ['Black'] }],
    });
    expect(blackOnly.totalCount).toBe(black?.count);
  });

  it('a filter that matches nothing returns no products and no facet values', async () => {
    const result = await search(engine, query({ minPricePaise: 0, maxPricePaise: 100 }));
    expect(result.totalCount).toBe(0);
    expect(result.hits).toEqual([]);
  });

  it.each<ProductSort>(['price_asc', 'price_desc', 'discount', 'newest'])(
    'sorts by %s',
    async (sort) => {
      const hits = (await search(engine, query({ sort }))).hits;
      for (let index = 1; index < hits.length; index += 1) {
        const previous = hits[index - 1];
        const current = hits[index];
        if (previous === undefined || current === undefined) continue;
        if (sort === 'price_asc')
          expect(previous.minPricePaise).toBeLessThanOrEqual(current.minPricePaise);
        if (sort === 'price_desc')
          expect(previous.minPricePaise).toBeGreaterThanOrEqual(current.minPricePaise);
        if (sort === 'discount')
          expect(discountOf(previous)).toBeGreaterThanOrEqual(discountOf(current) - 1e-9);
      }
    },
  );

  it('finds products by name, brand and category name', async () => {
    expect(await allSlugs(engine, query({ text: 'saree' }))).toContain('banarasi-silk-saree');
    const voltix = await search(engine, query({ text: 'voltix' }));
    expect(voltix.totalCount).toBeGreaterThan(0);
    expect(voltix.hits.every(({ brandName }) => brandName === 'Voltix')).toBe(true);
    expect(await allSlugs(engine, query({ text: 'lipsticks' }))).toEqual(
      expect.arrayContaining(['velvet-matte-lipstick', 'creme-satin-lipstick']),
    );
    expect((await search(engine, query({ text: 'zzqqxx' }))).totalCount).toBe(0);
  });
});

describe('both engines agree', () => {
  it.each<ProductSort>(['price_asc', 'price_desc', 'discount', 'newest'])(
    'on the order for %s and on facet counts',
    async (sort) => {
      const input = query({ sort, inStockOnly: true, brandSlugs: ['voltix', 'urban-loom'] });
      const [postgres, elasticsearch] = await Promise.all([
        allSlugs('postgres', input),
        allSlugs('elasticsearch', input),
      ]);
      expect(elasticsearch).toEqual(postgres);
      const [postgresFacets, elasticsearchFacets] = await Promise.all([
        search('postgres', input),
        search('elasticsearch', input),
      ]);
      expect(elasticsearchFacets.facets.brands).toEqual(postgresFacets.facets.brands);
      expect(elasticsearchFacets.facets.attributes).toEqual(postgresFacets.facets.attributes);
    },
  );
});
