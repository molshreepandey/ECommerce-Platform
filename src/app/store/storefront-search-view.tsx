import { connection } from 'next/server';
import { Breadcrumb } from '@/components/atoms/Breadcrumb';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Pagination } from '@/components/atoms/Pagination';
import { Text } from '@/components/atoms/Text';
import {
  FilterSidebar,
  SearchResultsGrid,
  SortSelect,
  searchHref,
  searchUrlStateFromQuery,
} from '@/components/organisms/StorefrontCatalogue';
import {
  parseProductSearchParams,
  type ProductSearchQuery,
  type SearchParamValues,
} from '@/modules/search/product-search.schema';
import { searchStorefront } from '@/modules/storefront/storefront-search.service';

export type StorefrontSearchParams = Promise<Record<string, string | string[] | undefined>>;

const defaultQuery: ProductSearchQuery = {
  text: undefined,
  categorySlug: undefined,
  brandSlugs: [],
  minPricePaise: undefined,
  maxPricePaise: undefined,
  inStockOnly: false,
  minimumRating: undefined,
  sort: 'relevance',
  page: 1,
  attributeFilters: [],
};

export function parseStorefrontQuery(
  values: SearchParamValues,
  categorySlug: string | undefined,
): { query: ProductSearchQuery; isValid: boolean } {
  const parsed = parseProductSearchParams(
    categorySlug === undefined ? values : { ...values, category: categorySlug },
  );
  if (parsed.success) return { query: parsed.data, isValid: true };
  return { query: { ...defaultQuery, categorySlug }, isValid: false };
}

// Shared by /search and /categories/<slug>: filters, sort, results and URL pagination (C7–C12). Throws
// CATEGORY_NOT_FOUND for an unknown category; the page maps it to notFound(). Results are live (stock,
// Elasticsearch with a time-based fallback), so they render at request time: a prefetch's runtime
// prerender resolves searchParams from the link and must not run the search itself.
export async function StorefrontSearchView({
  basePath,
  title,
  query,
  isValid,
}: Readonly<{ basePath: string; title: string; query: ProductSearchQuery; isValid: boolean }>) {
  await connection();
  const result = await searchStorefront(query);
  const state = searchUrlStateFromQuery(query);
  const resultLabel = `${String(result.totalCount)} ${result.totalCount === 1 ? 'product' : 'products'}`;
  return (
    <Flexbox direction="column" gap="lg">
      {result.category === null ? null : (
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            ...result.category.trail.map((category) => ({
              label: category.name,
              href: `/categories/${category.slug}`,
            })),
          ]}
        />
      )}
      <Flexbox direction="column-then-row" justify="between" gap="md">
        <Flexbox direction="column" gap="xs">
          <Heading level={1} variant="heading2">
            {title}
          </Heading>
          <Text variant="body2" tone="muted">
            {resultLabel}
            {result.source === 'postgres' ? ' · basic search while full search is unavailable' : ''}
          </Text>
        </Flexbox>
        <div className="w-full md:w-60">
          <SortSelect basePath={basePath} state={state} />
        </div>
      </Flexbox>
      {isValid ? null : (
        <InlineAlert tone="warning">
          Some filters in the address were not valid, so they were ignored.
        </InlineAlert>
      )}
      {result.category === null || result.category.children.length === 0 ? null : (
        <nav aria-label="Sub-categories">
          <ul className="flex flex-wrap gap-sm">
            {result.category.children.map((child) => (
              <li key={child.slug}>
                <Link href={`/categories/${child.slug}`} variant="body2">
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="grid grid-cols-1 gap-xl md:grid-cols-[16rem_1fr]">
        <FilterSidebar basePath={basePath} state={state} facets={result.facets} />
        <Flexbox direction="column" gap="xl">
          <SearchResultsGrid
            products={result.hits}
            emptyAction={<Link href={basePath}>Clear filters</Link>}
          />
          <Pagination
            page={result.page}
            pageCount={result.pageCount}
            hrefForPage={(page) => searchHref(basePath, { ...state, page })}
            label="Search results pages"
          />
        </Flexbox>
      </div>
    </Flexbox>
  );
}
