import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Skeleton } from '@/components/atoms/Skeleton';
import { StorePageFrame } from '../store-page-frame';
import {
  parseStorefrontQuery,
  StorefrontSearchView,
  type StorefrontSearchParams,
} from '../storefront-search-view';

export const metadata: Metadata = { title: 'Search' };

async function SearchResults({ searchParams }: Readonly<{ searchParams: StorefrontSearchParams }>) {
  const { query, isValid } = parseStorefrontQuery(await searchParams, undefined);
  return (
    <StorePageFrame searchText={query.text}>
      <StorefrontSearchView
        basePath="/search"
        title={query.text === undefined ? 'All products' : `Results for “${query.text}”`}
        query={query}
        isValid={isValid}
      />
    </StorePageFrame>
  );
}

export default function SearchPage({
  searchParams,
}: Readonly<{ searchParams: StorefrontSearchParams }>) {
  return (
    <Suspense fallback={<Skeleton shape="block" height="lg" />}>
      <SearchResults searchParams={searchParams} />
    </Suspense>
  );
}
