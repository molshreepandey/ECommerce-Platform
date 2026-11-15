import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Input } from '@/components/atoms/Input';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { attributeFilterPrefix, maximumPriceRupees } from '@/modules/search/product-search.schema';
import { searchHref, type SearchUrlState } from './search-url';

export type FilterFacets = Readonly<{
  brands: readonly { slug: string; name: string; count: number }[];
  attributes: readonly {
    code: string;
    label: string;
    values: readonly { value: string; count: number }[];
  }[];
}>;

const ratingThresholds = [4, 3, 2, 1] as const;

function FilterGroup({
  legend,
  children,
}: Readonly<{ legend: string; children: React.ReactNode }>) {
  return (
    <fieldset className="flex flex-col gap-sm border-t border-strokes pt-md">
      <legend className="float-left mb-sm w-full">
        <Text as="span" variant="body2-medium">
          {legend}
        </Text>
      </legend>
      {children}
    </fieldset>
  );
}

// A plain GET form (plan C9, C12): applying filters keeps the search text and sort, and goes back to page 1.
export function FilterSidebar({
  basePath,
  state,
  facets,
}: Readonly<{ basePath: string; state: SearchUrlState; facets: FilterFacets }>) {
  const selectedValues = new Map(
    state.attributeFilters.map((filter) => [filter.code, new Set(filter.values)]),
  );
  const clearedState: SearchUrlState = {
    text: state.text,
    brandSlugs: [],
    inStockOnly: false,
    attributeFilters: [],
    sort: state.sort,
    page: 1,
  };
  return (
    <aside aria-labelledby="filters-heading" className="flex flex-col gap-md">
      <Flexbox justify="between" align="center">
        <Heading level={2} variant="heading5" id="filters-heading">
          Filters
        </Heading>
        <Link href={searchHref(basePath, clearedState)} appearance="subtle" variant="body3">
          Clear all
        </Link>
      </Flexbox>
      <form action={basePath} method="get" className="flex flex-col gap-md">
        {state.text === undefined ? null : <Input type="hidden" name="q" value={state.text} />}
        {state.sort === 'relevance' ? null : <Input type="hidden" name="sort" value={state.sort} />}
        {state.minimumRating === undefined ? null : (
          <Input type="hidden" name="rating" value={String(state.minimumRating)} />
        )}
        {facets.brands.length === 0 ? null : (
          <FilterGroup legend="Brand">
            {facets.brands.map((brand) => (
              <Checkbox
                key={brand.slug}
                name="brand"
                value={brand.slug}
                defaultChecked={state.brandSlugs.includes(brand.slug)}
                label={`${brand.name} (${String(brand.count)})`}
              />
            ))}
          </FilterGroup>
        )}
        <FilterGroup legend="Price (₹)">
          <div className="grid grid-cols-2 gap-sm">
            <FormField
              label="Min"
              name="minPrice"
              type="number"
              inputMode="numeric"
              min={0}
              max={maximumPriceRupees}
              defaultValue={state.minPriceRupees ?? ''}
            />
            <FormField
              label="Max"
              name="maxPrice"
              type="number"
              inputMode="numeric"
              min={0}
              max={maximumPriceRupees}
              defaultValue={state.maxPriceRupees ?? ''}
            />
          </div>
        </FilterGroup>
        <FilterGroup legend="Availability">
          <Checkbox
            name="inStock"
            value="true"
            defaultChecked={state.inStockOnly}
            label="In stock only"
          />
        </FilterGroup>
        {facets.attributes.map((attribute) => (
          <FilterGroup key={attribute.code} legend={attribute.label}>
            {attribute.values.map(({ value, count }) => (
              <Checkbox
                key={value}
                name={`${attributeFilterPrefix}${attribute.code}`}
                value={value}
                defaultChecked={selectedValues.get(attribute.code)?.has(value) ?? false}
                label={`${value} (${String(count)})`}
              />
            ))}
          </FilterGroup>
        ))}
        <Button type="submit" appearance="primary" isFullWidth>
          Apply filters
        </Button>
      </form>
      <FilterGroup legend="Customer rating">
        <ul className="flex flex-col gap-xs">
          {ratingThresholds.map((threshold) => (
            <li key={threshold}>
              <Link
                href={searchHref(basePath, { ...state, minimumRating: threshold, page: 1 })}
                appearance={state.minimumRating === threshold ? 'default' : 'subtle'}
                aria-current={state.minimumRating === threshold ? 'true' : undefined}
              >
                {threshold}★ &amp; above
              </Link>
            </li>
          ))}
          {state.minimumRating === undefined ? null : (
            <li>
              <Link
                href={searchHref(basePath, { ...state, minimumRating: undefined, page: 1 })}
                appearance="subtle"
                variant="body3"
              >
                Any rating
              </Link>
            </li>
          )}
        </ul>
      </FilterGroup>
    </aside>
  );
}
