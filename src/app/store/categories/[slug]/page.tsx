import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { findCategoryTrail } from '@/modules/taxonomy/storefront-category.service';
import { StorePageFrame } from '../../store-page-frame';
import {
  parseStorefrontQuery,
  StorefrontSearchView,
  type StorefrontSearchParams,
} from '../../storefront-search-view';

// Blocks until the category is known, so an unknown slug answers with a real 404.
export const instant = false;

type CategoryPageProps = Readonly<{
  params: Promise<{ slug: string }>;
  searchParams: StorefrontSearchParams;
}>;

async function findCategory(slug: string) {
  const trail = findCategoryTrail(await getStorefrontCategoryTree(), slug);
  const category = trail?.at(-1);
  if (category === undefined) notFound();
  return category;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  return { title: (await findCategory((await params).slug)).name };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const category = await findCategory((await params).slug);
  const { query, isValid } = parseStorefrontQuery(await searchParams, category.slug);
  return (
    <StorePageFrame searchText={query.text}>
      <StorefrontSearchView
        basePath={`/categories/${category.slug}`}
        title={category.name}
        query={query}
        isValid={isValid}
      />
    </StorePageFrame>
  );
}
