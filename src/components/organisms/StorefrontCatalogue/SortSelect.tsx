'use client';

import { useRouter } from 'next/navigation';
import { SelectField } from '@/components/molecules/SelectField';
import { type ProductSort, productSortOptions } from '@/modules/search/product-search.schema';
import { searchHref, type SearchUrlState } from './search-url';

const sortLabels: Readonly<Record<ProductSort, string>> = {
  relevance: 'Relevance',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  newest: 'Newest first',
  discount: 'Biggest discount',
  rating: 'Customer rating',
};

// Changing the order keeps every filter and goes back to page 1.
export function SortSelect({
  basePath,
  state,
  fixedParams,
}: Readonly<{
  basePath: string;
  state: SearchUrlState;
  fixedParams?: Readonly<Record<string, string>>;
}>) {
  const router = useRouter();
  return (
    <SelectField
      label="Sort by"
      name="sort"
      options={Object.entries(sortLabels).map(([value, label]) => ({ value, label }))}
      value={state.sort}
      onValueChange={(value) => {
        const sort = productSortOptions.find((option) => option === value);
        if (sort === undefined) return;
        router.push(searchHref(basePath, { ...state, sort, page: 1 }, fixedParams));
      }}
    />
  );
}
