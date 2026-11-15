import Image from 'next/image';
import NextLink from 'next/link';
import { connection } from 'next/server';
import { Breadcrumb } from '@/components/atoms/Breadcrumb';
import { Flexbox } from '@/components/atoms/Flexbox';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { Heading } from '@/components/atoms/Heading';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Pagination } from '@/components/atoms/Pagination';
import { Text, textClassNames } from '@/components/atoms/Text';
import {
  type FilterCategoryLinks,
  FilterDrawer,
  FilterSidebar,
  type SearchUrlState,
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
import { categoryArtUrl } from '@/modules/catalogue/catalogue-art';
import {
  searchStorefront,
  type StorefrontSearchResult,
} from '@/modules/storefront/storefront-search.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { Money } from '@/lib/money';

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

// Moving to another category keeps the search text, price, stock and sort; brand and attribute choices
// belong to the category they were made in, so they are left behind.
function categoryState(state: SearchUrlState): SearchUrlState {
  return { ...state, brandSlugs: [], attributeFilters: [], page: 1 };
}

async function categoryLinksFor(
  category: StorefrontSearchResult['category'],
  state: SearchUrlState,
): Promise<FilterCategoryLinks> {
  const carried = categoryState(state);
  const linkTo = (slug: string) => searchHref(`/categories/${slug}`, carried);
  if (category === null) {
    const departments = await getStorefrontCategoryTree();
    return {
      up: null,
      links: departments.map(({ name, slug }) => ({ name, href: linkTo(slug) })),
    };
  }
  const parent = category.trail.at(-2);
  return {
    up:
      parent === undefined
        ? { label: 'All products', href: searchHref('/search', carried) }
        : { label: parent.name, href: linkTo(parent.slug) },
    links: category.children.map(({ name, slug }) => ({ name, href: linkTo(slug) })),
  };
}

type ActiveFilter = Readonly<{ label: string; removeHref: string }>;

function activeFiltersOf(
  basePath: string,
  state: SearchUrlState,
  facets: StorefrontSearchResult['facets'],
): ActiveFilter[] {
  const without = (change: Partial<SearchUrlState>) =>
    searchHref(basePath, { ...state, ...change, page: 1 });
  const filters: ActiveFilter[] = state.brandSlugs.map((slug) => ({
    label: facets.brands.find((brand) => brand.slug === slug)?.name ?? slug,
    removeHref: without({ brandSlugs: state.brandSlugs.filter((brandSlug) => brandSlug !== slug) }),
  }));
  if (state.minPriceRupees !== undefined || state.maxPriceRupees !== undefined) {
    const rupees = (value: number) => Money.formatRupees(Money.fromPaise(value * 100));
    filters.push({
      label:
        state.minPriceRupees !== undefined && state.maxPriceRupees !== undefined
          ? `${rupees(state.minPriceRupees)} – ${rupees(state.maxPriceRupees)}`
          : state.minPriceRupees !== undefined
            ? `From ${rupees(state.minPriceRupees)}`
            : `Up to ${rupees(state.maxPriceRupees ?? 0)}`,
      removeHref: without({ minPriceRupees: undefined, maxPriceRupees: undefined }),
    });
  }
  if (state.inStockOnly)
    filters.push({ label: 'In stock', removeHref: without({ inStockOnly: false }) });
  if (state.minimumRating !== undefined) {
    filters.push({
      label: `${String(state.minimumRating)}★ & above`,
      removeHref: without({ minimumRating: undefined }),
    });
  }
  for (const filter of state.attributeFilters) {
    const label = facets.attributes.find(({ code }) => code === filter.code)?.label ?? filter.code;
    for (const value of filter.values) {
      const remaining = filter.values.filter((other) => other !== value);
      filters.push({
        label: `${label}: ${value}`,
        removeHref: without({
          attributeFilters: state.attributeFilters.flatMap((other) =>
            other.code !== filter.code
              ? [other]
              : remaining.length === 0
                ? []
                : [{ code: other.code, values: remaining }],
          ),
        }),
      });
    }
  }
  return filters;
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
  const categoryLinks = await categoryLinksFor(result.category, state);
  const activeFilters = activeFiltersOf(basePath, state, result.facets);
  const categoryArt =
    result.category === null ? null : categoryArtUrl(result.category.trail.at(-1)?.slug ?? '');
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
        <div className="flex items-center gap-md">
          {categoryArt === null ? null : (
            <span className="relative hidden size-16 shrink-0 overflow-hidden rounded-card border border-lowlight bg-white sm:block">
              <Image
                src={categoryArt}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
                unoptimized
              />
            </span>
          )}
          <Flexbox direction="column" gap="xs">
            <Heading level={1} variant="heading2">
              {title}
            </Heading>
            <Text variant="body2" tone="muted">
              {resultLabel}
              {result.source === 'postgres'
                ? ' · basic search while full search is unavailable'
                : ''}
            </Text>
          </Flexbox>
        </div>
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
            {result.category.children.map((child) => {
              const childArt = categoryArtUrl(child.slug);
              return (
                <li key={child.slug}>
                  <NextLink
                    href={`/categories/${child.slug}`}
                    className={`inline-flex items-center gap-sm rounded-pill border border-lowlight bg-white py-xs pr-md pl-xs text-headings transition-colors hover:border-primary hover:text-primary ${focusRingClassNames} ${textClassNames({ variant: 'body2-medium' })}`}
                  >
                    {childArt === null ? null : (
                      <span className="relative block size-8 overflow-hidden rounded-pill bg-strokes">
                        <Image
                          src={childArt}
                          alt=""
                          fill
                          sizes="32px"
                          className="object-cover"
                          unoptimized
                        />
                      </span>
                    )}
                    {child.name}
                  </NextLink>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <div className="grid grid-cols-1 gap-xl md:grid-cols-[16rem_1fr]">
        <FilterDrawer activeCount={activeFilters.length}>
          <FilterSidebar
            basePath={basePath}
            state={state}
            facets={result.facets}
            categories={categoryLinks}
          />
        </FilterDrawer>
        <Flexbox direction="column" gap="xl">
          {activeFilters.length === 0 ? null : (
            <div className="flex flex-wrap items-center gap-sm">
              <ul aria-label="Active filters" className="flex flex-wrap gap-sm">
                {activeFilters.map((filter) => (
                  <li key={filter.removeHref}>
                    <NextLink
                      href={filter.removeHref}
                      aria-label={`Remove filter ${filter.label}`}
                      className={`inline-flex items-center gap-xs rounded-pill border border-accent-light-2 bg-accent-light-1 px-md py-xs text-primary hover:border-primary ${focusRingClassNames} ${textClassNames({ variant: 'body3-medium' })}`}
                    >
                      {filter.label}
                      <span aria-hidden="true">×</span>
                    </NextLink>
                  </li>
                ))}
              </ul>
              <Link
                href={searchHref(basePath, {
                  text: state.text,
                  brandSlugs: [],
                  inStockOnly: false,
                  attributeFilters: [],
                  sort: state.sort,
                  page: 1,
                })}
                variant="body3"
              >
                Clear all filters
              </Link>
            </div>
          )}
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
