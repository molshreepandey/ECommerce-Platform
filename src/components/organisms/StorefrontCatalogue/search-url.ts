import {
  attributeFilterPrefix,
  type ProductSearchQuery,
  type ProductSort,
} from '@/modules/search/product-search.schema';

export type SearchUrlState = Readonly<{
  text?: string | undefined;
  brandSlugs: readonly string[];
  minPriceRupees?: number | undefined;
  maxPriceRupees?: number | undefined;
  inStockOnly: boolean;
  minimumRating?: number | undefined;
  attributeFilters: readonly { code: string; values: readonly string[] }[];
  sort: ProductSort;
  page: number;
}>;

export function searchUrlStateFromQuery(query: ProductSearchQuery): SearchUrlState {
  return {
    text: query.text,
    brandSlugs: query.brandSlugs,
    minPriceRupees: query.minPricePaise === undefined ? undefined : query.minPricePaise / 100,
    maxPriceRupees: query.maxPricePaise === undefined ? undefined : query.maxPricePaise / 100,
    inStockOnly: query.inStockOnly,
    minimumRating: query.minimumRating,
    attributeFilters: query.attributeFilters,
    sort: query.sort,
    page: query.page,
  };
}

// The whole search state as a query string (plan C12); defaults are left out so URLs stay short.
export function searchQueryString(
  state: SearchUrlState,
  fixedParams: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams(fixedParams);
  if (state.text !== undefined && state.text !== '') params.set('q', state.text);
  for (const slug of state.brandSlugs) params.append('brand', slug);
  if (state.minPriceRupees !== undefined) params.set('minPrice', String(state.minPriceRupees));
  if (state.maxPriceRupees !== undefined) params.set('maxPrice', String(state.maxPriceRupees));
  if (state.inStockOnly) params.set('inStock', 'true');
  if (state.minimumRating !== undefined) params.set('rating', String(state.minimumRating));
  for (const filter of state.attributeFilters) {
    for (const value of filter.values)
      params.append(`${attributeFilterPrefix}${filter.code}`, value);
  }
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  return params.toString();
}

export function searchHref(
  basePath: string,
  state: SearchUrlState,
  fixedParams: Readonly<Record<string, string>> = {},
): string {
  const query = searchQueryString(state, fixedParams);
  return query === '' ? basePath : `${basePath}?${query}`;
}
