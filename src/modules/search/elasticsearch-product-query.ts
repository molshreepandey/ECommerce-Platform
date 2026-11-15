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
  // Discount of the cheapest variant against its MRP, as a fraction (same order as the PostgreSQL fallback).
  discount: [
    {
      _script: {
        type: 'number',
        order: 'desc',
        script: {
          source:
            "double mrp = doc['mrpPaise'].size() == 0 ? 0 : doc['mrpPaise'].value; " +
            "double price = doc['minPricePaise'].size() == 0 ? 0 : doc['minPricePaise'].value; " +
            'return mrp > 0 ? (mrp - price) / mrp : 0;',
        },
      },
    },
    { minPricePaise: 'asc' },
    { productId: 'asc' },
  ],
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

// A facet leaves out its own filter (omit), so its counts show what each value would give with every
// other filter applied (multi-select facets, same rule as the PostgreSQL fallback).
function narrowingFilters(
  input: ProductSearchInput,
  omit: { brand?: boolean; attributeCode?: string } = {},
): Query[] {
  const filters: Query[] = [];
  if (input.brandSlugs.length > 0 && omit.brand !== true)
    filters.push({ terms: { 'brand.slug': input.brandSlugs } });
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
    if (attribute.code === omit.attributeCode) continue;
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
    aggs: facetAggregations(input),
  };
}

const facetValueAggregation = {
  terms: { field: 'attributes.value', size: maximumFacetValues, order: { _key: 'asc' } },
  // Products, not nested attribute entries.
  aggs: { products: { reverse_nested: {} } },
} as const;

function filtered(
  filters: Query[],
  aggs: Record<string, estypes.AggregationsAggregationContainer>,
) {
  return { filter: { bool: { filter: filters } }, aggs };
}

// C10 counts: every facet counts with all filters applied except its own.
function facetAggregations(
  input: ProductSearchInput,
): Record<string, estypes.AggregationsAggregationContainer> {
  const selectedCodes = [...new Set(input.attributeFilters.map((attribute) => attribute.code))];
  const aggregations: Record<string, estypes.AggregationsAggregationContainer> = {
    brands: filtered(narrowingFilters(input, { brand: true }), {
      values: {
        terms: { field: 'brand.slug', size: maximumFacetValues, order: { _key: 'asc' } },
        aggs: { name: { terms: { field: 'brand.name.keyword', size: 1 } } },
      },
    }),
    attributes: filtered(narrowingFilters(input), {
      nested: {
        nested: { path: 'attributes' },
        aggs: {
          codes: {
            terms: { field: 'attributes.code', size: maximumFacetValues, order: { _key: 'asc' } },
            aggs: { values: facetValueAggregation },
          },
        },
      },
    }),
  };
  for (const [index, code] of selectedCodes.entries()) {
    aggregations[`selected_${String(index)}`] = filtered(
      narrowingFilters(input, { attributeCode: code }),
      {
        nested: {
          nested: { path: 'attributes' },
          aggs: {
            code: {
              filter: { term: { 'attributes.code': code } },
              aggs: { values: facetValueAggregation },
            },
          },
        },
      },
    );
  }
  return aggregations;
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
const valueBucketsSchema = z.object({
  buckets: z.array(bucketSchema.extend({ products: z.object({ doc_count: z.number() }) })),
});
const aggregationsSchema = z
  .object({
    brands: z.object({
      values: z.object({
        buckets: z.array(
          bucketSchema.extend({ name: z.object({ buckets: z.array(bucketSchema) }) }),
        ),
      }),
    }),
    attributes: z.object({
      nested: z.object({
        codes: z.object({
          buckets: z.array(bucketSchema.extend({ values: valueBucketsSchema })),
        }),
      }),
    }),
  })
  .catchall(z.unknown());
const selectedCodeSchema = z.object({
  nested: z.object({ code: z.object({ values: valueBucketsSchema }) }),
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

function toFacets(aggregations: unknown, selectedCodes: readonly string[]): ProductSearchFacets {
  const parsed = aggregationsSchema.parse(aggregations);
  const toValues = (buckets: z.infer<typeof valueBucketsSchema>['buckets']) =>
    buckets
      .map((value) => ({ value: String(value.key), count: value.products.doc_count }))
      .filter((value) => value.count > 0);
  const valuesByCode = new Map<string, { value: string; count: number }[]>();
  for (const bucket of parsed.attributes.nested.codes.buckets) {
    const code = String(bucket.key);
    if (!selectedCodes.includes(code)) valuesByCode.set(code, toValues(bucket.values.buckets));
  }
  for (const [index, code] of selectedCodes.entries()) {
    const selected = selectedCodeSchema.parse(parsed[`selected_${String(index)}`]);
    valuesByCode.set(code, toValues(selected.nested.code.values.buckets));
  }
  return {
    brands: parsed.brands.values.buckets.map((bucket) => ({
      slug: String(bucket.key),
      name: String(bucket.name.buckets[0]?.key ?? bucket.key),
      count: bucket.doc_count,
    })),
    attributes: [...valuesByCode]
      .filter(([, values]) => values.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([code, values]) => ({ code, values })),
  };
}

export function mapElasticsearchProductResponse(
  response: estypes.SearchResponse,
  input: Pick<ProductSearchInput, 'page' | 'attributeFilters'>,
): ProductSearchResult {
  const { page } = input;
  const total = response.hits.total;
  const totalCount = typeof total === 'number' ? total : (total?.value ?? 0);
  return {
    hits: response.hits.hits.map((hit) => toHit(hit._source)),
    totalCount,
    page,
    pageCount: pageCountFor(totalCount),
    facets: toFacets(response.aggregations, [
      ...new Set(input.attributeFilters.map((attribute) => attribute.code)),
    ]),
    source: 'elasticsearch',
  };
}
