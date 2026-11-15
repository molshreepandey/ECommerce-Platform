import { z } from 'zod';

export const productSortOptions = [
  'relevance',
  'price_asc',
  'price_desc',
  'newest',
  'discount',
  'rating',
] as const;
export type ProductSort = (typeof productSortOptions)[number];

export const searchPageSize = 24;
// Elasticsearch serves at most 10,000 hits by from/size; the last page stays within that window.
export const maximumSearchPage = Math.floor(10_000 / searchPageSize);
export const maximumSearchTextLength = 100;
export const maximumPriceRupees = 10_000_000;
const maximumAttributeFilters = 10;
const maximumValuesPerFilter = 20;
export const attributeFilterPrefix = 'attr.';

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const attributeCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,49}$/);
const filterValueSchema = z.string().trim().min(1).max(100);
const rupeesSchema = z.coerce.number().int().min(0).max(maximumPriceRupees);

const searchParamsSchema = z
  .object({
    q: z.string().trim().max(maximumSearchTextLength).optional(),
    category: slugSchema.optional(),
    brand: z.array(slugSchema).max(maximumValuesPerFilter).default([]),
    minPrice: rupeesSchema.optional(),
    maxPrice: rupeesSchema.optional(),
    inStock: z.enum(['true']).optional(),
    rating: z.coerce.number().int().min(1).max(4).optional(),
    sort: z.enum(productSortOptions).default('relevance'),
    page: z.coerce.number().int().min(1).max(maximumSearchPage).default(1),
    attributes: z
      .array(
        z.object({
          code: attributeCodeSchema,
          values: z.array(filterValueSchema).min(1).max(maximumValuesPerFilter),
        }),
      )
      .max(maximumAttributeFilters),
  })
  .refine(
    (query) =>
      query.minPrice === undefined ||
      query.maxPrice === undefined ||
      query.minPrice <= query.maxPrice,
    { message: 'The lowest price must not be above the highest', path: ['minPrice'] },
  )
  .transform((query) => ({
    text: query.q === undefined || query.q === '' ? undefined : query.q,
    categorySlug: query.category,
    brandSlugs: [...new Set(query.brand)],
    minPricePaise: query.minPrice === undefined ? undefined : query.minPrice * 100,
    maxPricePaise: query.maxPrice === undefined ? undefined : query.maxPrice * 100,
    inStockOnly: query.inStock === 'true',
    minimumRating: query.rating,
    sort: query.sort,
    page: query.page,
    attributeFilters: query.attributes.map((filter) => ({
      code: filter.code,
      values: [...new Set(filter.values)],
    })),
  }));

export type ProductSearchQuery = z.output<typeof searchParamsSchema>;

export type SearchParamValues = Readonly<Record<string, string | readonly string[] | undefined>>;

function valuesOf(value: string | readonly string[] | undefined): string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : [...value];
}

// URL state (plan C12): q, category, brand (repeated), minPrice and maxPrice in whole rupees, inStock,
// rating (minimum stars), sort, page, and attr.<code> (repeated) for attribute filters. Single-valued
// keys take their first value; unknown keys (tracking parameters and the like) are ignored.
export function parseProductSearchParams(params: SearchParamValues) {
  const single = (key: string) => valuesOf(params[key])[0];
  const attributes = Object.entries(params)
    .filter(([key]) => key.startsWith(attributeFilterPrefix))
    .map(([key, value]) => ({
      code: key.slice(attributeFilterPrefix.length),
      values: valuesOf(value),
    }))
    .filter(({ values }) => values.length > 0)
    .sort((left, right) => left.code.localeCompare(right.code));
  return searchParamsSchema.safeParse({
    q: single('q'),
    category: single('category'),
    brand: valuesOf(params['brand']),
    minPrice: emptyToUndefined(single('minPrice')),
    maxPrice: emptyToUndefined(single('maxPrice')),
    inStock: emptyToUndefined(single('inStock')),
    rating: emptyToUndefined(single('rating')),
    sort: emptyToUndefined(single('sort')),
    page: emptyToUndefined(single('page')),
    attributes,
  });
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

export function searchParamValuesFromUrl(searchParams: URLSearchParams): SearchParamValues {
  const values: Record<string, string[]> = {};
  for (const [key, value] of searchParams) (values[key] ??= []).push(value);
  return values;
}

export interface ProductSearchInput extends Omit<ProductSearchQuery, 'categorySlug'> {
  category: { id: string; path: string } | null;
}

export interface ProductSearchHit {
  productId: string;
  slug: string;
  name: string;
  brandName: string;
  imageUrl: string | null;
  imageAlt: string | null;
  minPricePaise: number;
  mrpPaise: number;
  inStock: boolean;
  rating: number | null;
  reviewCount: number;
}

// C10: every filter value with the number of matching products (before the brand and attribute filters,
// so a customer can see how many products each alternative would show).
export interface ProductSearchFacets {
  brands: { slug: string; name: string; count: number }[];
  attributes: { code: string; values: { value: string; count: number }[] }[];
}

export interface ProductSearchResult {
  hits: ProductSearchHit[];
  totalCount: number;
  page: number;
  pageCount: number;
  facets: ProductSearchFacets;
  source: 'elasticsearch' | 'postgres';
}

export function pageCountFor(totalCount: number): number {
  return Math.min(maximumSearchPage, Math.max(1, Math.ceil(totalCount / searchPageSize)));
}
