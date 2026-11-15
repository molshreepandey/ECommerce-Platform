import type { estypes } from '@elastic/elasticsearch';
import { z } from 'zod';

import {
  pageCountFor,
  type ProductSearchFacets,
  type ProductSearchHit,
  type ProductSearchInput,
  type ProductSearchResult,
  type ProductSort,
  searchPageSize,
} from './product-search.schema';

const maximumFacetValues = 50;

type Query = NonNullable<estypes.SearchRequest['query']>;

const sortClauses: Record<ProductSort, estypes.SortCombinations[]> = {
  relevance: [{ _score: { order: 'desc' } }, { createdAt: 'desc' }, { productId: 'asc' }],
  price_asc: [{ minPricePaise: 'asc' }, { productId: 'asc' }],
  price_desc: [{ minPricePaise: 'desc' }, { productId: 'asc' }],
  newest: [{ createdAt: 'desc' }, { productId: 'asc' }],
  rating: [
    { rating: { order: 'desc', missing: '_last' } },
    { reviewCount: 'desc' },
    { productId: 'asc' },
  ],
};

// Text and category decide the result set the filter options are drawn from; brand, price, stock,
// rating and attribute filters narrow the hits only (post_filter), so choosing one colour still lists the
// other colours to add.
function baseQuery(input: ProductSearchInput): Query {
  const must: Query[] =
    input.text === undefined
      ? [{ match_all: {} }]
      : [
          {
            multi_match: {
              query: input.text,
              fields: ['name^3', 'brand.name^2', 'categoryNames', 'searchableText'],
              fuzziness: 'AUTO',
              operator: 'and',
            },
          },
        ];
  const filter: Query[] = [{ term: { status: 'ACTIVE' } }];
  if (input.category !== null) filter.push({ term: { categoryIds: input.category.id } });
  return { bool: { must, filter } };
}

function narrowingFilters(input: ProductSearchInput): Query[] {
  const filters: Query[] = [];
  if (input.brandSlugs.length > 0) filters.push({ terms: { 'brand.slug': input.brandSlugs } });
  if (input.minPricePaise !== undefined || input.maxPricePaise !== undefined) {
    filters.push({
      range: {
        minPricePaise: {
          ...(input.minPricePaise === undefined ? {} : { gte: input.minPricePaise }),
          ...(input.maxPricePaise === undefined ? {} : { lte: input.maxPricePaise }),
        },
      },
    });
  }
  if (input.inStockOnly) filters.push({ term: { inStock: true } });
  if (input.minimumRating !== undefined)
    filters.push({ range: { rating: { gte: input.minimumRating } } });
  for (const attribute of input.attributeFilters) {
    filters.push({
      nested: {
        path: 'attributes',
        query: {
          bool: {
            filter: [
              { term: { 'attributes.code': attribute.code } },
              { terms: { 'attributes.value': attribute.values } },
            ],
          },
        },
      },
    });
  }
  return filters;
}

export function buildElasticsearchProductQuery(input: ProductSearchInput): estypes.SearchRequest {
  const narrowing = narrowingFilters(input);
  return {
    from: (input.page - 1) * searchPageSize,
    size: searchPageSize,
    track_total_hits: true,
    query: baseQuery(input),
    ...(narrowing.length === 0 ? {} : { post_filter: { bool: { filter: narrowing } } }),
    sort: sortClauses[input.sort],
    _source: [
      'productId',
      'slug',
      'name',
      'brand.name',
      'imageUrl',
      'imageAlt',
      'minPricePaise',
      'mrpPaise',
      'inStock',
      'rating',
      'reviewCount',
    ],
    aggs: {
      brands: {
        terms: { field: 'brand.slug', size: maximumFacetValues, order: { _key: 'asc' } },
        aggs: { name: { terms: { field: 'brand.name.keyword', size: 1 } } },
      },
      attributes: {
        nested: { path: 'attributes' },
        aggs: {
          codes: {
            terms: { field: 'attributes.code', size: maximumFacetValues, order: { _key: 'asc' } },
            aggs: {
              values: {
                terms: {
                  field: 'attributes.value',
                  size: maximumFacetValues,
                  order: { _key: 'asc' },
                },
              },
            },
          },
        },
      },
    },
  };
}

const hitSourceSchema = z.object({
  productId: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.object({ name: z.string() }),
  imageUrl: z.string().nullable(),
  imageAlt: z.string().nullable(),
  minPricePaise: z.number(),
  mrpPaise: z.number(),
  inStock: z.boolean(),
  rating: z.number().nullable(),
  reviewCount: z.number(),
});

const bucketSchema = z.object({ key: z.union([z.string(), z.number()]), doc_count: z.number() });
const aggregationsSchema = z.object({
  brands: z.object({
    buckets: z.array(bucketSchema.extend({ name: z.object({ buckets: z.array(bucketSchema) }) })),
  }),
  attributes: z.object({
    codes: z.object({
      buckets: z.array(
        bucketSchema.extend({ values: z.object({ buckets: z.array(bucketSchema) }) }),
      ),
    }),
  }),
});

function toHit(source: unknown): ProductSearchHit {
  const parsed = hitSourceSchema.parse(source);
  return {
    productId: parsed.productId,
    slug: parsed.slug,
    name: parsed.name,
    brandName: parsed.brand.name,
    imageUrl: parsed.imageUrl,
    imageAlt: parsed.imageAlt,
    minPricePaise: parsed.minPricePaise,
    mrpPaise: parsed.mrpPaise,
    inStock: parsed.inStock,
    rating: parsed.rating,
    reviewCount: parsed.reviewCount,
  };
}

function toFacets(aggregations: unknown): ProductSearchFacets {
  const parsed = aggregationsSchema.parse(aggregations);
  return {
    brands: parsed.brands.buckets.map((bucket) => ({
      slug: String(bucket.key),
      name: String(bucket.name.buckets[0]?.key ?? bucket.key),
      count: bucket.doc_count,
    })),
    attributes: parsed.attributes.codes.buckets.map((bucket) => ({
      code: String(bucket.key),
      values: bucket.values.buckets.map((value) => ({
        value: String(value.key),
        count: value.doc_count,
      })),
    })),
  };
}

export function mapElasticsearchProductResponse(
  response: estypes.SearchResponse,
  page: number,
): ProductSearchResult {
  const total = response.hits.total;
  const totalCount = typeof total === 'number' ? total : (total?.value ?? 0);
  return {
    hits: response.hits.hits.map((hit) => toHit(hit._source)),
    totalCount,
    page,
    pageCount: pageCountFor(totalCount),
    facets: toFacets(response.aggregations),
    source: 'elasticsearch',
  };
}
